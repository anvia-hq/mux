import { createHash, randomInt } from "node:crypto";
import type { Prisma, RedemptionCodeStatus, RedemptionTargetType } from "../../utils/prisma";
import { prisma } from "../../utils/prisma";
import { isUniqueConstraintError } from "../auth/utils";
import { invalidateApiKeyCacheById, invalidateApiKeyCachesForUser } from "../keys/services";
import type {
  CreateRedemptionInput,
  RedemptionSummary,
  RedemptionStatus,
  UpdateRedemptionInput,
} from "./types";

const CODE_PREFIX = "MUXR";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RANDOM_LENGTH = 16;

export class InvalidRedemptionCodeError extends Error {
  constructor() {
    super("invalid redemption code");
    this.name = "InvalidRedemptionCodeError";
  }
}

export class RedemptionNotFoundError extends Error {
  constructor() {
    super("redemption code not found");
    this.name = "RedemptionNotFoundError";
  }
}

export class RedemptionAlreadyAppliedError extends Error {
  constructor() {
    super("redemption code has already been applied");
    this.name = "RedemptionAlreadyAppliedError";
  }
}

export class RedemptionTargetNotFoundError extends Error {
  constructor() {
    super("redemption target not found");
    this.name = "RedemptionTargetNotFoundError";
  }
}

export function normalizeRedemptionCode(code: string): string {
  return code.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

export function hashRedemptionCode(code: string): string {
  return createHash("sha256").update(normalizeRedemptionCode(code)).digest("hex");
}

export function generateRedemptionCode(): { raw: string; hashed: string; lastFour: string } {
  let body = "";

  for (let index = 0; index < CODE_RANDOM_LENGTH; index += 1) {
    body += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }

  const normalized = `${CODE_PREFIX}${body}`;
  const formatted = [
    CODE_PREFIX,
    body.slice(0, 4),
    body.slice(4, 8),
    body.slice(8, 12),
    body.slice(12, 16),
  ].join("-");

  return {
    raw: formatted,
    hashed: hashRedemptionCode(normalized),
    lastFour: normalized.slice(-4),
  };
}

export async function createRedemptions(createdBy: string, input: CreateRedemptionInput) {
  const count = input.count ?? 1;
  const expiresAt = parseExpiresAt(input.expiresAt) ?? null;
  const redemptions: Array<RedemptionSummary & { code: string }> = [];

  for (let index = 0; index < count; index += 1) {
    redemptions.push(await createSingleRedemption(createdBy, input, expiresAt));
  }

  return { redemptions };
}

export async function listRedemptions(): Promise<RedemptionSummary[]> {
  const redemptions = await prisma.redemptionCode.findMany({
    include: redemptionSummaryInclude,
    orderBy: { createdAt: "desc" },
  });

  return redemptions.map(toRedemptionSummary);
}

export async function updateRedemption(
  id: string,
  input: UpdateRedemptionInput,
): Promise<RedemptionSummary> {
  const redemption = await prisma.redemptionCode.findUnique({
    where: { id },
    include: redemptionSummaryInclude,
  });

  if (!redemption) {
    throw new RedemptionNotFoundError();
  }

  if (redemption.status === "USED" || redemption.application) {
    throw new RedemptionAlreadyAppliedError();
  }

  const updated = await prisma.redemptionCode.update({
    where: { id },
    data: {
      name: input.name,
      amountUsd: input.amountUsd,
      status: input.status,
      expiresAt: parseExpiresAt(input.expiresAt),
    },
    include: redemptionSummaryInclude,
  });

  return toRedemptionSummary(updated);
}

export async function deleteRedemption(id: string): Promise<void> {
  const redemption = await prisma.redemptionCode.findUnique({
    where: { id },
    select: {
      status: true,
      application: { select: { id: true } },
    },
  });

  if (!redemption) {
    throw new RedemptionNotFoundError();
  }

  if (redemption.status === "USED" || redemption.application) {
    throw new RedemptionAlreadyAppliedError();
  }

  await prisma.redemptionCode.delete({ where: { id } });
}

export async function applyRedemptionById(input: {
  id: string;
  targetType: RedemptionTargetType;
  targetId: string;
  appliedBy: string;
}): Promise<RedemptionSummary> {
  return applyRedemption({
    where: { id: input.id },
    notFoundError: new RedemptionNotFoundError(),
    targetType: input.targetType,
    targetId: input.targetId,
    appliedBy: input.appliedBy,
  });
}

export async function redeemRedemptionCode(input: {
  code: string;
  userId: string;
}): Promise<RedemptionSummary> {
  return applyRedemption({
    where: { codeHash: hashRedemptionCode(input.code) },
    notFoundError: new InvalidRedemptionCodeError(),
    targetType: "USER",
    targetId: input.userId,
    appliedBy: input.userId,
  });
}

async function createSingleRedemption(
  createdBy: string,
  input: CreateRedemptionInput,
  expiresAt: Date | null,
): Promise<RedemptionSummary & { code: string }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateRedemptionCode();

    try {
      const redemption = await prisma.redemptionCode.create({
        data: {
          codeHash: code.hashed,
          codeLastFour: code.lastFour,
          name: input.name,
          amountUsd: input.amountUsd,
          expiresAt,
          createdBy,
        },
        include: redemptionSummaryInclude,
      });

      return { ...toRedemptionSummary(redemption), code: code.raw };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("failed to generate unique redemption code");
}

async function applyRedemption(input: {
  where: { id: string } | { codeHash: string };
  notFoundError: Error;
  targetType: RedemptionTargetType;
  targetId: string;
  appliedBy: string;
}): Promise<RedemptionSummary> {
  const result = await prisma.$transaction(async (tx) => {
    const redemption = await tx.redemptionCode.findUnique({
      where: input.where,
      include: {
        application: { select: { id: true } },
      },
    });

    if (!redemption) {
      throw input.notFoundError;
    }

    assertRedeemable(redemption);

    const invalidation =
      input.targetType === "USER"
        ? await creditUser(tx, input.targetId, redemption.amountUsd)
        : await creditApiKey(tx, input.targetId, redemption.amountUsd);

    const claimed = await tx.redemptionCode.updateMany({
      where: {
        id: redemption.id,
        status: "ACTIVE",
      },
      data: { status: "USED" },
    });

    if (claimed.count !== 1) {
      throw new InvalidRedemptionCodeError();
    }

    await tx.redemptionApplication.create({
      data: {
        redemptionCodeId: redemption.id,
        targetType: input.targetType,
        userId: input.targetType === "USER" ? input.targetId : null,
        apiKeyId: input.targetType === "API_KEY" ? input.targetId : null,
        appliedBy: input.appliedBy,
      },
    });

    const applied = await tx.redemptionCode.findUnique({
      where: { id: redemption.id },
      include: redemptionSummaryInclude,
    });

    if (!applied) {
      throw new InvalidRedemptionCodeError();
    }

    return { redemption: toRedemptionSummary(applied), invalidation };
  });

  if (result.invalidation.userId) {
    await invalidateApiKeyCachesForUser(result.invalidation.userId);
  }

  if (result.invalidation.apiKeyId) {
    await invalidateApiKeyCacheById(result.invalidation.apiKeyId);
  }

  return result.redemption;
}

function assertRedeemable(redemption: {
  status: RedemptionCodeStatus;
  expiresAt: Date | null;
  application: { id: string } | null;
}): void {
  if (redemption.application || redemption.status === "USED") {
    throw new RedemptionAlreadyAppliedError();
  }

  if (redemption.status !== "ACTIVE") {
    throw new InvalidRedemptionCodeError();
  }

  if (redemption.expiresAt && redemption.expiresAt <= new Date()) {
    throw new InvalidRedemptionCodeError();
  }
}

async function creditUser(
  tx: Prisma.TransactionClient,
  userId: string,
  amountUsd: number,
): Promise<{ userId?: string; apiKeyId?: string }> {
  const updatedRows = await tx.$executeRaw`
    UPDATE "User"
    SET "spendLimitUsd" = COALESCE("spendLimitUsd", 0) + ${amountUsd},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${userId}
  `;

  if (updatedRows !== 1) {
    throw new RedemptionTargetNotFoundError();
  }

  return { userId };
}

async function creditApiKey(
  tx: Prisma.TransactionClient,
  apiKeyId: string,
  amountUsd: number,
): Promise<{ userId?: string; apiKeyId?: string }> {
  const updatedRows = await tx.$executeRaw`
    UPDATE "ApiKey"
    SET "spendLimitUsd" = COALESCE("spendLimitUsd", 0) + ${amountUsd}
    WHERE "id" = ${apiKeyId}
  `;

  if (updatedRows !== 1) {
    throw new RedemptionTargetNotFoundError();
  }

  return { apiKeyId };
}

function parseExpiresAt(expiresAt: string | null | undefined): Date | null | undefined {
  if (expiresAt === undefined) {
    return undefined;
  }

  return expiresAt === null ? null : new Date(expiresAt);
}

const redemptionSummaryInclude = {
  creator: { select: { email: true } },
  application: {
    include: {
      applier: { select: { email: true } },
      user: { select: { id: true, email: true } },
      apiKey: {
        select: {
          id: true,
          name: true,
          creator: { select: { email: true } },
        },
      },
    },
  },
} satisfies Prisma.RedemptionCodeInclude;

type RedemptionWithSummaryRelations = Prisma.RedemptionCodeGetPayload<{
  include: typeof redemptionSummaryInclude;
}>;

function toRedemptionSummary(redemption: RedemptionWithSummaryRelations): RedemptionSummary {
  return {
    id: redemption.id,
    codeLastFour: redemption.codeLastFour,
    name: redemption.name,
    amountUsd: redemption.amountUsd,
    status: getRedemptionStatus(redemption),
    expiresAt: redemption.expiresAt,
    createdAt: redemption.createdAt,
    updatedAt: redemption.updatedAt,
    creator: redemption.creator,
    application: redemption.application
      ? {
          targetType: redemption.application.targetType,
          createdAt: redemption.application.createdAt,
          applier: redemption.application.applier,
          user: redemption.application.user,
          apiKey: redemption.application.apiKey,
        }
      : null,
  };
}

function getRedemptionStatus(
  redemption: Pick<RedemptionWithSummaryRelations, "status" | "expiresAt">,
): RedemptionStatus {
  if (redemption.status === "USED") {
    return "used";
  }

  if (redemption.status === "DISABLED") {
    return "disabled";
  }

  if (redemption.expiresAt && redemption.expiresAt <= new Date()) {
    return "expired";
  }

  return "active";
}

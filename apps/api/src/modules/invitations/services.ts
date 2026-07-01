import { createHash, randomInt } from "node:crypto";
import type { Invitation, User } from "../../utils/prisma";
import { prisma } from "../../utils/prisma";
import { hashPassword } from "../auth/password";
import { isUniqueConstraintError } from "../auth/utils";
import { buildApiKeyModelAccess, generateApiKey } from "../keys/services";
import type { InvitationSummary, InvitationStatus } from "./types";

const CODE_PREFIX = "MUX";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RANDOM_LENGTH = 16;

export class InvalidInvitationCodeError extends Error {
  constructor() {
    super("invalid invitation code");
    this.name = "InvalidInvitationCodeError";
  }
}

export class InvitationNotFoundError extends Error {
  constructor() {
    super("invitation not found");
    this.name = "InvitationNotFoundError";
  }
}

export class InvitationAlreadyRedeemedError extends Error {
  constructor() {
    super("redeemed invitation cannot be revoked");
    this.name = "InvitationAlreadyRedeemedError";
  }
}

export function normalizeInvitationCode(code: string): string {
  return code.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

export function hashInvitationCode(code: string): string {
  return createHash("sha256").update(normalizeInvitationCode(code)).digest("hex");
}

export function generateInvitationCode(): { raw: string; hashed: string; lastFour: string } {
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
    hashed: hashInvitationCode(normalized),
    lastFour: normalized.slice(-4),
  };
}

export async function createInvitation(createdBy: string, balanceUsd?: number | null) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateInvitationCode();

    try {
      const invitation = await prisma.invitation.create({
        data: {
          codeHash: code.hashed,
          codeLastFour: code.lastFour,
          balanceUsd: balanceUsd ?? null,
          createdBy,
        },
        include: invitationSummaryInclude,
      });

      return { invitation: toInvitationSummary(invitation), code: code.raw };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("failed to generate unique invitation code");
}

export async function listInvitations(): Promise<InvitationSummary[]> {
  const invitations = await prisma.invitation.findMany({
    include: invitationSummaryInclude,
    orderBy: { createdAt: "desc" },
  });

  return invitations.map(toInvitationSummary);
}

export async function revokeInvitation(id: string): Promise<InvitationSummary> {
  const invitation = await prisma.invitation.findUnique({
    where: { id },
    include: invitationSummaryInclude,
  });

  if (!invitation) {
    throw new InvitationNotFoundError();
  }

  if (invitation.redeemedAt) {
    throw new InvitationAlreadyRedeemedError();
  }

  const updated = await prisma.invitation.update({
    where: { id },
    data: { isActive: false },
    include: invitationSummaryInclude,
  });

  return toInvitationSummary(updated);
}

export async function redeemInvitation(input: {
  invitationCode: string;
  email: string;
  password: string;
  name: string | null;
}): Promise<{
  user: User;
  apiKey: { id: string; key: string; spendLimitUsd: number | null };
}> {
  const codeHash = hashInvitationCode(input.invitationCode);
  const modelAccess = await buildApiKeyModelAccess({ mode: "snapshot" });

  return prisma.$transaction(async (tx) => {
    const invitation = await tx.invitation.findUnique({ where: { codeHash } });

    if (!invitation?.isActive || invitation.redeemedAt) {
      throw new InvalidInvitationCodeError();
    }

    const claimed = await tx.invitation.updateMany({
      where: {
        id: invitation.id,
        isActive: true,
        redeemedAt: null,
      },
      data: { isActive: false },
    });

    if (claimed.count !== 1) {
      throw new InvalidInvitationCodeError();
    }

    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
        role: "USER",
      },
    });

    const apiKey = generateApiKey();
    const createdApiKey = await tx.apiKey.create({
      data: {
        name: `${input.email} invite key`,
        key: apiKey.hashed,
        createdBy: user.id,
        spendLimitUsd: invitation.balanceUsd,
        allowAllModels: modelAccess.allowAllModels,
        includeFutureModels: modelAccess.includeFutureModels,
        allowedModelIds: modelAccess.allowedModelIds,
        invitationId: invitation.id,
      },
    });

    await tx.invitation.update({
      where: { id: invitation.id },
      data: {
        redeemedBy: user.id,
        redeemedAt: new Date(),
      },
    });

    return {
      user,
      apiKey: {
        id: createdApiKey.id,
        key: apiKey.raw,
        spendLimitUsd: createdApiKey.spendLimitUsd,
      },
    };
  });
}

const invitationSummaryInclude = {
  creator: { select: { email: true } },
  redeemer: { select: { email: true } },
} as const;

type InvitationWithSummaryRelations = Invitation & {
  creator: { email: string };
  redeemer: { email: string } | null;
};

function toInvitationSummary(invitation: InvitationWithSummaryRelations): InvitationSummary {
  return {
    id: invitation.id,
    codeLastFour: invitation.codeLastFour,
    balanceUsd: invitation.balanceUsd,
    isActive: invitation.isActive,
    status: getInvitationStatus(invitation),
    createdAt: invitation.createdAt,
    updatedAt: invitation.updatedAt,
    redeemedAt: invitation.redeemedAt,
    creator: invitation.creator,
    redeemer: invitation.redeemer,
  };
}

function getInvitationStatus(
  invitation: Pick<Invitation, "isActive" | "redeemedAt">,
): InvitationStatus {
  if (invitation.redeemedAt) {
    return "redeemed";
  }

  return invitation.isActive ? "pending" : "revoked";
}

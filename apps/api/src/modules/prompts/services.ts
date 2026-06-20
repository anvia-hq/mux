import type { Prisma } from "@prisma/client";
import { prisma } from "../../utils/prisma";

export async function listPrompts() {
  return prisma.prompt.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { versions: true } },
      activeVersion: { select: { id: true, version: true, model: true } },
      creator: { select: { email: true } },
    },
  });
}

export async function getPromptWithVersions(promptId: string) {
  return prisma.prompt.findUnique({
    where: { id: promptId },
    include: {
      activeVersion: true,
      versions: {
        orderBy: { version: "desc" },
        include: {
          creator: { select: { email: true } },
        },
      },
      creator: { select: { email: true } },
    },
  });
}

export async function createPromptWithFirstVersion(input: {
  name: string;
  description: string | null;
  content: string;
  model: string | null;
  temperature: number | null;
  notes: string | null;
  userId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const prompt = await tx.prompt.create({
      data: {
        name: input.name,
        description: input.description,
        createdBy: input.userId,
      },
    });

    const version = await tx.promptVersion.create({
      data: {
        promptId: prompt.id,
        version: 1,
        content: input.content,
        model: input.model,
        temperature: input.temperature,
        notes: input.notes,
        createdBy: input.userId,
      },
    });

    return tx.prompt.update({
      where: { id: prompt.id },
      data: { activeVersionId: version.id },
      include: { activeVersion: true },
    });
  });
}

export async function addPromptVersion(input: {
  promptId: string;
  content: string;
  model: string | null;
  temperature: number | null;
  notes: string | null;
  userId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const latest = await tx.promptVersion.findFirst({
      where: { promptId: input.promptId },
      orderBy: { version: "desc" },
      select: { version: true },
    });

    const nextVersion = (latest?.version ?? 0) + 1;

    return tx.promptVersion.create({
      data: {
        promptId: input.promptId,
        version: nextVersion,
        content: input.content,
        model: input.model,
        temperature: input.temperature,
        notes: input.notes,
        createdBy: input.userId,
      },
    });
  });
}

export async function setActiveVersion(promptId: string, versionId: string) {
  const version = await prisma.promptVersion.findFirst({
    where: { id: versionId, promptId },
    select: { id: true },
  });

  if (!version) {
    return null;
  }

  return prisma.prompt.update({
    where: { id: promptId },
    data: { activeVersionId: versionId },
    include: { activeVersion: true },
  });
}

export type PromptWithCounts = Prisma.PromptGetPayload<{
  include: {
    _count: { select: { versions: true } };
    activeVersion: { select: { id: true; version: true; model: true } };
    creator: { select: { email: true } };
  };
}>;

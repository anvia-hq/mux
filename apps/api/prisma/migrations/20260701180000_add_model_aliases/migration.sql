CREATE TABLE "ModelAlias" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "targetModelId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ModelAlias_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ModelAlias_enabled_idx" ON "ModelAlias"("enabled");
CREATE INDEX "ModelAlias_targetModelId_idx" ON "ModelAlias"("targetModelId");

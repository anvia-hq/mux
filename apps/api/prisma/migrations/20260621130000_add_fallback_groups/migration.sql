-- CreateTable
CREATE TABLE "FallbackGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FallbackGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FallbackTarget" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FallbackTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FallbackTarget_groupId_position_key" ON "FallbackTarget"("groupId", "position");

-- CreateIndex
CREATE INDEX "FallbackTarget_provider_modelId_idx" ON "FallbackTarget"("provider", "modelId");

-- AddForeignKey
ALTER TABLE "FallbackTarget" ADD CONSTRAINT "FallbackTarget_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "FallbackGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "RedemptionCodeStatus" AS ENUM ('ACTIVE', 'DISABLED', 'USED');

-- CreateEnum
CREATE TYPE "RedemptionTargetType" AS ENUM ('USER', 'API_KEY');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "spendLimitUsd" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "RedemptionCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeLastFour" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amountUsd" DOUBLE PRECISION NOT NULL,
    "status" "RedemptionCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RedemptionCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedemptionApplication" (
    "id" TEXT NOT NULL,
    "redemptionCodeId" TEXT NOT NULL,
    "targetType" "RedemptionTargetType" NOT NULL,
    "userId" TEXT,
    "apiKeyId" TEXT,
    "appliedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedemptionApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RedemptionCode_codeHash_key" ON "RedemptionCode"("codeHash");

-- CreateIndex
CREATE INDEX "RedemptionCode_status_idx" ON "RedemptionCode"("status");

-- CreateIndex
CREATE INDEX "RedemptionCode_createdBy_idx" ON "RedemptionCode"("createdBy");

-- CreateIndex
CREATE INDEX "RedemptionCode_expiresAt_idx" ON "RedemptionCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RedemptionApplication_redemptionCodeId_key" ON "RedemptionApplication"("redemptionCodeId");

-- CreateIndex
CREATE INDEX "RedemptionApplication_targetType_idx" ON "RedemptionApplication"("targetType");

-- CreateIndex
CREATE INDEX "RedemptionApplication_userId_idx" ON "RedemptionApplication"("userId");

-- CreateIndex
CREATE INDEX "RedemptionApplication_apiKeyId_idx" ON "RedemptionApplication"("apiKeyId");

-- CreateIndex
CREATE INDEX "RedemptionApplication_appliedBy_idx" ON "RedemptionApplication"("appliedBy");

-- AddForeignKey
ALTER TABLE "RedemptionCode" ADD CONSTRAINT "RedemptionCode_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedemptionApplication" ADD CONSTRAINT "RedemptionApplication_redemptionCodeId_fkey" FOREIGN KEY ("redemptionCodeId") REFERENCES "RedemptionCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedemptionApplication" ADD CONSTRAINT "RedemptionApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedemptionApplication" ADD CONSTRAINT "RedemptionApplication_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedemptionApplication" ADD CONSTRAINT "RedemptionApplication_appliedBy_fkey" FOREIGN KEY ("appliedBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

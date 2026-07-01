CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeLastFour" TEXT NOT NULL,
    "balanceUsd" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "redeemedBy" TEXT,
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Invitation_codeHash_key" ON "Invitation"("codeHash");
CREATE INDEX "Invitation_isActive_idx" ON "Invitation"("isActive");
CREATE INDEX "Invitation_createdBy_idx" ON "Invitation"("createdBy");
CREATE INDEX "Invitation_redeemedBy_idx" ON "Invitation"("redeemedBy");

ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_redeemedBy_fkey" FOREIGN KEY ("redeemedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ApiKey" ADD COLUMN "invitationId" TEXT;
CREATE INDEX "ApiKey_invitationId_idx" ON "ApiKey"("invitationId");
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "Invitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

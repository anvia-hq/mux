ALTER TABLE "Invitation" ADD COLUMN "maxRedemptions" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Invitation" ADD COLUMN "redeemedCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "Invitation"
SET "redeemedCount" = 1,
    "isActive" = false
WHERE "redeemedAt" IS NOT NULL;

CREATE TABLE "InvitationRedemption" (
    "id" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "userId" TEXT,
    "apiKeyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvitationRedemption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL,
    "inviteRegistrationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AppSetting" ("id", "inviteRegistrationEnabled", "updatedAt")
VALUES ('default', true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "InvitationRedemption" ("id", "invitationId", "userId", "apiKeyId", "createdAt")
SELECT
    'redemption_' || substr(md5(random()::text || "Invitation"."id" || clock_timestamp()::text), 1, 24),
    "Invitation"."id",
    "Invitation"."redeemedBy",
    (
        SELECT "ApiKey"."id"
        FROM "ApiKey"
        WHERE "ApiKey"."invitationId" = "Invitation"."id"
        ORDER BY "ApiKey"."createdAt" ASC
        LIMIT 1
    ),
    COALESCE("Invitation"."redeemedAt", "Invitation"."updatedAt", CURRENT_TIMESTAMP)
FROM "Invitation"
WHERE "Invitation"."redeemedAt" IS NOT NULL;

CREATE UNIQUE INDEX "InvitationRedemption_apiKeyId_key" ON "InvitationRedemption"("apiKeyId");
CREATE INDEX "InvitationRedemption_invitationId_idx" ON "InvitationRedemption"("invitationId");
CREATE INDEX "InvitationRedemption_userId_idx" ON "InvitationRedemption"("userId");

ALTER TABLE "InvitationRedemption" ADD CONSTRAINT "InvitationRedemption_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "Invitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvitationRedemption" ADD CONSTRAINT "InvitationRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvitationRedemption" ADD CONSTRAINT "InvitationRedemption_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

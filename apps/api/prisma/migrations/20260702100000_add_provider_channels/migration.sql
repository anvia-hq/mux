CREATE TABLE "ProviderChannel" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "keyCiphertext" TEXT NOT NULL,
    "lastFour" TEXT NOT NULL,
    "modelMapping" JSONB,
    "settings" JSONB,
    "otherSettings" JSONB,
    "paramOverride" JSONB,
    "headerOverride" JSONB,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderChannel_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProviderChannel_provider_idx" ON "ProviderChannel"("provider");
CREATE INDEX "ProviderChannel_enabled_priority_idx" ON "ProviderChannel"("enabled", "priority");

ALTER TABLE "ProviderChannel" ADD CONSTRAINT "ProviderChannel_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderChannel" ADD CONSTRAINT "ProviderChannel_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ProviderChannel" (
    "id",
    "provider",
    "name",
    "enabled",
    "priority",
    "weight",
    "keyCiphertext",
    "lastFour",
    "createdBy",
    "updatedBy",
    "createdAt",
    "updatedAt"
)
SELECT
    "provider",
    "provider",
    "provider",
    true,
    0,
    1,
    "ciphertext",
    "lastFour",
    "updatedBy",
    "updatedBy",
    "createdAt",
    "updatedAt"
FROM "ProviderKey"
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "RequestLog" ADD COLUMN "channelId" TEXT;
ALTER TABLE "RequestLog" ADD COLUMN "channelName" TEXT;
CREATE INDEX "RequestLog_channelId_idx" ON "RequestLog"("channelId");

ALTER TABLE "BackgroundResponseJob" ADD COLUMN "channelId" TEXT;
ALTER TABLE "BackgroundResponseJob" ADD COLUMN "channelName" TEXT;
CREATE INDEX "BackgroundResponseJob_channelId_idx" ON "BackgroundResponseJob"("channelId");

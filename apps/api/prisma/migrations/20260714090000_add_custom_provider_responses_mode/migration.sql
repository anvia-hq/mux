CREATE TYPE "ResponsesMode" AS ENUM ('DISABLED', 'NATIVE', 'VIA_CHAT');

ALTER TABLE "CustomProvider"
ADD COLUMN "responsesMode" "ResponsesMode" NOT NULL DEFAULT 'DISABLED',
ADD COLUMN "responsesEndpoint" TEXT;

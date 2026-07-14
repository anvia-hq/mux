ALTER TABLE "BackgroundResponseJob"
ADD COLUMN "upstreamUrl" TEXT,
ADD COLUMN "spendReservationId" TEXT,
ADD COLUMN "spendReservedUsd" DOUBLE PRECISION,
ADD COLUMN "spendOwnerId" TEXT;

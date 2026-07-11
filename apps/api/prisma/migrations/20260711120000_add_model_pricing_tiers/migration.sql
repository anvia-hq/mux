ALTER TABLE "CustomProviderModel"
ADD COLUMN "pricingTiers" JSONB;

ALTER TABLE "BackgroundResponseJob"
ADD COLUMN "pricingTiers" JSONB;

ALTER TABLE "RequestLog"
ADD COLUMN "pricingInputTokens" INTEGER,
ADD COLUMN "appliedInputPricePer1M" DOUBLE PRECISION,
ADD COLUMN "appliedOutputPricePer1M" DOUBLE PRECISION,
ADD COLUMN "appliedPricingTierThreshold" INTEGER;

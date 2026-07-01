-- CreateTable
CREATE TABLE "CustomProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiBase" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomProviderModel" (
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inputPricePer1M" DOUBLE PRECISION NOT NULL,
    "outputPricePer1M" DOUBLE PRECISION NOT NULL,
    "contextWindow" INTEGER NOT NULL,
    "maxOutputTokens" INTEGER NOT NULL,
    "inputModalities" TEXT[] NOT NULL,
    "outputModalities" TEXT[] NOT NULL,
    "reasoning" BOOLEAN NOT NULL,
    "toolCall" BOOLEAN NOT NULL,
    "structuredOutput" BOOLEAN NOT NULL,
    "weights" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomProviderModel_pkey" PRIMARY KEY ("providerId","modelId")
);

-- CreateIndex
CREATE INDEX "CustomProvider_createdBy_idx" ON "CustomProvider"("createdBy");

-- AddForeignKey
ALTER TABLE "CustomProvider" ADD CONSTRAINT "CustomProvider_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomProviderModel" ADD CONSTRAINT "CustomProviderModel_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "CustomProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

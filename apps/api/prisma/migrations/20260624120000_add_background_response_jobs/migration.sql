-- CreateTable
CREATE TABLE "BackgroundResponseJob" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "response" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BackgroundResponseJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackgroundResponseJob_apiKeyId_idx" ON "BackgroundResponseJob"("apiKeyId");

-- CreateIndex
CREATE INDEX "BackgroundResponseJob_status_idx" ON "BackgroundResponseJob"("status");

-- CreateIndex
CREATE INDEX "BackgroundResponseJob_createdAt_idx" ON "BackgroundResponseJob"("createdAt");

-- AddForeignKey
ALTER TABLE "BackgroundResponseJob" ADD CONSTRAINT "BackgroundResponseJob_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

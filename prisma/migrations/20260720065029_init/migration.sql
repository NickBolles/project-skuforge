-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "planUpdatedAt" DATETIME,
    "settings" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" DATETIME
);

-- CreateTable
CREATE TABLE "SkuRuleSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "config" TEXT NOT NULL DEFAULT '{}',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SkuRuleSet_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SequenceCounter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "SequenceCounter_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobLock" (
    "shopId" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "acquiredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GenerationJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "ruleSetId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "fields" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "idempotencyKey" TEXT NOT NULL,
    "totals" TEXT NOT NULL DEFAULT '{}',
    "cursor" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "GenerationJob_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GenerationJobItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "proposedSku" TEXT,
    "proposedBarcode" TEXT,
    "expectedSku" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "message" TEXT,
    CONSTRAINT "GenerationJobItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DuplicateScan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "totals" TEXT NOT NULL DEFAULT '{}',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "DuplicateScan_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScanFinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scanId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "skuValue" TEXT,
    "variants" TEXT NOT NULL,
    "resolution" TEXT NOT NULL DEFAULT 'open',
    "resolvedAt" DATETIME,
    CONSTRAINT "ScanFinding_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "DuplicateScan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabelTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "geometry" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabelTemplate_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");

-- CreateIndex
CREATE INDEX "SkuRuleSet_shopId_idx" ON "SkuRuleSet"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceCounter_shopId_key_key" ON "SequenceCounter"("shopId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationJob_idempotencyKey_key" ON "GenerationJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "GenerationJob_shopId_status_idx" ON "GenerationJob"("shopId", "status");

-- CreateIndex
CREATE INDEX "GenerationJobItem_jobId_status_idx" ON "GenerationJobItem"("jobId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationJobItem_jobId_variantId_key" ON "GenerationJobItem"("jobId", "variantId");

-- CreateIndex
CREATE INDEX "DuplicateScan_shopId_startedAt_idx" ON "DuplicateScan"("shopId", "startedAt");

-- CreateIndex
CREATE INDEX "ScanFinding_scanId_kind_resolution_idx" ON "ScanFinding"("scanId", "kind", "resolution");

-- CreateIndex
CREATE INDEX "LabelTemplate_shopId_idx" ON "LabelTemplate"("shopId");

-- CreateIndex
CREATE INDEX "WebhookEvent_shopId_idx" ON "WebhookEvent"("shopId");

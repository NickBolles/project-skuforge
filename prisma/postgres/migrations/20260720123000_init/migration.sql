-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "planUpdatedAt" TIMESTAMP(3),
    "settings" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkuRuleSet" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "config" TEXT NOT NULL DEFAULT '{}',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkuRuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceCounter" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SequenceCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobLock" (
    "shopId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobLock_pkey" PRIMARY KEY ("shopId")
);

-- CreateTable
CREATE TABLE "GenerationJob" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "ruleSetId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "fields" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "idempotencyKey" TEXT NOT NULL,
    "totals" TEXT NOT NULL DEFAULT '{}',
    "cursor" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "GenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationJobItem" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "proposedSku" TEXT,
    "proposedBarcode" TEXT,
    "expectedSku" TEXT,
    "expectedBarcode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "message" TEXT,

    CONSTRAINT "GenerationJobItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateScan" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "totals" TEXT NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DuplicateScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanFinding" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "skuValue" TEXT,
    "variants" TEXT NOT NULL,
    "resolution" TEXT NOT NULL DEFAULT 'open',
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ScanFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabelTemplate" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "geometry" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabelTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
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

-- AddForeignKey
ALTER TABLE "SkuRuleSet" ADD CONSTRAINT "SkuRuleSet_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceCounter" ADD CONSTRAINT "SequenceCounter_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJobItem" ADD CONSTRAINT "GenerationJobItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateScan" ADD CONSTRAINT "DuplicateScan_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanFinding" ADD CONSTRAINT "ScanFinding_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "DuplicateScan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelTemplate" ADD CONSTRAINT "LabelTemplate_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

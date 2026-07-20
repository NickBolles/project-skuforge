import type { PrismaClient } from "@prisma/client";
import type { ShopifyCatalog } from "../adapters/shopify/catalog";
import { scanCatalog } from "../core/validate";

type VerificationDb = Pick<PrismaClient, "duplicateScan" | "scanFinding">;

export async function verifyGenerationRun(options: {
  db: VerificationDb;
  catalog: ShopifyCatalog;
  shopId: string;
}) {
  const persisted = await options.db.duplicateScan.create({
    data: { shopId: options.shopId, trigger: "post_generation", status: "running" },
  });
  try {
    const result = await scanCatalog(options.catalog.streamAllVariants({ batchSize: 250 }));
    const duplicateFindings = result.findings.filter(
      (finding): finding is Extract<(typeof result.findings)[number], { kind: "duplicate" | "duplicate_barcode" }> =>
        finding.kind === "duplicate" || finding.kind === "duplicate_barcode",
    );
    if (duplicateFindings.length) {
      await options.db.scanFinding.createMany({
        data: duplicateFindings.map((finding) => ({
          scanId: persisted.id,
          kind: finding.kind,
          skuValue: finding.normalizedValue,
          variants: JSON.stringify(finding.variants),
        })),
      });
    }
    await options.db.duplicateScan.update({
      where: { id: persisted.id },
      data: { status: "completed", totals: JSON.stringify(result.summary), finishedAt: new Date() },
    });
    return { scanId: persisted.id, ...result };
  } catch (error) {
    await options.db.duplicateScan.update({
      where: { id: persisted.id },
      data: { status: "failed", finishedAt: new Date() },
    });
    throw error;
  }
}

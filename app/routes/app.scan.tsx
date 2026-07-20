import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";
import { FindingCard } from "../components/FindingCard";
import { getAppContext } from "../services/context.server";
import { ensureShop } from "../services/rules.server";
import { fixFinding, getLatestScan, ignoreFinding, previewFindingFix, runScan } from "../services/scan.server";
import { can, entitlementResponse, enforceEntitlement } from "../services/entitlements.server";
import { PlanGate } from "../components/PlanGate";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, db, billing } = await getAppContext(request);
  const shop = await ensureShop(db, session.shop);
  const [scan, defaultRule] = await Promise.all([
    getLatestScan(db, session.shop),
    db.skuRuleSet.findFirst({ where: { shopId: shop.id, isDefault: true, active: true }, select: { id: true, name: true } }),
  ]);
  const plan = await billing.getPlan(session.shop);
  return { scan, defaultRule, plan, canScan: can(plan, "duplicate_scanning") };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { session, db, catalog, billing } = await getAppContext(request);
    await enforceEntitlement(billing, session.shop, "duplicate_scanning");
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "scan");
    if (intent === "ignore") {
      await ignoreFinding(db, session.shop, String(form.get("findingId") ?? ""));
      return { ok: true, message: "Finding ignored." };
    }
    if (intent === "fix") {
      const result = await fixFinding({ db, catalog, shopDomain: session.shop, findingId: String(form.get("findingId") ?? "") });
      return result.job.status === "completed"
        ? { ok: true, message: "Finding fixed and the catalog verification scan completed." }
        : { ok: false, message: "The fix did not fully apply. The finding remains open; review the job results and retry." };
    }
    if (intent === "preview_fix") {
      const findingId = String(form.get("findingId") ?? "");
      const job = await previewFindingFix({ db, catalog, shopDomain: session.shop, findingId });
      return {
        ok: true,
        message: "Review the proposed SKU changes, then confirm to apply them.",
        preview: {
          findingId,
          jobId: job.id,
          items: job.items.map((item) => ({ variantId: item.variantId, proposedSku: item.proposedSku })),
        },
      };
    }
    await runScan({ db, catalog, shopDomain: session.shop, trigger: "manual" });
    return { ok: true, message: "Catalog scan completed." };
  } catch (error) {
    const response = entitlementResponse(error);
    if (response) return response;
    return { ok: false, message: error instanceof Error ? error.message : "Scan action failed." };
  }
};

export function ScanPage({ data, actionResult }: { data: Awaited<ReturnType<typeof loader>>; actionResult?: Awaited<ReturnType<typeof action>> }) {
  const { scan, defaultRule, canScan } = data;
  const duplicateCount = scan?.summary.duplicateGroups;
  const fixPreview = actionResult && !(actionResult instanceof Response) && "preview" in actionResult
    ? actionResult.preview
    : undefined;
  return (
    <s-page heading="Duplicate and malformed SKU scan">
      <s-section heading="Catalog health">
        <p style={{ color: duplicateCount === 0 ? "#087f5b" : "#c92a2a", fontSize: 28, fontWeight: 700 }}>
          {scan ? (duplicateCount === 0 ? "0 duplicate SKUs" : `${duplicateCount} duplicate SKU groups`) : "Scan required"}
        </p>
        <p>{scan ? `Verified ${scan.summary.variantsScanned} variants on ${scan.finishedAt?.toISOString()}.` : "Run a catalog scan to establish the real duplicate count."}</p>
        <PlanGate allowed={canScan} requiredPlan="pro"><form method="post"><button type="submit" name="intent" value="scan">Scan catalog now</button></form></PlanGate>
      </s-section>
      <s-section heading="Open findings">
        {scan?.findings.length ? scan.findings.map((finding) => <FindingCard key={finding.id} finding={finding} canFix={canScan && Boolean(defaultRule)} preview={fixPreview?.findingId === finding.id ? fixPreview : undefined} />) : <p>No open findings in the latest scan.</p>}
      </s-section>
    </s-page>
  );
}

export default function ScanRoute() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return <>{result ? <p role={result.ok ? "status" : "alert"}>{result.message}</p> : null}<ScanPage data={data} actionResult={result} /></>;
}

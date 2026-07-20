import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getAppContext } from "../services/context.server";
import { getLatestScan } from "../services/scan.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, catalog, billing, authMode, db } = await getAppContext(request);
  const latestScan = await getLatestScan(db, session.shop);
  return {
    shopDomain: session.shop,
    plan: await billing.getPlan(session.shop),
    variantCount: await catalog.countVariants(),
    authMode,
    scan: latestScan ? { summary: latestScan.summary, finishedAt: latestScan.finishedAt } : null,
  };
};

export function Dashboard({ data }: { data: Awaited<ReturnType<typeof loader>> }) {
  if (data.authMode === "mock") {
    return (
      <section style={{ fontFamily: "Inter, sans-serif", margin: "3rem auto", maxWidth: 720 }}>
        <h1>SKUForge</h1>
        <p>Shop: {data.shopDomain}</p>
        <p>Plan: {data.plan}</p>
        <p>Catalog variants: {data.variantCount}</p>
        <h2 style={{ color: data.scan?.summary.duplicateGroups === 0 ? "#087f5b" : "#c92a2a" }}>{data.scan ? (data.scan.summary.duplicateGroups === 0 ? "0 duplicate SKUs" : `${data.scan.summary.duplicateGroups} duplicate SKU groups`) : "Duplicate scan required"}</h2>
        <p><a href="/app/scan">Scan and fix catalog</a></p>
        <p><a href="/app/rules">Manage SKU rules</a></p>
        <p><a href="/app/generate">Generate missing SKUs</a></p>
        <p><a href="/app/editor">Bulk editor</a></p>
        <p><a href="/app/csv">CSV export/import</a></p>
      </section>
    );
  }

  return (
    <s-page heading="SKUForge">
      <s-section heading="Catalog status">
        <s-paragraph>Shop: {data.shopDomain}</s-paragraph>
        <s-paragraph>Plan: {data.plan}</s-paragraph>
        <s-paragraph>Catalog variants: {data.variantCount}</s-paragraph>
        <s-heading>{data.scan ? (data.scan.summary.duplicateGroups === 0 ? "0 duplicate SKUs" : `${data.scan.summary.duplicateGroups} duplicate SKU groups`) : "Duplicate scan required"}</s-heading>
        <s-link href="/app/scan">Scan and fix catalog</s-link>
        <s-link href="/app/rules">Manage SKU rules</s-link>
        <s-link href="/app/generate">Generate missing SKUs</s-link>
        <s-link href="/app/editor">Bulk editor</s-link>
        <s-link href="/app/csv">CSV export/import</s-link>
      </s-section>
    </s-page>
  );
}

export default function Index() {
  return <Dashboard data={useLoaderData<typeof loader>()} />;
}

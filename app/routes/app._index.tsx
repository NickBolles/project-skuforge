import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getAppContext } from "../services/context.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, catalog, billing, authMode } = await getAppContext(request);
  return {
    shopDomain: session.shop,
    plan: await billing.getPlan(session.shop),
    variantCount: await catalog.countVariants(),
    authMode,
  };
};

export default function Index() {
  const data = useLoaderData<typeof loader>();

  if (data.authMode === "mock") {
    return (
      <section style={{ fontFamily: "Inter, sans-serif", margin: "3rem auto", maxWidth: 720 }}>
        <h1>SKUForge</h1>
        <p>Shop: {data.shopDomain}</p>
        <p>Plan: {data.plan}</p>
        <p>Catalog variants: {data.variantCount}</p>
        <p><a href="/app/rules">Manage SKU rules</a></p>
        <p><a href="/app/generate">Generate missing SKUs</a></p>
      </section>
    );
  }

  return (
    <s-page heading="SKUForge">
      <s-section heading="Catalog status">
        <s-paragraph>Shop: {data.shopDomain}</s-paragraph>
        <s-paragraph>Plan: {data.plan}</s-paragraph>
        <s-paragraph>Catalog variants: {data.variantCount}</s-paragraph>
        <s-link href="/app/rules">Manage SKU rules</s-link>
        <s-link href="/app/generate">Generate missing SKUs</s-link>
      </s-section>
    </s-page>
  );
}

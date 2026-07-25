import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import type React from "react";
import type { BillingPlan } from "../core/constants";
import type { ScanSummary } from "../core/validate";
import { getAppContext } from "../services/context.server";
import { can } from "../services/entitlements.server";
import { ensureShop } from "../services/rules.server";
import { getLatestScan } from "../services/scan.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, catalog, billing, authMode, db } = await getAppContext(request);
  const shop = await ensureShop(db, session.shop);
  const [latestScan, defaultRule, plan, variantCount] = await Promise.all([
    getLatestScan(db, session.shop),
    db.skuRuleSet.findFirst({ where: { shopId: shop.id, isDefault: true, active: true }, select: { id: true } }),
    billing.getPlan(session.shop),
    catalog.countVariants(),
  ]);
  return {
    shopDomain: session.shop,
    plan,
    variantCount,
    authMode,
    hasDefaultRule: Boolean(defaultRule),
    features: {
      scan: can(plan, "duplicate_scanning"),
      labels: can(plan, "label_printing"),
      csv: can(plan, "csv_workflows"),
    },
    scan: latestScan ? { summary: latestScan.summary, finishedAt: latestScan.finishedAt } : null,
  };
};

export interface DashboardData {
  shopDomain: string;
  plan: BillingPlan;
  variantCount: number;
  authMode: string;
  hasDefaultRule: boolean;
  features: { scan: boolean; labels: boolean; csv: boolean };
  scan: { summary: ScanSummary; finishedAt: Date | string | null } | null;
}

export type DashboardTone = "success" | "critical" | "warning" | "info";

export interface DashboardViewModel {
  hero: { tone: DashboardTone; headline: string; subtext: string };
  nextStep: { tone: DashboardTone; title: string; description: string; cta: string; href: string };
  setupSteps: { label: string; done: boolean; href: string }[];
  setupComplete: boolean;
  stats: { label: string; value: string; hint?: string }[];
  quickActions: { title: string; description: string; href: string; badge?: string }[];
}

export function formatScanTime(value: Date | string | null): string {
  if (!value) return "recently";
  const date = typeof value === "string" ? new Date(value) : value;
  const formatted = date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  });
  return `${formatted} UTC`;
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

export function deriveDashboard(data: DashboardData): DashboardViewModel {
  const summary = data.scan?.summary ?? null;
  const hasScan = summary !== null;
  const issueGroups = summary ? summary.duplicateGroups + summary.duplicateBarcodeGroups + summary.malformed : 0;
  const missingSku = summary?.missingSku ?? 0;
  const missingBarcode = summary?.missingBarcode ?? 0;
  const gapsResolved = hasScan && issueGroups === 0 && missingSku === 0 && missingBarcode === 0;

  const hero: DashboardViewModel["hero"] = !summary
    ? {
      tone: "info",
      headline: "Scan required",
      subtext: "Run a catalog scan to establish the real duplicate count across every variant.",
    }
    : issueGroups === 0
      ? {
        tone: "success",
        headline: "0 duplicate SKUs",
        subtext: `Verified ${summary.variantsScanned.toLocaleString("en-US")} variants · last scanned ${formatScanTime(data.scan?.finishedAt ?? null)}.`,
      }
      : {
        tone: "critical",
        headline: `${issueGroups} ${pluralize(issueGroups, "issue needs", "issues need")} attention`,
        subtext: `${summary.duplicateGroups} duplicate SKU ${pluralize(summary.duplicateGroups, "group", "groups")}, ${summary.duplicateBarcodeGroups} duplicate barcode ${pluralize(summary.duplicateBarcodeGroups, "group", "groups")}, and ${summary.malformed} malformed ${pluralize(summary.malformed, "value", "values")} · last scanned ${formatScanTime(data.scan?.finishedAt ?? null)}.`,
      };

  const nextStep: DashboardViewModel["nextStep"] = !data.hasDefaultRule
    ? {
      tone: "warning",
      title: "Create your SKU rule",
      description: "A default rule powers SKU generation, one-click fixes, and malformed-value detection. It takes about a minute.",
      cta: "Set up your rule",
      href: "/app/rules",
    }
    : !hasScan
      ? {
        tone: "info",
        title: "Run your first catalog scan",
        description: "The scan finds duplicate and malformed SKUs and barcodes so you know exactly where your catalog stands.",
        cta: "Scan the catalog",
        href: "/app/scan",
      }
      : issueGroups > 0
        ? {
          tone: "critical",
          title: `Review and fix ${issueGroups} open ${pluralize(issueGroups, "finding", "findings")}`,
          description: "Each finding shows a previewed, collision-safe fix. Nothing is written to Shopify until you confirm.",
          cta: "Review findings",
          href: "/app/scan",
        }
        : missingSku > 0
          ? {
            tone: "warning",
            title: `Generate SKUs for ${missingSku.toLocaleString("en-US")} ${pluralize(missingSku, "variant", "variants")}`,
            description: "Fill every missing SKU from your rule. You will see a full preview before anything is applied.",
            cta: "Generate SKUs",
            href: "/app/generate",
          }
          : missingBarcode > 0
            ? {
              tone: "warning",
              title: `Generate barcodes for ${missingBarcode.toLocaleString("en-US")} ${pluralize(missingBarcode, "variant", "variants")}`,
              description: "Sequential internal Code 128 barcodes fill empty fields only — existing UPC/EAN values are never touched.",
              cta: "Generate barcodes",
              href: "/app/generate",
            }
            : {
              tone: "success",
              title: "Your catalog is healthy",
              description: "Every variant has a unique SKU and a barcode. Nightly scans keep watch — browse the catalog or export a CSV backup.",
              cta: "Browse the catalog",
              href: "/app/editor",
            };

  const setupSteps: DashboardViewModel["setupSteps"] = [
    { label: "Create a default SKU rule", done: data.hasDefaultRule, href: "/app/rules" },
    { label: "Run your first catalog scan", done: hasScan, href: "/app/scan" },
    { label: "Fix findings and fill missing values", done: gapsResolved, href: !hasScan || issueGroups > 0 ? "/app/scan" : "/app/generate" },
  ];

  const stats: DashboardViewModel["stats"] = [
    { label: "Catalog variants", value: data.variantCount.toLocaleString("en-US") },
    { label: "Missing SKUs", value: summary ? summary.missingSku.toLocaleString("en-US") : "—", hint: summary ? undefined : "Run a scan" },
    { label: "Missing barcodes", value: summary ? summary.missingBarcode.toLocaleString("en-US") : "—", hint: summary ? undefined : "Run a scan" },
    { label: "Open issue groups", value: summary ? issueGroups.toLocaleString("en-US") : "—", hint: summary ? undefined : "Run a scan" },
  ];

  const quickActions: DashboardViewModel["quickActions"] = [
    { title: "Browse & edit SKUs", description: "Filter every variant and edit SKUs or barcodes inline.", href: "/app/editor" },
    { title: "Scan & fix duplicates", description: "Find duplicate or malformed values and fix them with one click.", href: "/app/scan", badge: data.features.scan ? undefined : "Pro plan" },
    { title: "Generate SKUs", description: "Fill missing SKUs from your rule, with a preview before writing.", href: "/app/generate" },
    { title: "Generate barcodes", description: "Sequential internal Code 128 barcodes for empty fields only.", href: "/app/generate" },
    { title: "Print labels", description: "PDF label sheets for Avery and common thermal sizes.", href: "/app/labels", badge: data.features.labels ? undefined : "Premium plan" },
    { title: "Export CSV", description: "Download your catalog for spreadsheets or a backup.", href: "/api/csv/export", badge: data.features.csv ? undefined : "Premium plan" },
    { title: "Import CSV", description: "Validate changes for duplicates before Shopify writes.", href: "/app/csv", badge: data.features.csv ? undefined : "Premium plan" },
    { title: "SKU rules", description: "Design the pattern behind every generated SKU.", href: "/app/rules" },
  ];

  return {
    hero,
    nextStep,
    setupSteps,
    setupComplete: setupSteps.every((step) => step.done),
    stats,
    quickActions,
  };
}

const TONE_COLORS: Record<DashboardTone, { fg: string; bg: string; border: string }> = {
  success: { fg: "#087f5b", bg: "#ebfbee", border: "#b2f2bb" },
  critical: { fg: "#c92a2a", bg: "#fff5f5", border: "#ffc9c9" },
  warning: { fg: "#d9480f", bg: "#fff4e6", border: "#ffd8a8" },
  info: { fg: "#1971c2", bg: "#e7f5ff", border: "#a5d8ff" },
};

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #e0e3e7",
  borderRadius: 12,
  padding: "1rem 1.25rem",
};

function MockDashboard({ data, vm }: { data: DashboardData; vm: DashboardViewModel }) {
  const heroColors = TONE_COLORS[vm.hero.tone];
  const nextColors = TONE_COLORS[vm.nextStep.tone];
  return (
    <section style={{ fontFamily: "Inter, -apple-system, 'Segoe UI', sans-serif", margin: "2.5rem auto", maxWidth: 1000, padding: "0 1.5rem", color: "#1f2933", lineHeight: 1.5 }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
        <h1 style={{ margin: 0, fontSize: 28 }}>SKUForge</h1>
        <span style={{ background: "#eef1f4", borderRadius: 999, padding: "0.15rem 0.75rem", fontSize: 13, fontWeight: 600, textTransform: "capitalize" }}>{data.plan} plan</span>
        <span style={{ color: "#5f6b7a", fontSize: 14 }}>{data.shopDomain}</span>
      </header>

      <div role="status" style={{ ...cardStyle, background: heroColors.bg, borderColor: heroColors.border, marginBottom: "1rem" }}>
        <p style={{ margin: 0, color: heroColors.fg, fontSize: 30, fontWeight: 700 }}>{vm.hero.headline}</p>
        <p style={{ margin: "0.35rem 0 0", color: "#3e4c59" }}>{vm.hero.subtext}</p>
        <p style={{ margin: "0.75rem 0 0" }}><a href="/app/scan" style={{ color: heroColors.fg, fontWeight: 600 }}>{data.scan ? "Scan again" : "Scan the catalog"}</a></p>
      </div>

      <div style={{ ...cardStyle, background: nextColors.bg, borderColor: nextColors.border, marginBottom: "1rem" }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: nextColors.fg }}>Recommended next step</p>
        <p style={{ margin: "0.25rem 0 0", fontSize: 18, fontWeight: 600 }}>{vm.nextStep.title}</p>
        <p style={{ margin: "0.25rem 0 0.75rem", color: "#3e4c59" }}>{vm.nextStep.description}</p>
        <a href={vm.nextStep.href} style={{ display: "inline-block", background: nextColors.fg, color: "#ffffff", borderRadius: 8, padding: "0.45rem 1rem", fontWeight: 600, textDecoration: "none" }}>{vm.nextStep.cta}</a>
      </div>

      {!vm.setupComplete ? (
        <div style={{ ...cardStyle, marginBottom: "1rem" }}>
          <h2 style={{ margin: "0 0 0.5rem", fontSize: 16 }}>Get set up</h2>
          <ol style={{ margin: 0, paddingLeft: "1.25rem" }}>
            {vm.setupSteps.map((step) => (
              <li key={step.label} style={{ margin: "0.35rem 0", color: step.done ? "#087f5b" : "#1f2933" }}>
                {step.done ? <span>✓ {step.label}</span> : <a href={step.href} style={{ color: "#1971c2", fontWeight: 600 }}>{step.label}</a>}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
        {vm.stats.map((stat) => (
          <div key={stat.label} style={cardStyle}>
            <p style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{stat.value}</p>
            <p style={{ margin: "0.15rem 0 0", color: "#5f6b7a", fontSize: 13 }}>{stat.label}{stat.hint ? ` · ${stat.hint}` : ""}</p>
          </div>
        ))}
      </div>

      <h2 style={{ margin: "0 0 0.75rem", fontSize: 18 }}>Quick actions</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
        {vm.quickActions.map((action) => (
          <a key={action.title} href={action.href} style={{ ...cardStyle, display: "block", textDecoration: "none", color: "inherit" }}>
            <p style={{ margin: 0, fontWeight: 600, color: "#1971c2" }}>
              {action.title}
              {action.badge ? <span style={{ display: "inline-block", whiteSpace: "nowrap", marginLeft: "0.5rem", background: "#fff4e6", border: "1px solid #ffd8a8", color: "#d9480f", borderRadius: 999, padding: "0.05rem 0.5rem", fontSize: 12, fontWeight: 600, verticalAlign: "middle" }}>{action.badge}</span> : null}
            </p>
            <p style={{ margin: "0.25rem 0 0", color: "#5f6b7a", fontSize: 14 }}>{action.description}</p>
          </a>
        ))}
      </div>

      <footer style={{ color: "#5f6b7a", fontSize: 14 }}>
        {data.shopDomain} · {data.plan} plan · <a href="/app/billing" style={{ color: "#1971c2" }}>View plans and billing</a>
      </footer>
    </section>
  );
}

function EmbeddedDashboard({ data, vm }: { data: DashboardData; vm: DashboardViewModel }) {
  return (
    <s-page heading="SKUForge">
      <s-section heading="Catalog health">
        <s-banner tone={vm.hero.tone} heading={vm.hero.headline}>
          <s-paragraph>{vm.hero.subtext}</s-paragraph>
        </s-banner>
        <s-button href="/app/scan" variant="secondary">{data.scan ? "Scan again" : "Scan the catalog"}</s-button>
      </s-section>

      <s-section heading="Recommended next step">
        <s-banner tone={vm.nextStep.tone} heading={vm.nextStep.title}>
          <s-paragraph>{vm.nextStep.description}</s-paragraph>
        </s-banner>
        <s-button href={vm.nextStep.href} variant="primary">{vm.nextStep.cta}</s-button>
      </s-section>

      {!vm.setupComplete ? (
        <s-section heading="Get set up">
          <s-ordered-list>
            {vm.setupSteps.map((step) => (
              <s-list-item key={step.label}>
                {step.done ? <s-text>✓ {step.label}</s-text> : <s-link href={step.href}>{step.label}</s-link>}
              </s-list-item>
            ))}
          </s-ordered-list>
        </s-section>
      ) : null}

      <s-section heading="Catalog at a glance">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
          {vm.stats.map((stat) => (
            <s-stack key={stat.label}>
              <s-heading>{stat.value}</s-heading>
              <s-text>{stat.label}{stat.hint ? ` · ${stat.hint}` : ""}</s-text>
            </s-stack>
          ))}
        </s-grid>
      </s-section>

      <s-section heading="Quick actions">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
          {vm.quickActions.map((action) => (
            <s-stack key={action.title} gap="small-200">
              <s-link href={action.href}>{action.title}</s-link>
              {action.badge ? <s-badge tone="warning">{action.badge}</s-badge> : null}
              <s-text>{action.description}</s-text>
            </s-stack>
          ))}
        </s-grid>
      </s-section>

      <s-section heading="Plan">
        <s-paragraph>{data.shopDomain} · {data.plan} plan</s-paragraph>
        <s-link href="/app/billing">View plans and billing</s-link>
      </s-section>
    </s-page>
  );
}

export function Dashboard({ data }: { data: DashboardData }) {
  const vm = deriveDashboard(data);
  return data.authMode === "mock" ? <MockDashboard data={data} vm={vm} /> : <EmbeddedDashboard data={data} vm={vm} />;
}

export default function Index() {
  return <Dashboard data={useLoaderData<typeof loader>()} />;
}

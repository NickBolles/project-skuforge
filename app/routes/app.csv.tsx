import { randomUUID } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { useActionData } from "react-router";
import type { CsvImportReport } from "../core/csv";
import { applyCsvImport, dryRunCsvImport } from "../services/csv.server";
import { getAppContext } from "../services/context.server";

type CsvActionData =
  | { intent: "dry-run"; report: CsvImportReport; source: string; includeBarcodeOverwrites: boolean }
  | { intent: "apply"; report: CsvImportReport; jobId: string; status: string }
  | { intent: "error"; message: string };

function checked(form: FormData, name: string): boolean {
  return form.get(name) === "on" || form.get(name) === "true";
}

async function csvSource(form: FormData): Promise<string> {
  const retained = form.get("csvSource");
  if (typeof retained === "string" && retained) return retained;
  const upload = form.get("csvFile");
  if (!(upload instanceof File) || upload.size === 0) throw new Error("Choose a CSV file to validate.");
  return upload.text();
}

export const action = async ({ request }: ActionFunctionArgs): Promise<CsvActionData> => {
  try {
    const { session, catalog, db } = await getAppContext(request);
    const form = await request.formData();
    const source = await csvSource(form);
    const includeBarcodeOverwrites = checked(form, "includeBarcodeOverwrites");
    if (form.get("intent") === "apply") {
      const result = await applyCsvImport(db, catalog, session.shop, source, {
        includeBarcodeOverwrites,
        idempotencyKey: String(form.get("idempotencyKey") ?? randomUUID()),
      });
      return { intent: "apply", report: result.report, jobId: result.job.id, status: result.job.status };
    }
    return {
      intent: "dry-run",
      report: await dryRunCsvImport(db, catalog, session.shop, source, { includeBarcodeOverwrites }),
      source,
      includeBarcodeOverwrites,
    };
  } catch (error) {
    return { intent: "error", message: error instanceof Error ? error.message : "CSV processing failed." };
  }
};

function DryRunReport({ data }: { data: Extract<CsvActionData, { intent: "dry-run" }> }) {
  const { report } = data;
  return (
    <s-section heading="Dry-run report — nothing has been written">
      <p>Apply: {report.counts.apply} · Warn: {report.counts.warn} · Block: {report.counts.block} · No-op: {report.counts["no-op"]}</p>
      {report.globalIssues.map((issue, index) => <p key={`${issue.code}-${index}`} role="alert">{issue.message}</p>)}
      <table>
        <thead><tr><th>Row</th><th>Variant</th><th>Verdict</th><th>SKU</th><th>Barcode</th><th>Details</th></tr></thead>
        <tbody>{report.rows.map((row) => <tr key={`${row.rowNumber}-${row.row.variant_id}`}><td>{row.rowNumber}</td><td>{row.row.variant_id || "Missing"}</td><td>{row.verdict}</td><td>{row.row.sku}</td><td>{row.row.barcode}</td><td>{row.issues.map((issue) => issue.message).join(" ")}</td></tr>)}</tbody>
      </table>
      <p>Blocked rows never apply. “Apply clean rows only” writes only rows marked eligible above.</p>
      <form method="post">
        <input type="hidden" name="intent" value="apply" />
        <input type="hidden" name="csvSource" value={data.source} />
        {data.includeBarcodeOverwrites ? <input type="hidden" name="includeBarcodeOverwrites" value="true" /> : null}
        <button type="submit" disabled={report.applyCount === 0 || report.globalIssues.some((issue) => issue.severity === "block")}>Apply clean rows only</button>
      </form>
    </s-section>
  );
}

export default function CsvRoute() {
  const data = useActionData<typeof action>();
  return (
    <s-page heading="CSV export and import">
      <s-section heading="Export">
        <p>Exports variant IDs, context, SKUs, and barcodes using the bulk editor’s filter parameters.</p>
        <a href="/api/csv/export">Download all variants CSV</a>
      </s-section>
      <s-section heading="Import">
        <p>Every import is fully checked against itself and the current catalog before any Shopify write.</p>
        <form method="post" encType="multipart/form-data">
          <input type="hidden" name="intent" value="dry-run" />
          <label>CSV file <input type="file" name="csvFile" accept=".csv,text/csv" required /></label>
          <label><input type="checkbox" name="includeBarcodeOverwrites" /> Include barcode overwrites (may replace official UPC/EAN values)</label>
          <button type="submit">Build dry-run report</button>
        </form>
      </s-section>
      {data?.intent === "dry-run" ? <DryRunReport data={data} /> : null}
      {data?.intent === "apply" ? <s-section heading="Import applied"><p>Job {data.jobId}: {data.status}. Mandatory post-run duplicate verification completed.</p></s-section> : null}
      {data?.intent === "error" ? <p role="alert">{data.message}</p> : null}
    </s-page>
  );
}

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";
import { getAppContext } from "../services/context.server";
import { cancelGenerationJob, getGenerationJob, runGenerationJob } from "../services/generation.server";
import { JobLockedError } from "../services/job-lock.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, db } = await getAppContext(request);
  return getGenerationJob(db, session.shop, params.jobId!);
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, db, catalog } = await getAppContext(request);
  const form = await request.formData();
  const job = await getGenerationJob(db, session.shop, params.jobId!);
  if (form.get("intent") === "cancel") {
    await cancelGenerationJob(db, job.shopId, job.id);
    return { ok: true, cancelled: true };
  }
  try {
    const result = await runGenerationJob(db, catalog, job.id, { source: "ui" });
    return { ok: true, status: result.job.status };
  } catch (error) {
    if (error instanceof JobLockedError) {
      return Response.json({ ok: false, error: error.message, runningJobId: error.lock.jobId }, { status: 409 });
    }
    throw error;
  }
};

export default function GenerationJobRoute() {
  const job = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { error?: string } | undefined;
  const totals = JSON.parse(job.totals) as Record<string, number | string>;
  const barcodeJob = (JSON.parse(job.fields) as string[]).includes("barcode");
  return (
    <s-page heading={`Generation job ${job.id}`}>
      <s-section heading="Status"><p>{job.status}</p><p>Planned: {String(totals.planned ?? job.items.length)} · Applied: {String(totals.applied ?? 0)} · Skipped: {String(totals.skippedConflict ?? 0)}</p>{actionData?.error ? <p role="alert">{actionData.error}</p> : null}</s-section>
      {job.status === "previewing" ? <form method="post"><button type="submit" name="intent" value="run">Confirm and apply</button><button type="submit" name="intent" value="cancel">Cancel</button></form> : null}
      <s-section heading="Preview (first 50)"><p>Large stores may take around 15 minutes. Progress is resumable.</p><table><thead><tr><th>Variant</th><th>Expected</th><th>Proposed</th><th>Status</th></tr></thead><tbody>{job.items.slice(0, 50).map((item) => <tr key={item.id}><td>{item.variantId}</td><td>{(barcodeJob ? item.expectedBarcode : item.expectedSku) ?? "—"}</td><td>{(barcodeJob ? item.proposedBarcode : item.proposedSku) ?? "—"}</td><td>{item.status}</td></tr>)}</tbody></table></s-section>
    </s-page>
  );
}

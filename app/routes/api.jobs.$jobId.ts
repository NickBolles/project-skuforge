import type { LoaderFunctionArgs } from "react-router";
import { getAppContext } from "../services/context.server";
import { getGenerationJob } from "../services/generation.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, db } = await getAppContext(request);
  const job = await getGenerationJob(db, session.shop, params.jobId!);
  return Response.json({ id: job.id, status: job.status, totals: JSON.parse(job.totals), cursor: job.cursor, error: job.error });
};

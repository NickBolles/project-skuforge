import { safeEqualBytes } from "./crypto.server";

export function authorizedCronRequest(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return safeEqualBytes(supplied, expected);
}

export async function handleCronScan(
  request: Request,
  options: { secret: string | undefined; run: () => Promise<unknown> },
): Promise<Response> {
  if (!options.secret) return Response.json({ error: "Cron is not configured." }, { status: 503 });
  if (!authorizedCronRequest(request, options.secret)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const results = await options.run();
  return Response.json({ date: new Date().toISOString().slice(0, 10), results });
}

const baseUrl = process.env.SHOPIFY_APP_URL || "http://localhost:3000";
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET is required. Set it to the same value used by the local app.");
  process.exitCode = 1;
} else {
  const response = await fetch(new URL("/api/cron/scan", baseUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
  const body = await response.text();
  console.log(`${response.status} ${response.statusText}`);
  console.log(body);
  if (!response.ok) process.exitCode = 1;
}

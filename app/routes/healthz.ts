import db from "../db.server";

export async function loader() {
  try {
    await db.$queryRawUnsafe("SELECT 1");
    return Response.json({ ok: true, service: "web" });
  } catch {
    return Response.json({ ok: false, service: "web" }, { status: 503 });
  }
}

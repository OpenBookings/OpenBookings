import { getPool } from "@openbookings/db";
import { loadAppStructure } from "@openbookings/db/apps";
import { appsJson, authenticateApp, unauthorized } from "@/lib/apps/api-auth";

export const dynamic = "force-dynamic";

/** The property's active rooms and rate plans, by their public codes. */
export async function GET(request: Request) {
  const installation = await authenticateApp(request);
  if (!installation) return unauthorized();
  return appsJson(await loadAppStructure(getPool(), installation));
}

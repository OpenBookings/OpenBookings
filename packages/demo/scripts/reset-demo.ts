/**
 * Wipes every demo hotel and the bookings made at them. Refuses to run unless
 * testing mode is on (TESTING=true and a Stripe test key), so it cannot be
 * pointed at a database used with live keys.
 *
 *   bun run demo:reset
 */

import { getPool } from "@openbookings/db";
import { isTestingMode } from "../src/mode";
import { resetDemoData } from "../src/membership";

async function main(): Promise<void> {
  if (!isTestingMode()) {
    throw new Error("Refusing to reset demo data: testing mode is off (needs TESTING=true and an sk_test_ Stripe key).");
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    const counts = await resetDemoData({
      query: (text, values) => client.query(text, values as unknown[]),
      transaction: async (fn) => {
        await client.query("BEGIN");
        try {
          const out = await fn({ query: (text, values) => client.query(text, values as unknown[]) });
          await client.query("COMMIT");
          return out;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      },
    });
    console.log(`Deleted ${counts.properties} demo properties, ${counts.bookings} bookings, ${counts.intents} booking intents.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

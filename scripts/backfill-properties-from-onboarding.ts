/**
 * One-off backfill: create the `properties` row for every host who completed
 * onboarding before promotion existed (see promotion.ts).
 *
 * Idempotent and re-runnable — promoteOnboardingToProperty returns
 * "already-owns-property" for anyone already migrated, so a second run is a
 * no-op. Run with:
 *
 *   bun --env-file=.env.local scripts/backfill-properties-from-onboarding.ts
 *   bun --env-file=.env.local scripts/backfill-properties-from-onboarding.ts --dry-run
 */
import { query, queryOne } from "@openbookings/db";
import { promoteOnboardingToProperty } from "../apps/business/app/(onboarding)/onboarding/promotion";

const dryRun = process.argv.includes("--dry-run");

interface Row {
  user_id: string;
  email: string;
  step_data: Record<string, unknown>;
}

async function main() {
  const rows = await query<Row>(
    `SELECT ho.user_id, u.email, ho.step_data
     FROM host_onboarding ho
     JOIN "user" u ON u.id = ho.user_id
     WHERE ho.onboarding_completed_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.owner_user_id = ho.user_id)
     ORDER BY ho.user_id`,
  );

  console.log(`${rows.length} completed host(s) without a property${dryRun ? " (dry run)" : ""}`);

  let created = 0;
  const skipped: { userId: string; reason: string }[] = [];

  for (const row of rows) {
    if (dryRun) {
      console.log(`would promote ${row.user_id} (${row.email})`);
      continue;
    }

    const result = await promoteOnboardingToProperty(
      { userId: row.user_id, userEmail: row.email, stepData: row.step_data as never },
      { query, queryOne },
    );

    if (result.created) {
      created += 1;
      console.log(`created ${result.slug} (${result.propertyId}) for ${row.email}`);
    } else {
      skipped.push({ userId: row.user_id, reason: result.reason });
      console.warn(`skipped ${row.user_id}: ${result.reason}`);
    }
  }

  console.log(`\ncreated ${created}, skipped ${skipped.length}`);
  if (skipped.length > 0) {
    console.log("skipped hosts need manual attention:", skipped);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

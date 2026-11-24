import type { AppInstallation } from "./installations";
import { feedCursor, markPolling, savePage } from "./outbox-store";
import type { TickDeps } from "./tick";

/**
 * Read core's booking change feed from the saved cursor to the end into the outbox; returns the bookings taken in.
 * Each page and the cursor after it are saved in one statement, so a crash neither skips nor re-applies a page.
 * A core error propagates with the cursor where the last saved page left it. `proceed` is asked before each
 * page (renew the lease, check the budget); false stops quietly.
 */
export async function pollInstallation(deps: TickDeps, inst: AppInstallation, proceed: () => Promise<boolean> = async () => true): Promise<number> {
  await markPolling(deps.db, inst.id, deps.now());
  const client = deps.client(inst);
  let cursor = await feedCursor(deps.db, inst.id); // fresh: `inst` may be older than the last poll
  let taken = 0;
  for (;;) {
    if (!(await proceed())) return taken;
    const page = await client.changes(cursor);
    await savePage(deps.db, inst, page.bookings, page.nextCursor, deps.now());
    taken += page.bookings.length;
    // A feed that says "more" but does not move would loop for ever.
    if (!page.hasMore || page.nextCursor === cursor) return taken;
    cursor = page.nextCursor;
  }
}

/**
 * Erasure, PostHog half. A GDPR deletion request now has to clear two places:
 * the database row, and the PostHog person that `useAnalyticsIdentity` created
 * from the same UUID. Deleting the row alone leaves a person in PostHog keyed
 * by an ID that still resolves to a real human via our own backups.
 *
 * Run this BEFORE the database delete, while you can still look the user up.
 *
 *   bun --env-file=.env.local scripts/delete-posthog-person.ts <user-uuid>
 *   bun --env-file=.env.local scripts/delete-posthog-person.ts <user-uuid> --dry-run
 *
 * Needs POSTHOG_PERSONAL_API_KEY (a personal API key with person:write on the
 * project — the phc_ ingestion key cannot delete) and POSTHOG_PROJECT_ID.
 * Neither belongs in an app's env; export them for the run and drop them.
 *
 * See apps/web/app/privacy/page.tsx §7 for what we promise and the 30-day clock.
 */

const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.posthog.com";
const API_KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID;

const distinctId = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

interface Person {
  id: number;
  distinct_ids: string[];
  properties: Record<string, unknown>;
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${HOST}/api/projects/${PROJECT_ID}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${API_KEY}`, ...init?.headers },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status} ${await res.text()}`);
  }
  return res;
}

async function main() {
  if (!distinctId || distinctId.startsWith("--")) {
    throw new Error("usage: delete-posthog-person.ts <user-uuid> [--dry-run]");
  }
  if (!API_KEY || !PROJECT_ID) {
    throw new Error("POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID must be set");
  }

  const res = await api(`/persons/?distinct_id=${encodeURIComponent(distinctId)}`);
  const { results }: { results: Person[] } = await res.json();

  if (results.length === 0) {
    // Expected for anyone who declined analytics cookies: they were never
    // identified, so there is no person to erase. Not a failure.
    console.log(`no PostHog person for ${distinctId} — nothing to delete`);
    return;
  }

  for (const person of results) {
    if (dryRun) {
      console.log(`would delete person ${person.id} (${person.distinct_ids.join(", ")}) and its events`);
      continue;
    }
    // delete_events=true is the point of the exercise: without it the person
    // record goes and the events it anchored stay, still keyed by the UUID.
    await api(`/persons/${person.id}/?delete_events=true`, { method: "DELETE" });
    console.log(`deleted person ${person.id} and its events`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

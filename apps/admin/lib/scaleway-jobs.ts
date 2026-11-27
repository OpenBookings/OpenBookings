/**
 * A thin client for Scaleway Serverless Jobs, the production home of the
 * invoice job (the admin container has no full-access database URL, so it
 * starts the job instead of running it).
 *
 * Checked 2026-11-27 against Scaleway's published schema,
 * https://www.scaleway.com/en/developers/api/serverless-jobs/v1alpha2/schema.yml
 * (v1alpha1 still exists but is superseded):
 *
 *   start:   POST https://api.scaleway.com/serverless-jobs/v1alpha2/regions/{region}/job-definitions/{job_definition_id}/start
 *            body { args: string[] } replaces the image's default arguments; the
 *            image's ENTRYPOINT (apps/invoice-job/Dockerfile) stays, so `args`
 *            is just what jobArgs builds (`--step=draft --period=2026-10`).
 *            200: { job_runs: [{ id, state, ... }] }
 *   get run: GET  https://api.scaleway.com/serverless-jobs/v1alpha2/regions/{region}/job-runs/{job_run_id}
 *            200: { state, started_at, terminated_at, exit_code, ... }
 *            state: initialized | validated | queued | running | succeeded | failed | interrupting | interrupted | retrying
 *   auth:    header X-Auth-Token: the API secret key.
 *
 * Errors are Scaleway's usual `{ message, type }` JSON.
 *
 * Every call gives up after SCALEWAY_TIMEOUT_MS with "Scaleway: timed out",
 * so starting a run answers with that refusal and the invoices page renders
 * without the run's state instead of hanging on Scaleway.
 */

const API = "https://api.scaleway.com/serverless-jobs/v1alpha2";

/** How long one Scaleway call may take, the response body included. */
export const SCALEWAY_TIMEOUT_MS = 10_000;

export type JobConfig = { region: string; jobDefinitionId: string; secretKey: string };

export type JobRunState = { state: string; startedAt?: string; finishedAt?: string; exitCode?: number };

/** The three settings, or null when any is missing. */
export function scalewayJobConfig(env: Record<string, string | undefined> = process.env): JobConfig | null {
  const region = env.SCW_JOBS_REGION?.trim();
  const jobDefinitionId = env.SCW_INVOICE_JOB_DEFINITION_ID?.trim();
  const secretKey = env.SCW_JOBS_SECRET_KEY?.trim();
  return region && jobDefinitionId && secretKey ? { region, jobDefinitionId, secretKey } : null;
}

/** Names of the settings that are not set, for a message that says what to add. */
export function missingJobSettings(env: Record<string, string | undefined> = process.env): string[] {
  return ["SCW_JOBS_REGION", "SCW_INVOICE_JOB_DEFINITION_ID", "SCW_JOBS_SECRET_KEY"].filter((k) => !env[k]?.trim());
}

async function call(
  cfg: JobConfig,
  method: "GET" | "POST",
  url: string,
  body: unknown,
  fetchFn: typeof fetch,
  timeoutMs: number,
) {
  const signal = AbortSignal.timeout(timeoutMs);
  // Also when a fetch (or a stub) doesn't listen to the signal.
  const timedOut = new Promise<never>((_, reject) =>
    signal.addEventListener("abort", () => reject(new Error("Scaleway: timed out")), { once: true }),
  );
  timedOut.catch(() => {});
  const request = async () => {
    const res = await fetchFn(url, {
      method,
      headers: { "X-Auth-Token": cfg.secretKey, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal,
    });
    return { res, text: await res.text() };
  };
  let res: Response;
  let text: string;
  try {
    ({ res, text } = await Promise.race([request(), timedOut]));
  } catch (error) {
    if (signal.aborted) throw new Error("Scaleway: timed out");
    throw error;
  }
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // Not JSON: the status below still says what happened.
  }
  if (!res.ok) {
    const message = typeof json.message === "string" && json.message ? json.message : `HTTP ${res.status}`;
    throw new Error(`Scaleway: ${message}`);
  }
  return json;
}

/** Starts the job definition with these arguments; the run id to follow it by. */
export async function startJobRun(
  cfg: JobConfig,
  args: string[],
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = SCALEWAY_TIMEOUT_MS,
): Promise<{ runId: string }> {
  const url = `${API}/regions/${encodeURIComponent(cfg.region)}/job-definitions/${encodeURIComponent(cfg.jobDefinitionId)}/start`;
  const json = await call(cfg, "POST", url, { args }, fetchFn, timeoutMs);
  const first = Array.isArray(json.job_runs) ? (json.job_runs[0] as { id?: unknown } | undefined) : undefined;
  if (typeof first?.id !== "string") throw new Error("Scaleway started no job run");
  return { runId: first.id };
}

export async function getJobRun(
  cfg: JobConfig,
  runId: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = SCALEWAY_TIMEOUT_MS,
): Promise<JobRunState> {
  const url = `${API}/regions/${encodeURIComponent(cfg.region)}/job-runs/${encodeURIComponent(runId)}`;
  const json = await call(cfg, "GET", url, undefined, fetchFn, timeoutMs);
  const out: JobRunState = { state: typeof json.state === "string" ? json.state : "unknown_state" };
  if (typeof json.started_at === "string") out.startedAt = json.started_at;
  if (typeof json.terminated_at === "string") out.finishedAt = json.terminated_at;
  if (typeof json.exit_code === "number") out.exitCode = json.exit_code;
  return out;
}

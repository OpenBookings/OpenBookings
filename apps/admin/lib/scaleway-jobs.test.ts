import { describe, expect, test } from "bun:test";
import { getJobRun, scalewayJobConfig, startJobRun, type JobConfig } from "./scaleway-jobs";

const cfg: JobConfig = { region: "nl-ams", jobDefinitionId: "def-1", secretKey: "scw-secret" };

type Call = { url: string; init: RequestInit };
const stub = (status: number, body: unknown) => {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
};

describe("scalewayJobConfig", () => {
  test("is null unless all three settings are set", () => {
    expect(scalewayJobConfig({})).toBeNull();
    expect(scalewayJobConfig({ SCW_JOBS_REGION: "nl-ams", SCW_INVOICE_JOB_DEFINITION_ID: "d" })).toBeNull();
    expect(
      scalewayJobConfig({ SCW_JOBS_REGION: "nl-ams", SCW_INVOICE_JOB_DEFINITION_ID: "d", SCW_JOBS_SECRET_KEY: "k" }),
    ).toEqual({ region: "nl-ams", jobDefinitionId: "d", secretKey: "k" });
  });
});

describe("startJobRun", () => {
  test("posts to the job definition with the args and the token", async () => {
    const { calls, fetchFn } = stub(200, { job_runs: [{ id: "run-9", state: "queued" }] });
    const out = await startJobRun(cfg, ["--step=draft", "--period=2026-10"], fetchFn);
    expect(out).toEqual({ runId: "run-9" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.scaleway.com/serverless-jobs/v1alpha2/regions/nl-ams/job-definitions/def-1/start");
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>)["X-Auth-Token"]).toBe("scw-secret");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ args: ["--step=draft", "--period=2026-10"] });
  });

  test("a non-2xx response throws with Scaleway's message", async () => {
    const { fetchFn } = stub(403, { message: "insufficient permissions", type: "denied_authentication" });
    await expect(startJobRun(cfg, ["--step=draft"], fetchFn)).rejects.toThrow("insufficient permissions");
  });

  test("a response without a run throws", async () => {
    const { fetchFn } = stub(200, { job_runs: [] });
    await expect(startJobRun(cfg, [], fetchFn)).rejects.toThrow("no job run");
  });
});

describe("getJobRun", () => {
  test("maps the run state", async () => {
    const { calls, fetchFn } = stub(200, {
      id: "run-9",
      state: "failed",
      started_at: "2026-11-27T10:00:00Z",
      terminated_at: "2026-11-27T10:01:00Z",
      exit_code: 2,
    });
    expect(await getJobRun(cfg, "run-9", fetchFn)).toEqual({
      state: "failed",
      startedAt: "2026-11-27T10:00:00Z",
      finishedAt: "2026-11-27T10:01:00Z",
      exitCode: 2,
    });
    expect(calls[0]!.url).toBe("https://api.scaleway.com/serverless-jobs/v1alpha2/regions/nl-ams/job-runs/run-9");
    expect(calls[0]!.init.method).toBe("GET");
  });

  test("leaves out what Scaleway has not set yet", async () => {
    const { fetchFn } = stub(200, { state: "queued", started_at: null, terminated_at: null, exit_code: null });
    expect(await getJobRun(cfg, "run-9", fetchFn)).toEqual({ state: "queued" });
  });
});

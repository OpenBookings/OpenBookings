/**
 * Checking a customer's EU VAT number against VIES, the European
 * Commission's VAT Information Exchange System, over its REST API.
 */

const VIES_URL = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";

/** Waits before retry 1, 2 and 3 (so a check makes at most 4 calls). */
const RETRY_DELAYS_MS = [1_000, 4_000, 16_000];

/** VIES error codes that mean "try again later". */
const RETRYABLE_ERRORS: ReadonlySet<string> = new Set([
  "MS_UNAVAILABLE",
  "SERVICE_UNAVAILABLE",
  "MS_MAX_CONCURRENT_REQ",
  "GLOBAL_MAX_CONCURRENT_REQ",
  "TIMEOUT",
]);

export type ViesResult = { valid: boolean; requestId: string | null; checkedAt: Date };

export type ViesDeps = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** How long one call may take before it is aborted and retried (default 15s). */
  timeoutMs?: number;
  /** OpenBookings' own VAT number: VIES only issues a request identifier (proof of the check) when it is given. */
  requester: { countryCode: "NL"; vatNumber: string };
};

/** VIES could not be reached or could not answer, even after retrying. */
export class ViesUnavailableError extends Error {
  constructor(message = "VIES is unavailable") {
    super(message);
    this.name = "ViesUnavailableError";
  }
}

/**
 * Splits a VAT id into the country prefix and number VIES wants: spaces,
 * dots and dashes are dropped and letters upper-cased. VIES calls Greece `EL`
 * where ISO says `GR`, so a `GR` prefix is sent as `EL`.
 */
export function normaliseVatId(vatId: string): { countryCode: string; vatNumber: string } {
  const compact = vatId.replace(/[\s.\-]/g, "").toUpperCase();
  const prefix = compact.slice(0, 2);
  return { countryCode: prefix === "GR" ? "EL" : prefix, vatNumber: compact.slice(2) };
}

type ViesResponse = {
  valid?: boolean;
  requestIdentifier?: string;
  actionSucceed?: boolean;
  userError?: string;
  errorWrappers?: { error?: string }[];
};

/**
 * Asks VIES whether a VAT id is valid. Network errors, HTTP 5xx and VIES's
 * "member state unavailable / too busy" errors are retried three times (after
 * 1s, 4s and 16s); when they persist it throws `ViesUnavailableError`. An
 * `INVALID_INPUT` answer is not retried and counts as an invalid number.
 */
export async function checkVatId(vatId: string, deps: ViesDeps): Promise<ViesResult> {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const { countryCode, vatNumber } = normaliseVatId(vatId);
  const body = JSON.stringify({
    countryCode,
    vatNumber,
    requesterMemberStateCode: deps.requester.countryCode,
    requesterNumber: deps.requester.vatNumber,
  });

  let lastProblem = "no answer";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);

    let res: Response;
    try {
      res = await doFetch(VIES_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body,
        signal: AbortSignal.timeout(deps.timeoutMs ?? 15_000),
      });
    } catch (err) {
      lastProblem = `network error: ${err instanceof Error ? err.message : String(err)}`;
      continue;
    }

    let json: ViesResponse | null = null;
    try {
      json = (await res.json()) as ViesResponse;
    } catch {
      json = null;
    }
    const errors = (json?.errorWrappers ?? []).map((e) => e.error ?? "UNKNOWN");
    if (json?.userError) errors.push(json.userError);

    if (errors.some((e) => RETRYABLE_ERRORS.has(e)) || (res.status >= 500 && typeof json?.valid !== "boolean")) {
      lastProblem = errors.length ? errors.join(", ") : `HTTP ${res.status}`;
      continue;
    }
    if (errors.includes("INVALID_INPUT")) {
      return { valid: false, requestId: null, checkedAt: new Date() };
    }
    if (typeof json?.valid === "boolean") {
      return { valid: json.valid, requestId: json.requestIdentifier ?? null, checkedAt: new Date() };
    }
    throw new ViesUnavailableError(`Unexpected VIES answer (HTTP ${res.status}${errors.length ? `: ${errors.join(", ")}` : ""})`);
  }
  throw new ViesUnavailableError(`VIES did not answer after ${RETRY_DELAYS_MS.length + 1} tries (${lastProblem})`);
}

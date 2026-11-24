import {
  AppStructureSchema,
  AriResultSchema,
  BookingChangesPageSchema,
  type AppStructure,
  type AriBatch,
  type AriResult,
  type BookingChangesPage,
  type DeliveryReport,
} from "@openbookings/apps-contract";
import type { AppInstallation } from "./installations";

export const CORE_TIMEOUT_MS = 15_000;

export type CoreErrorKind = "unauthorized" | "bad_request" | "too_large" | "unknown_booking" | "conflict" | "server" | "network" | "invalid_response";

/** A failed Apps API call. `retryable` tells the caller whether trying again can help. */
export class CoreApiError extends Error {
  constructor(
    message: string,
    readonly kind: CoreErrorKind,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "CoreApiError";
  }
}

/** reportDelivery for a booking core does not know (404). Permanent. */
export class UnknownBookingError extends CoreApiError {
  constructor(bookingId: string) {
    super(`core does not know booking ${bookingId}`, "unknown_booking", 404, false);
    this.name = "UnknownBookingError";
  }
}

function statusError(status: number, path: string): CoreApiError {
  const msg = `core ${path} answered ${status}`;
  if (status === 401) return new CoreApiError(msg, "unauthorized", status, false);
  if (status === 413) return new CoreApiError(msg, "too_large", status, false);
  if (status === 503) return new CoreApiError(msg, "conflict", status, true);
  if (status >= 500) return new CoreApiError(msg, "server", status, true);
  // 400, 404 and anything else unexpected: asking again unchanged will not help.
  return new CoreApiError(msg, "bad_request", status, false);
}

export function coreClient(inst: AppInstallation, fetchImpl: typeof fetch = fetch) {
  const base = inst.coreBaseUrl.replace(/\/+$/, "");

  async function call(path: string, init: { method: string; body?: unknown }): Promise<Response> {
    try {
      return await fetchImpl(`${base}/api/apps/v1${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${inst.apiKey}`,
          Accept: "application/json",
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(CORE_TIMEOUT_MS),
      });
    } catch (e) {
      throw new CoreApiError(`core ${path} unreachable: ${e instanceof Error ? e.message : String(e)}`, "network", null, true);
    }
  }

  async function json(res: Response, path: string): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw new CoreApiError(`core ${path} sent a body that is not JSON`, "invalid_response", res.status, false);
    }
  }

  function parse<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }, value: unknown, path: string, status: number): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new CoreApiError(`core ${path} sent a malformed reply`, "invalid_response", status, false);
    return parsed.data;
  }

  return {
    async structure(): Promise<AppStructure> {
      const path = "/structure";
      const res = await call(path, { method: "GET" });
      if (!res.ok) throw statusError(res.status, path);
      return parse(AppStructureSchema, await json(res, path), path, res.status);
    },

    /** 200 and 422 are both answers (422 = unknown codes, permanent for the tick); everything else throws. */
    async writeAri(batch: AriBatch): Promise<AriResult> {
      const path = "/ari";
      const res = await call(path, { method: "POST", body: batch });
      if (res.status !== 200 && res.status !== 422) throw statusError(res.status, path);
      return parse(AriResultSchema, await json(res, path), path, res.status);
    },

    async changes(cursor: string | null, limit?: number): Promise<BookingChangesPage> {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      if (limit !== undefined) params.set("limit", String(limit));
      const query = params.size > 0 ? `?${params}` : "";
      const path = `/bookings/changes${query}`;
      const res = await call(path, { method: "GET" });
      if (!res.ok) throw statusError(res.status, "/bookings/changes");
      return parse(BookingChangesPageSchema, await json(res, path), "/bookings/changes", res.status);
    },

    async reportDelivery(bookingId: string, report: DeliveryReport): Promise<void> {
      const path = `/bookings/${encodeURIComponent(bookingId)}/delivery`;
      const res = await call(path, { method: "PUT", body: report });
      if (res.status === 404) throw new UnknownBookingError(bookingId);
      if (!res.ok) throw statusError(res.status, "/bookings/:bookingId/delivery");
    },
  };
}

export type CoreClient = ReturnType<typeof coreClient>;

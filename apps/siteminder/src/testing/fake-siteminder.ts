/**
 * A stand-in for SiteMinder's reservation endpoint, for tests and local runs. It records every request body and
 * answers `OTA_HotelResNotifRS` with `<Success/>`, unless a failure was queued with `failNext`:
 * - `http500`: HTTP 500 with a plain-text body (a server-level problem; retried).
 * - `timeout`: no answer at all until the server stops (the caller's timeout decides).
 * - `auth`: the docs' credentials error, Type 4 "Invalid Username and/or Password" (permanent).
 * - `error`: the docs' validation error, Type 10 "Node CreateDateTime must exist" (permanent).
 * `onlyFor` limits the queued failures to requests whose XML contains that text (a UniqueID, say), so one
 * booking can keep failing while others go through. Never imported by production code.
 */
export type FailureKind = "http500" | "timeout" | "auth" | "error";

export type FakeSiteMinder = {
  url: string;
  received: string[];
  failNext(n: number, kind: FailureKind, onlyFor?: string): void;
  stop(): void;
};

const SOAP_NAMESPACE = "http://schemas.xmlsoap.org/soap/envelope/";
const OTA_NAMESPACE = "http://www.opentravel.org/OTA/2003/05";

const attr = (xml: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(xml)?.[1] ?? "";

function reply(echoToken: string, inner: string): string {
  return (
    `<SOAP-ENV:Envelope xmlns:SOAP-ENV="${SOAP_NAMESPACE}"><SOAP-ENV:Header/><SOAP-ENV:Body>` +
    `<OTA_HotelResNotifRS xmlns="${OTA_NAMESPACE}" EchoToken="${echoToken}" TimeStamp="${new Date().toISOString()}" Version="1.0">${inner}</OTA_HotelResNotifRS>` +
    `</SOAP-ENV:Body></SOAP-ENV:Envelope>`
  );
}

export function startFakeSiteMinder(opts: { port: number }): FakeSiteMinder {
  const received: string[] = [];
  const queued: { kind: FailureKind; onlyFor?: string }[] = [];
  const hanging: (() => void)[] = [];
  const xml = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/xml; charset=utf-8" } });

  const server = Bun.serve({
    port: opts.port,
    async fetch(req) {
      if (req.method !== "POST") return new Response("not found", { status: 404 });
      const body = await req.text();
      received.push(body);
      const echoToken = attr(body, "EchoToken");
      const at = queued.findIndex((f) => f.onlyFor === undefined || body.includes(f.onlyFor));
      const failure = at === -1 ? undefined : queued.splice(at, 1)[0];
      switch (failure?.kind) {
        case "http500":
          return new Response("Internal Server Error", { status: 500 });
        case "timeout":
          return new Promise<Response>((resolve) => hanging.push(() => resolve(new Response("gone", { status: 504 }))));
        case "auth":
          return xml(reply(echoToken, `<Errors><Error Type="4">Invalid Username and/or Password for OBK</Error></Errors>`));
        case "error":
          return xml(reply(echoToken, `<Errors><Error Type="10">Node CreateDateTime must exist</Error></Errors>`));
        default: {
          const uniqueId = /<UniqueID\b[^>]*\bID="([^"]*)"/.exec(body)?.[1] ?? "";
          const success = `<Success/><HotelReservations><HotelReservation><UniqueID Type="14" ID="${uniqueId}"/></HotelReservation></HotelReservations>`;
          return xml(reply(echoToken, success));
        }
      }
    },
  });

  return {
    url: `http://localhost:${server.port}`,
    received,
    failNext(n, kind, onlyFor) {
      for (let k = 0; k < n; k++) queued.push({ kind, onlyFor });
    },
    stop() {
      for (const release of hanging.splice(0)) release();
      void server.stop(true);
    },
  };
}

if (import.meta.main) {
  const fake = startFakeSiteMinder({ port: Number(process.env.FAKE_SITEMINDER_PORT ?? 4011) });
  console.log(`fake SiteMinder on ${fake.url}`);
}

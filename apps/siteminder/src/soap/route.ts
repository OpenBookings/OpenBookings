import type { Context } from "hono";
import { type CoreClient, coreClient } from "../core-client";
import type { Queryable } from "../db/migrate";
import { env } from "../env";
import type { AppInstallation } from "../installations";
import { answerHotelAvail } from "../ota/rooms-and-rates";
import { defaultTickDeps, tick } from "../tick";
import { MAX_BODY_BYTES, type OtaRequest, buildResponse, parseEnvelope } from "./envelope";
import { handleNotif } from "./handler";
import { readBodyText } from "./read-body";
import { xmlEscape } from "./xml";

export type SoapDeps = {
  now: () => Date;
  clientFor: (inst: AppInstallation) => Pick<CoreClient, "structure">;
  /** Start (never await) a tick for an installation with a newly stored message. Absent: the next scheduled tick sends it. */
  kickTick?: (installationId: string) => void;
};

export const defaultSoapDeps: SoapDeps = {
  now: () => new Date(),
  clientFor: (inst) => coreClient(inst),
  kickTick: (installationId) => {
    tick(defaultTickDeps(), { installationId }).catch((e: unknown) =>
      console.error("[siteminder] tick after an inbound message failed", { installationId, error: e instanceof Error ? e.message : String(e) }),
    );
  },
};

type Content = Parameters<typeof buildResponse>[2];
type Handler = (request: OtaRequest, ctx: { db: Queryable; deps: SoapDeps; now: Date }) => Promise<Content>;

/** One handler per OTA message kind. */
const HANDLERS: Record<OtaRequest["kind"], Handler> = {
  HotelAvailRQ: (request, { db, deps, now }) => answerHotelAvail(request.body, { db, clientFor: deps.clientFor, now }),
  HotelAvailNotifRQ: (request, { db, deps, now }) => handleNotif(request, { db, now, kickTick: deps.kickTick }),
  HotelRateAmountNotifRQ: (request, { db, deps, now }) => handleNotif(request, { db, now, kickTick: deps.kickTick }),
};

const XML_HEADERS = { "Content-Type": "text/xml; charset=utf-8" };

/**
 * SOAP 1.1 over POST. Application-level problems (bad credentials, unknown hotel, a bad message) are OTA errors
 * inside an HTTP 200, as SiteMinder's error-handling guide asks. HTTP errors are only for server-level
 * problems: 413 for a body over the cap, 400 with a SOAP Fault when the body is no OTA message we know.
 */
export async function handleSoap(c: Context, getDb: () => Queryable, deps: SoapDeps = defaultSoapDeps): Promise<Response> {
  const xml = await readBodyText(c.req.raw, MAX_BODY_BYTES);
  if (xml === null) return c.text("Request body too large", 413);

  const now = deps.now();
  const parsed = parseEnvelope(xml, { username: env.soapUsername, password: env.soapPassword });
  if (!parsed.ok) {
    if (!parsed.kind) return soapFault(parsed.fault.message);
    const content: Content = { success: false, errors: [parsed.fault] };
    return c.body(buildResponse(parsed.kind, parsed.echoToken ?? "", content, now), 200, XML_HEADERS);
  }

  const { request } = parsed;
  const content = await HANDLERS[request.kind](request, { db: getDb(), deps, now });
  return c.body(buildResponse(request.kind, request.echoToken, content, now), 200, XML_HEADERS);
}

function soapFault(reason: string): Response {
  const xml = `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Header/><SOAP-ENV:Body><SOAP-ENV:Fault><faultcode>SOAP-ENV:Client</faultcode><faultstring>${xmlEscape(reason)}</faultstring></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
  return new Response(xml, { status: 400, headers: XML_HEADERS });
}

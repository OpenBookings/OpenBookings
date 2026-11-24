import { createHash, timingSafeEqual } from "node:crypto";
import { XMLValidator } from "fast-xml-parser";
import { type OtaError, invalidCredentials, invalidRequest } from "./errors";
import { toXml, xmlParser } from "./xml";

export { xmlEscape } from "./xml";
export type { OtaError } from "./errors";

export const MAX_BODY_BYTES = 5_000_000;

export const OTA_NAMESPACE = "http://www.opentravel.org/OTA/2003/05";
export const SOAP_NAMESPACE = "http://schemas.xmlsoap.org/soap/envelope/";
export const PASSWORD_TEXT = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText";

const KINDS = ["HotelAvailRQ", "HotelAvailNotifRQ", "HotelRateAmountNotifRQ"] as const;
type Kind = (typeof KINDS)[number];

export type OtaRequest = { kind: Kind; echoToken: string; timeStamp: string; body: Record<string, unknown> };
export type Credentials = { username: string; password: string };

/** `kind` and `echoToken` are set when the request got far enough to know them, so the caller can answer in the right RS. */
export type EnvelopeResult =
  | { ok: true; request: OtaRequest }
  | { ok: false; fault: OtaError; kind?: Kind; echoToken?: string };

// A DOCTYPE or ENTITY declaration is the only way to define entities; whitespace after "<!" is tolerated on purpose.
const FORBIDDEN_DECLARATION = /<!\s*(DOCTYPE|ENTITY)/i;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => {
  if (typeof v === "string") return v;
  if (isRecord(v) && typeof v["#text"] === "string") return v["#text"];
  return undefined;
};
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest();

function credentialsMatch(header: unknown, expected: Credentials): boolean {
  const token = isRecord(header) && isRecord(header.Security) ? header.Security.UsernameToken : undefined;
  if (!isRecord(token)) return false;
  const username = text(token.Username);
  const passwordNode = token.Password;
  const password = text(passwordNode);
  if (username === undefined || password === undefined) return false;
  // PasswordText is the only type SiteMinder sends; anything else (a digest) cannot be compared to a plain secret.
  const type = isRecord(passwordNode) ? passwordNode["@_Type"] : undefined;
  if (type !== undefined && type !== PASSWORD_TEXT) return false;
  // Hash both sides so the buffers have equal length, compare both fields without short-circuiting.
  const userOk = timingSafeEqual(sha256(username), sha256(expected.username));
  const passOk = timingSafeEqual(sha256(password), sha256(expected.password));
  return userOk && passOk;
}

export function parseEnvelope(xml: string, expected: Credentials): EnvelopeResult {
  if (Buffer.byteLength(xml, "utf8") > MAX_BODY_BYTES) return { ok: false, fault: invalidRequest("Request body too large") };
  if (FORBIDDEN_DECLARATION.test(xml)) return { ok: false, fault: invalidRequest("DOCTYPE and ENTITY declarations are not allowed") };
  if (XMLValidator.validate(xml) !== true) return { ok: false, fault: invalidRequest("Request is not well-formed XML") };

  let parsed: unknown;
  try {
    parsed = xmlParser.parse(xml);
  } catch {
    return { ok: false, fault: invalidRequest("Request is not well-formed XML") };
  }
  const envelope = isRecord(parsed) ? parsed.Envelope : undefined;
  const body = isRecord(envelope) ? envelope.Body : undefined;
  if (!isRecord(body)) return { ok: false, fault: invalidRequest("Node SOAP-ENV:Body must exist") };

  const rootName = Object.keys(body).find((k) => KINDS.some((kind) => `OTA_${kind}` === k));
  if (!rootName) return { ok: false, fault: invalidRequest("Unsupported OTA message") };
  const kind = rootName.slice("OTA_".length) as Kind;
  const root = body[rootName];
  if (!isRecord(root)) return { ok: false, fault: invalidRequest(`Node ${rootName} must not be empty`), kind };

  const echoToken = text(root["@_EchoToken"]);
  const timeStamp = text(root["@_TimeStamp"]);
  if (echoToken === undefined) return { ok: false, fault: invalidRequest("Attribute EchoToken must exist"), kind };
  if (timeStamp === undefined) return { ok: false, fault: invalidRequest("Attribute TimeStamp must exist"), kind, echoToken };

  if (!credentialsMatch((envelope as Record<string, unknown>).Header, expected)) {
    return { ok: false, fault: invalidCredentials(), kind, echoToken };
  }
  return { ok: true, request: { kind, echoToken, timeStamp, body: root } };
}

/** A payload may not carry attributes or `Success`: those belong to the envelope and would overwrite it. */
function checkedPayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  for (const key of Object.keys(payload ?? {})) {
    if (key.startsWith("@_") || key === "Success") throw new Error(`buildResponse payload may not set ${key}`);
  }
  return payload ?? {};
}

/** ISO 8601 in UTC without milliseconds, as in SiteMinder's samples. */
export const otaTimeStamp = (now: Date): string => now.toISOString().replace(/\.\d{3}Z$/, "Z");

export function buildResponse(
  kind: OtaRequest["kind"],
  echoToken: string,
  content: { success: true; payload?: Record<string, unknown> } | { success: false; errors: OtaError[] },
  now: Date,
): string {
  const inner: Record<string, unknown> = content.success
    ? { Success: "", ...checkedPayload(content.payload) }
    : {
        Errors: {
          Error: content.errors.map((e) => ({
            "@_Type": e.type,
            ...(e.code === undefined ? {} : { "@_Code": e.code }),
            "#text": e.message,
          })),
        },
      };
  const root = `OTA_${kind.replace(/RQ$/, "RS")}`;
  const message = toXml(root, {
    "@_xmlns": OTA_NAMESPACE,
    "@_EchoToken": echoToken,
    "@_TimeStamp": otaTimeStamp(now),
    "@_Version": "1.0",
    ...inner,
  });
  return `<SOAP-ENV:Envelope xmlns:SOAP-ENV="${SOAP_NAMESPACE}"><SOAP-ENV:Header/><SOAP-ENV:Body>${message}</SOAP-ENV:Body></SOAP-ENV:Envelope>`;
}

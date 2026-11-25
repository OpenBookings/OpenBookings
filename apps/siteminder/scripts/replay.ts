/**
 * Sends SiteMinder's sample messages (apps/siteminder/fixtures, kept out of git) to a running app and prints the
 * status and reply time of each. HotelCode and dates are rewritten (dates move together so a message keeps its
 * shape: the earliest date lands on today + 7), EchoTokens are fresh UUIDs, the inbound credentials come from
 * SITEMINDER_INBOUND_USERNAME / SITEMINDER_INBOUND_PASSWORD.
 *
 *   bun run scripts/replay.ts --url http://localhost:3006/soap --hotel FAKE-HOTEL [--days 750] [--room SGL --rate BAR]
 *     [--core http://localhost:4010] [--no-samples] [--keep-dates] [fixture...]
 *
 * With no fixtures, every request sample SiteMinder sends us (`*-rq*.xml`, not the `reservation-*` ones: those are what
 * we send SiteMinder) is sent, unless `--no-samples`. `--days N` adds a bulk load:
 * availability, rates and restrictions for one room and rate plan (`--room`/`--rate`, default SGL/BAR) over N nights
 * from today. `--keep-dates` sends the fixtures' dates as they are. `--core` prints what the fake core received.
 * Exit code 1 when a reply is not Success (or, for the samples in EXPECTED_ERROR, not that error) or takes 2 s or more.
 */
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const FIXTURES_DIR = path.resolve(import.meta.dir, "../fixtures");
const BUDGET_MS = 2000;
/** Samples for features the app does not offer (Included Occupancy, OBP): the right answer is the docs' error. */
const EXPECTED_ERROR: Record<string, string> = {
  "rates-rq-obp-rates.xml": "Invalid included occupancy",
  "rates-rq-obp-undefined-settings.xml": "Invalid included occupancy",
  "rates-rq-pdp-all-four-rate-fields.xml": "Invalid included occupancy",
  "rates-rq-pdp-included-occupancy-and-single-guest-discount.xml": "Invalid included occupancy",
  "rates-rq-pdp-included-occupancy.xml": "Invalid included occupancy",
};
/** A request SiteMinder sends us. Reservation samples are the messages we send SiteMinder, so the app refuses them. */
const isInboundRequest = (f: string) => f.endsWith(".xml") && /-rq/.test(f) && !f.startsWith("reservation-");
const NS = "http://www.opentravel.org/OTA/2003/05";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flagged = new Set(["--url", "--hotel", "--days", "--core", "--room", "--rate"]);
const files = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !flagged.has(all[i - 1] ?? ""));

const url = arg("url") ?? "http://localhost:3006/soap";
const hotel = arg("hotel");
const days = arg("days") ? Number(arg("days")) : 0;
const coreUrl = arg("core");
const room = arg("room") ?? "SGL";
const rate = arg("rate") ?? "BAR";
const samples = !process.argv.includes("--no-samples");
const keepDates = process.argv.includes("--keep-dates");
if (!hotel) throw new Error("--hotel <code> is required");
if (days && (!Number.isInteger(days) || days < 1 || days > 750)) throw new Error("--days must be a whole number from 1 to 750");
const username = process.env.SITEMINDER_INBOUND_USERNAME;
const password = process.env.SITEMINDER_INBOUND_PASSWORD;
if (!username || !password) throw new Error("Set SITEMINDER_INBOUND_USERNAME and SITEMINDER_INBOUND_PASSWORD");

const dayNo = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
const isoOf = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);
const today = isoOf(Math.floor(Date.now() / 86_400_000));

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function envelope(body: string): string {
  return (
    `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Header>` +
    `<wsse:Security SOAP-ENV:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><wsse:UsernameToken>` +
    `<wsse:Username>${xmlEscape(username!)}</wsse:Username>` +
    `<wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${xmlEscape(password!)}</wsse:Password>` +
    `</wsse:UsernameToken></wsse:Security></SOAP-ENV:Header><SOAP-ENV:Body>${body}</SOAP-ENV:Body></SOAP-ENV:Envelope>`
  );
}

/** A sample made current: hotel, EchoToken and TimeStamp replaced, dates shifted together, wrapped in an envelope. */
function prepare(xml: string): string {
  let out = xml
    .replace(/HotelCode="[^"]*"/g, `HotelCode="${xmlEscape(hotel!)}"`)
    .replace(/EchoToken="[^"]*"/g, () => `EchoToken="${randomUUID()}"`)
    .replace(/TimeStamp="[^"]*"/g, `TimeStamp="${new Date().toISOString()}"`);
  const dates = [...out.matchAll(/\b(?:Start|End)="(\d{4}-\d{2}-\d{2})"/g)].map((m) => dayNo(m[1]!));
  if (dates.length > 0 && !keepDates) {
    const shift = dayNo(today) + 7 - Math.min(...dates);
    out = out.replace(/\b(Start|End)="(\d{4}-\d{2}-\d{2})"/g, (_, attr: string, d: string) => `${attr}="${isoOf(dayNo(d) + shift)}"`);
  }
  return out.trimStart().startsWith("<SOAP-ENV:Envelope") ? out : envelope(out);
}

/** Availability, rates and restrictions for one room and rate plan over `n` nights from today, as three messages. */
function bulk(n: number): { name: string; xml: string }[] {
  const range = `Start="${today}" End="${isoOf(dayNo(today) + n - 1)}" InvTypeCode="${xmlEscape(room)}" RatePlanCode="${xmlEscape(rate)}"`;
  const head = (root: string) => `<${root} xmlns="${NS}" EchoToken="x" TimeStamp="x" Version="1.0">`;
  return [
    {
      name: `bulk-${n}d-availability`,
      xml: `${head("OTA_HotelAvailNotifRQ")}<AvailStatusMessages HotelCode="h"><AvailStatusMessage BookingLimit="5"><StatusApplicationControl ${range}/></AvailStatusMessage></AvailStatusMessages></OTA_HotelAvailNotifRQ>`,
    },
    {
      name: `bulk-${n}d-restrictions`,
      xml: `${head("OTA_HotelAvailNotifRQ")}<AvailStatusMessages HotelCode="h"><AvailStatusMessage><StatusApplicationControl ${range}/><LengthsOfStay><LengthOfStay MinMaxMessageType="SetMinLOS" Time="2"/></LengthsOfStay></AvailStatusMessage></AvailStatusMessages></OTA_HotelAvailNotifRQ>`,
    },
    {
      name: `bulk-${n}d-rates`,
      xml: `${head("OTA_HotelRateAmountNotifRQ")}<RateAmountMessages HotelCode="h"><RateAmountMessage><StatusApplicationControl ${range}/><Rates><Rate><BaseByGuestAmts><BaseByGuestAmt AgeQualifyingCode="10" AmountAfterTax="123.45" CurrencyCode="EUR"/></BaseByGuestAmts></Rate></Rates></RateAmountMessage></RateAmountMessages></OTA_HotelRateAmountNotifRQ>`,
    },
  ];
}

const names =
  files.length > 0 ? files : samples ? (await readdir(FIXTURES_DIR)).filter(isInboundRequest).sort() : [];
const messages: { name: string; xml: string }[] = [];
for (const f of names) {
  const file = path.isAbsolute(f) || f.includes("/") ? f : path.join(FIXTURES_DIR, f);
  messages.push({ name: path.basename(f), xml: await readFile(file, "utf8") });
}
if (days) messages.push(...bulk(days));

let bad = 0;
console.log(`replaying ${messages.length} message(s) to ${url} for hotel ${hotel}`);
for (const { name, xml } of messages) {
  const body = prepare(xml);
  const started = performance.now();
  let status = 0;
  let verdict: string;
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8" }, body });
    status = res.status;
    const text = await res.text();
    const error = /<Error [^>]*ShortText="([^"]*)"/.exec(text) ?? /<Error [^>]*>([^<]*)</.exec(text);
    verdict = /<Success\b/.test(text) && !/<Errors\b/.test(text) ? "Success" : `ERROR ${error?.[1] ?? text.slice(0, 120)}`;
  } catch (e) {
    verdict = `ERROR ${e instanceof Error ? e.message : String(e)}`;
  }
  const ms = performance.now() - started;
  const slow = ms >= BUDGET_MS;
  const expected = EXPECTED_ERROR[path.basename(name)];
  const right = expected ? verdict.includes(expected) : verdict === "Success";
  if (expected && right) verdict = "Rejected (expected)";
  if (!right || slow || status !== 200) bad++;
  console.log(`${name.padEnd(62)} HTTP ${status}  ${verdict.padEnd(20)} ${ms.toFixed(0).padStart(5)} ms${slow ? "  SLOW" : ""}`);
}

if (coreUrl) {
  await Bun.sleep(5000); // the app sends to core after replying; give its tick a moment
  const res = await fetch(`${coreUrl.replace(/\/$/, "")}/_received`);
  console.log(`fake core received: ${JSON.stringify(await res.json())}`);
}
console.log(bad === 0 ? "every reply as expected, within budget" : `${bad} message(s) failed or were slow`);
process.exit(bad === 0 ? 0 : 1);

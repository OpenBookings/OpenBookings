/**
 * VAT rates on a hotel stay in the eurozone, for the per-night VAT split a
 * host sees for their own bookkeeping. Guests never see these. OpenBookings
 * issues no invoices; the hotel stays responsible for its VAT.
 *
 * `accommodation` is the rate on the room. `breakfast` is the rate on a
 * breakfast that is included in the room rate, which is not always the
 * restaurant rate: some countries tax it with the room. Rates are percent.
 *
 * Rows only go back to 2025-01-01 (NL further, as it was already known).
 * Older dates find no rate. A new row is a rate change from that date on.
 *
 * Rates were checked on 2026-11-11 against the EU Taxes in Europe Database
 * (TEDB, VAT search for "accommodation" and "restaurant and catering",
 * 2025-01-01 to 2026-11-11) and, where the breakfast rule needed it, the
 * national tax authority or statute named in `source`.
 */

export type AccommodationType = "hotel";

export interface VatRateRow {
  /** ISO 3166-1 alpha-2, e.g. "NL". Greece is "GR" (TEDB uses "EL"). */
  country: string;
  type: AccommodationType;
  /** "2026-01-01". The rates apply to nights on or after this date. */
  from: string;
  /** Percent, e.g. 21. */
  accommodation: number;
  /** Percent, for a breakfast included in the room rate. */
  breakfast: number;
  /** Where the rate was checked. */
  source: string;
}

export const EUROZONE: readonly string[] = [
  "AT", "BE", "BG", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES",
];

const TEDB = "https://ec.europa.eu/taxation_customs/tedb/#/vat-search";

export const VAT_RATES: readonly VatRateRow[] = [
  // Breakfast included in the room price counts as part of the stay (§ 10 (2) 3 a UStG).
  { country: "AT", type: "hotel", from: "2025-01-01", accommodation: 10, breakfast: 10,
    source: "https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10004873&Paragraf=10" },

  // Until 28 Feb 2026 furnished lodging "with or without breakfast" was 6%.
  // From 1 Mar 2026 lodging and breakfast are both 12%. A transition kept 6% for
  // bookings made by 28 Feb 2026 whose VAT fell due by 30 Jun 2026; the table can't express that.
  { country: "BE", type: "hotel", from: "2025-01-01", accommodation: 6, breakfast: 6,
    source: "https://www.ejustice.just.fgov.be/eli/besluit/2026/02/14/2026001322/staatsblad" },
  { country: "BE", type: "hotel", from: "2026-03-01", accommodation: 12, breakfast: 12,
    source: "https://www.ejustice.just.fgov.be/eli/besluit/2026/02/14/2026001322/staatsblad" },

  // Meals sold with the stay for one price are part of the 9% accommodation supply
  // (Ministry of Finance instruction on art. 66(2) ZDDS). Meals priced separately are 20%.
  { country: "BG", type: "hotel", from: "2025-01-01", accommodation: 9, breakfast: 9,
    source: "https://www.minfin.bg/upload/10961/Ukazania.pdf" },

  // 13% covers "accommodation with breakfast, half board or full board" (TEDB).
  { country: "HR", type: "hotel", from: "2025-01-01", accommodation: 13, breakfast: 13, source: TEDB },

  { country: "CY", type: "hotel", from: "2025-01-01", accommodation: 9, breakfast: 9, source: TEDB },

  // 9% → 13% on 1 Jan 2025 for "accommodation or accommodation with breakfast".
  { country: "EE", type: "hotel", from: "2025-01-01", accommodation: 13, breakfast: 13,
    source: "https://www.emta.ee/ariklient/maksud-ja-tasumine/kaibemaks/kaibemaksumaarad-ja-maksuvaba-kaive/kaibemaksumaaraga-13-maksustatav-kaive" },

  // Accommodation and restaurant food share the reduced rate: 14% in 2025, 13.5% from 2026.
  { country: "FI", type: "hotel", from: "2025-01-01", accommodation: 14, breakfast: 14,
    source: "https://www.vero.fi/syventavat-vero-ohjeet/ohje-hakusivu/67678/majoitustoiminnan-arvonlis%C3%A4verotus2/" },
  { country: "FI", type: "hotel", from: "2026-01-01", accommodation: 13.5, breakfast: 13.5,
    source: "https://www.vero.fi/syventavat-vero-ohjeet/ohje-hakusivu/67678/majoitustoiminnan-arvonlis%C3%A4verotus2/" },

  // Mainland rate. Corsica and the overseas departments differ.
  { country: "FR", type: "hotel", from: "2025-01-01", accommodation: 10, breakfast: 10, source: TEDB },

  // Breakfast is never part of the 7% stay (§ 12 (2) 11 UStG). It was 19% until 2025;
  // from 2026 food is 7% (§ 12 (2) 15) but drinks stay 19%. A breakfast with coffee or
  // juice is partly 19%; the table can only hold one rate, so it holds the food rate.
  { country: "DE", type: "hotel", from: "2025-01-01", accommodation: 7, breakfast: 19,
    source: "https://www.gesetze-im-internet.de/ustg_1980/__12.html" },
  { country: "DE", type: "hotel", from: "2026-01-01", accommodation: 7, breakfast: 7,
    source: "https://www.gesetze-im-internet.de/ustg_1980/__12.html" },

  // Accommodation and restaurant food are both 13%. Leros, Lesvos, Kos, Samos and
  // Chios have rates 30% lower.
  { country: "GR", type: "hotel", from: "2025-01-01", accommodation: 13, breakfast: 13, source: TEDB },

  // From 1 Jul 2026 food is 9% and room-plus-breakfast is a multiple supply: the
  // breakfast part (at its market value) is 9%, the room 13.5%. Soft drinks stay 23%.
  { country: "IE", type: "hotel", from: "2025-01-01", accommodation: 13.5, breakfast: 13.5,
    source: "https://www.revenue.ie/en/tax-professionals/tdm/value-added-tax/part03-taxable-transactions-goods-ica-services/Services/services-guest-and-holiday-accommodation.pdf" },
  { country: "IE", type: "hotel", from: "2026-07-01", accommodation: 13.5, breakfast: 9,
    source: "https://www.revenue.ie/en/tax-professionals/tdm/value-added-tax/part03-taxable-transactions-goods-ica-services/Services/services-guest-and-holiday-accommodation.pdf" },

  { country: "IT", type: "hotel", from: "2025-01-01", accommodation: 10, breakfast: 10, source: TEDB },

  // UNVERIFIED: breakfast. VID's guidance says a room-plus-breakfast package is treated
  // differently from breakfast bought on the spot (21%), and PwC Latvia (Feb 2026) reads it
  // as 12% for the whole package. But the same guidance says a supply the guest could have
  // declined is separate, which would put an included breakfast at 21%.
  { country: "LV", type: "hotel", from: "2025-01-01", accommodation: 12, breakfast: 12,
    source: "https://www.vid.gov.lv/en/media/2276/download?attachment" },

  // "Bed and breakfast" is an accommodation service, so an included breakfast takes the
  // accommodation rate: 9% in 2025, 12% from 2026 (VMI).
  { country: "LT", type: "hotel", from: "2025-01-01", accommodation: 9, breakfast: 9,
    source: "https://www.vmi.lt/evmi/lengvatinis-12-proc.-pvm-tarifas-19-str.-" },
  { country: "LT", type: "hotel", from: "2026-01-01", accommodation: 12, breakfast: 12,
    source: "https://www.vmi.lt/evmi/lengvatinis-12-proc.-pvm-tarifas-19-str.-" },

  // Restaurant food (not alcohol) is 3% too.
  { country: "LU", type: "hotel", from: "2025-01-01", accommodation: 3, breakfast: 3, source: TEDB },

  // Judgement call: the VAT Act (Eighth Schedule, item 1) taxes 80% of an inclusive price
  // at 7% and deems the other 20% to be the non-accommodation part, at 18%. Breakfast is
  // that part, so 18%, but the law fixes its share at 20% of the price, not its own value.
  { country: "MT", type: "hotel", from: "2025-01-01", accommodation: 7, breakfast: 18,
    source: "https://legislation.mt/getpdf/6a7d667d73ff6d305c833d20" },

  // Hotel stays moved to 21% on 1 Jan 2026; breakfast stays 9%, split from an all-in price.
  { country: "NL", type: "hotel", from: "2019-01-01", accommodation: 9, breakfast: 9,
    source: "https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/berichten/nieuws/btw-logies" },
  { country: "NL", type: "hotel", from: "2026-01-01", accommodation: 21, breakfast: 9,
    source: "https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/berichten/nieuws/btw-logies" },

  // The 6% covers accommodation including breakfast when it is not invoiced separately
  // (restaurant food is 13%). Mainland rate; the Azores and Madeira differ.
  { country: "PT", type: "hotel", from: "2025-01-01", accommodation: 6, breakfast: 6, source: TEDB },

  // Accommodation and restaurant food are both 5%; soft drinks 19%, alcohol 23%.
  { country: "SK", type: "hotel", from: "2025-01-01", accommodation: 5, breakfast: 5, source: TEDB },

  { country: "SI", type: "hotel", from: "2025-01-01", accommodation: 9.5, breakfast: 9.5, source: TEDB },

  // Peninsula and Balearics. The Canary Islands (IGIC), Ceuta and Melilla have no VAT.
  { country: "ES", type: "hotel", from: "2025-01-01", accommodation: 10, breakfast: 10, source: TEDB },
];

/** The rates on a night of `date`: the latest row that has started, or null. */
export function vatRatesFor(
  country: string,
  type: AccommodationType,
  date: string,
): { accommodation: number; breakfast: number } | null {
  const code = country.toUpperCase();
  let current: VatRateRow | null = null;
  for (const row of VAT_RATES) {
    if (row.country !== code || row.type !== type || row.from > date) continue;
    if (!current || row.from > current.from) current = row;
  }
  return current ? { accommodation: current.accommodation, breakfast: current.breakfast } : null;
}

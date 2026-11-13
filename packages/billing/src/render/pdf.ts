import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { formatEuro } from "../money";
import { formatDay, formatLongDate, formatMonth, formatPeriod, formatStay, type InvoiceDocument, type SpecRow } from "./document";

/**
 * Renders a commission invoice or credit note as an A4 PDF, laid out like the
 * design canvas (794×1123 px pages, so every px below is 0.75 pt): page 1 is
 * the invoice, the pages after it the specification per booking. Inter is
 * embedded so `€` and `−` print. The output depends only on the document, so
 * rendering twice gives the same bytes (the store step compares hashes).
 */

const PT = 0.75;
const SELLER_BLOCK_W = 340;
const PAGE_W = 794;
const PAGE_H = 1123;
const MARGIN_X = 64;
const RIGHT = PAGE_W - MARGIN_X;
const CONTENT_W = RIGHT - MARGIN_X;
const FOOTER_BOTTOM = PAGE_H - 56;

const ACCENT = "#1f5c4a";
const INK = "#141414";
const GREY = "#555555";
const LIGHT_GREY = "#767676";
const RULE = "#d9d9d9";
const ROW_RULE = "#e6e6e6";

const FONT_FILES = { regular: "Inter-Regular.ttf", semi: "Inter-SemiBold.ttf", bold: "Inter-Bold.ttf" } as const;
type Weight = keyof typeof FONT_FILES;

const fontPath = (file: string) => fileURLToPath(new URL(`../../assets/fonts/${file}`, import.meta.url));

const DISCLOSED_AGENT =
  "Commission for intermediation in accommodation bookings, acting as disclosed agent in the name and on behalf of the host, under the Host Agreement. Accommodation value is the price of the stay including VAT, excluding tourist tax.";
const SPEC_POINTER = "Specification per booking: see attachment. Also available as CSV in OpenBookings Business → Billing.";
const SPEC_NOTE =
  "“Paid” is the date the guest paid (or the refund was made). Commission is taken as a Stripe application fee on each payment; refunds reverse it in proportion. Each Stripe payment ID matches the payment in your own Stripe Dashboard.";

export type RenderPdfOptions = {
  /** Print a large grey diagonal word on every page (previews of drafts). */
  watermark?: "DRAFT";
  /** Compress the content streams (default). Tests turn it off to read the text back. */
  compress?: boolean;
};

type Style = {
  size: number;
  weight?: Weight;
  color?: string;
  /** Right-aligned text ends at `x` instead of starting there. */
  right?: boolean;
  /** Letter spacing in px. */
  tracking?: number;
};

/** `ch_3QaXXXXXXk81F` -> `ch_3Qa…k81F`: enough to find the payment in the Stripe Dashboard. */
export function shortenPaymentRef(ref: string): string {
  return ref.length > 11 ? `${ref.slice(0, 6)}…${ref.slice(-4)}` : ref;
}

/** Renders the document; see the file comment. */
export async function renderPdf(input: InvoiceDocument, opts: RenderPdfOptions = {}): Promise<Uint8Array> {
  // Party text is host-supplied; collapse every run of whitespace so no line break can reach the layout. The caller's document is left alone.
  const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
  const single = (p: InvoiceDocument["seller"]): InvoiceDocument["seller"] => ({ ...p, legalName: oneLine(p.legalName), addressLines: p.addressLines.map(oneLine), ...(p.kvk ? { kvk: oneLine(p.kvk) } : {}) });
  const doc: InvoiceDocument = { ...input, seller: single(input.seller), buyer: single(input.buyer) };
  const noun = doc.docType === "credit_note" ? "Credit note" : "Invoice";
  const number = doc.number ?? "DRAFT";
  const created = new Date(`${doc.issuedOn ?? doc.period.end}T00:00:00Z`);

  const pdf = new PDFDocument({
    size: "A4",
    margin: 0,
    bufferPages: true,
    compress: opts.compress ?? true,
    info: {
      Title: `${noun} ${number}`,
      Author: doc.seller.legalName,
      Creator: "OpenBookings",
      Producer: "OpenBookings",
      CreationDate: created,
      ModDate: created,
    },
  });
  const chunks: Buffer[] = [];
  pdf.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    pdf.on("end", resolve);
    pdf.on("error", reject);
  });
  pdf.registerFont("regular", fontPath(FONT_FILES.regular));
  pdf.registerFont("semi", fontPath(FONT_FILES.semi));
  pdf.registerFont("bold", fontPath(FONT_FILES.bold));

  /** The natural line height of Inter at `size` px, in px. */
  const natural = (size: number, weight: Weight = "regular") => pdf.font(weight).fontSize(size * PT).currentLineHeight() / PT;
  const widthOf = (s: string, size: number, weight: Weight = "regular", tracking = 0) =>
    pdf.font(weight).fontSize(size * PT).widthOfString(s, { characterSpacing: tracking * PT }) / PT;

  /** One line of text whose CSS line box (height `lh` px) starts at `y`. */
  const text = (s: string, x: number, y: number, st: Style, lh = natural(st.size, st.weight)) => {
    const w = widthOf(s, st.size, st.weight, st.tracking);
    const top = y + (lh - natural(st.size, st.weight)) / 2;
    pdf
      .font(st.weight ?? "regular")
      .fontSize(st.size * PT)
      .fillColor(st.color ?? INK)
      .text(s, (st.right ? x - w : x) * PT, top * PT, { lineBreak: false, characterSpacing: (st.tracking ?? 0) * PT });
    return w;
  };

  /** Wrapped text; returns its height in px. */
  const paragraph = (s: string, x: number, y: number, width: number, st: Style, lhFactor: number, draw = true, align: "left" | "right" = "left") => {
    const lh = st.size * lhFactor;
    const lineGap = (lh - natural(st.size, st.weight)) * PT;
    pdf.font(st.weight ?? "regular").fontSize(st.size * PT);
    const h = pdf.heightOfString(s, { width: width * PT, lineGap }) / PT;
    if (draw) {
      pdf.fillColor(st.color ?? INK).text(s, x * PT, (y + (lineGap / PT) / 2) * PT, { width: width * PT, lineGap, align });
    }
    return h;
  };

  const hline = (y: number, x1: number, x2: number, color: string) => {
    pdf
      .moveTo(x1 * PT, y * PT)
      .lineTo(x2 * PT, y * PT)
      .lineWidth(PT)
      .strokeColor(color)
      .stroke();
  };

  const watermark = () => {
    if (!opts.watermark) return;
    pdf.save();
    pdf.translate((PAGE_W / 2) * PT, (PAGE_H / 2) * PT).rotate(-45);
    const size = 210;
    const w = widthOf(opts.watermark, size, "bold");
    pdf
      .font("bold")
      .fontSize(size * PT)
      .fillColor("#cfcfcf")
      .fillOpacity(0.45)
      .text(opts.watermark, (-w / 2) * PT, (-natural(size, "bold") / 2) * PT, { lineBreak: false });
    pdf.restore();
    pdf.fillOpacity(1);
  };
  watermark();

  const newPage = () => {
    pdf.addPage();
    watermark();
  };

  const sellerLegal = [doc.seller.legalName, doc.seller.kvk ? `KvK ${doc.seller.kvk}` : null, doc.seller.vatId ? `VAT ${doc.seller.vatId}` : null]
    .filter(Boolean)
    .join(" · ");
  /** Where each page's bottom row (legal line and page number) sits. */
  const bottomRows: number[] = [];
  const ROW_LH = 12 * 1.55;

  /** The footer block, pinned to the page bottom. Returns where its border-top is. */
  const footer = (paragraphs: string[]): number => {
    const heights = paragraphs.map((p) => paragraph(p, MARGIN_X, 0, CONTENT_W, { size: 12 }, 1.55, false));
    const body = heights.reduce((sum, h) => sum + h + 10, 0);
    const top = FOOTER_BOTTOM - (1 + 18 + body + ROW_LH);
    hline(top, MARGIN_X, RIGHT, RULE);
    let y = top + 1 + 18;
    paragraphs.forEach((p, i) => {
      paragraph(p, MARGIN_X, y, CONTENT_W, { size: 12, color: GREY }, 1.55);
      y += heights[i]! + 10;
    });
    bottomRows.push(y);
    return top;
  };

  // ---- Page 1: the invoice -------------------------------------------------
  const euro = formatEuro;
  let y = 64;

  // Header: seller on the left, title and numbers on the right.
  text("OpenBookings", MARGIN_X, y, { size: 22, weight: "bold", color: ACCENT });
  let leftY = y + natural(22, "bold") + 4;
  const sellerLines = [doc.seller.legalName, ...addressWithCountry(doc.seller)];
  // Free-form party text wraps inside its block and pushes what follows down; nothing is cut off.
  for (const line of sellerLines) leftY += paragraph(line, MARGIN_X, leftY, SELLER_BLOCK_W, { size: 12, color: GREY }, 1.55);

  text(noun, RIGHT, y, { size: 34, weight: "semi", right: true });
  let rightY = y + natural(34, "semi") + 14;
  const meta: [string, string][] = [
    [`${noun} number`, number],
    [`${noun} date`, doc.issuedOn ? formatLongDate(doc.issuedOn) : "—"],
    ["Service period", formatPeriod(doc.period.start, doc.period.end)],
  ];
  const valueW = Math.max(...meta.map(([, v], i) => widthOf(v, 13, i === 0 ? "semi" : "regular")));
  const labelW = Math.max(...meta.map(([l]) => widthOf(l, 13)));
  meta.forEach(([label, value], i) => {
    text(label, RIGHT - valueW - 20 - labelW, rightY, { size: 13, color: GREY });
    text(value, RIGHT, rightY, { size: 13, weight: i === 0 ? "semi" : "regular", right: true });
    rightY += natural(13) + 5;
  });
  y = Math.max(leftY, rightY - 5) + 36;

  // Billed to / From.
  hline(y, MARGIN_X, RIGHT, RULE);
  y += 1 + 24;
  const colW = (CONTENT_W - 32) / 2;
  const billed = [doc.buyer.legalName, ...addressWithCountry(doc.buyer), ...vatLines(doc.buyer)];
  let blockEnd = y;
  const from = [doc.seller.legalName, ...vatLines(doc.seller), ...(doc.seller.email ? [doc.seller.email] : [])];
  for (const [i, [label, lines]] of (
    [
      ["Billed to", billed],
      ["From", from],
    ] as const
  ).entries()) {
    const x = MARGIN_X + i * (colW + 32);
    text(label.toUpperCase(), x, y, { size: 11, weight: "semi", color: GREY, tracking: 0.88 });
    let ly = y + natural(11, "semi") + 6;
    for (const line of lines) ly += paragraph(line, x, ly, colW, { size: 13 }, 1.6);
    blockEnd = Math.max(blockEnd, ly);
  }
  y = blockEnd + 36;

  // Lines.
  const AMOUNT_RIGHT = RIGHT;
  const COUNT_RIGHT = RIGHT - 120;
  text("Description", MARGIN_X, y, { size: 13, weight: "semi" });
  text("Bookings", COUNT_RIGHT, y, { size: 13, weight: "semi", right: true });
  text("Amount", AMOUNT_RIGHT, y, { size: 13, weight: "semi", right: true });
  y += natural(13, "semi") + 10;
  hline(y, MARGIN_X, RIGHT, INK);
  y += 1;
  const rate = doc.commissionRatePercent;
  const lineRow = (title: string, sub: string, count: number, amount: bigint) => {
    y += 14;
    text(title, MARGIN_X, y, { size: 13 }, 13 * 1.5);
    text(sub, MARGIN_X, y + 13 * 1.5, { size: 13, color: GREY }, 13 * 1.5);
    text(String(count), COUNT_RIGHT, y, { size: 13, right: true }, 13 * 1.5);
    text(euro(amount), AMOUNT_RIGHT, y, { size: 13, right: true }, 13 * 1.5);
    y += 13 * 1.5 * 2 + 14;
    hline(y, MARGIN_X, RIGHT, RULE);
    y += 1;
  };
  const { fee, refund } = doc.lines;
  if (fee.count > 0 || !refund) {
    lineRow(
      `Commission on bookings, ${formatMonth(doc.period.start)}`,
      `${rate ? `${rate}% of` : "on"} ${euro(fee.base)} accommodation value`,
      fee.count,
      fee.gross,
    );
  }
  if (refund) {
    const relates = refund.refersTo.length > 0 ? ` · relates to invoice ${refund.refersTo.join(", ")}` : "";
    lineRow(
      "Commission refunded on cancellations",
      `${rate ? `${rate}% of` : "on"} ${euro(refund.base)}${relates}`,
      refund.count,
      refund.gross,
    );
  }
  y += 36;

  // Totals.
  const reverse = doc.vatTreatment === "EU_REVERSE_CHARGE";
  const TOTALS_X = RIGHT - 300;
  const totalsRow = (label: string, value: string) => {
    text(label, TOTALS_X, y, { size: 13, color: GREY });
    text(value, RIGHT, y, { size: 13, right: true });
    y += natural(13) + 8;
  };
  totalsRow("Subtotal", euro(doc.totals.net));
  totalsRow(reverse ? "VAT reverse charged" : "VAT 21%", euro(doc.totals.vat));
  hline(y + 2, TOTALS_X, RIGHT, INK);
  y += 2 + 1 + 10;
  text("Total", TOTALS_X, y, { size: 16, weight: "bold" });
  text(euro(doc.totals.gross), RIGHT, y, { size: 16, weight: "bold", right: true });
  y += natural(16, "bold") + 36;

  if (reverse) {
    const rest = " — Autoliquidation / BTW verlegd. VAT is to be accounted for by the recipient under Article 196 of Directive 2006/112/EC.";
    const h = paragraph(`VAT reverse charged${rest}`, MARGIN_X, 0, CONTENT_W, { size: 13 }, 1.55, false);
    hline(y, MARGIN_X, RIGHT, RULE);
    const lh = 13 * 1.55;
    const lineGap = (lh - natural(13)) * PT;
    pdf
      .font("semi")
      .fontSize(13 * PT)
      .fillColor(INK)
      .text("VAT reverse charged", MARGIN_X * PT, (y + 14) * PT, { width: CONTENT_W * PT, lineGap, continued: true });
    pdf.font("regular").text(rest, { width: CONTENT_W * PT, lineGap });
    y += 14 + h + 14;
    hline(y, MARGIN_X, RIGHT, RULE);
    y += 36;
  }

  // "Paid" notice.
  const credit = doc.docType === "credit_note";
  const badge = credit ? "Settled" : "Paid";
  const notice = credit
    ? "Nothing to pay. This credit was settled per booking via Stripe at the moment the guest was refunded."
    : "Nothing to pay. This commission was collected per booking via Stripe at the moment the guest paid.";
  const badgeW = widthOf(badge.toUpperCase(), 12, "bold", 0.96) + 20;
  const badgeH = natural(12, "bold") + 12;
  const noticeW = CONTENT_W - 2 - 40 - badgeW - 16;
  const noticeH = paragraph(notice, 0, 0, noticeW, { size: 13 }, 1.5, false);
  const boxH = 2 + 36 + Math.max(badgeH, noticeH);
  pdf
    .roundedRect(MARGIN_X * PT, y * PT, CONTENT_W * PT, boxH * PT, 8 * PT)
    .lineWidth(PT)
    .fillAndStroke("#f2f7f5", "#c9d8d2");
  const innerY = y + 1 + 18;
  const innerH = boxH - 2 - 36;
  pdf.roundedRect((MARGIN_X + 1 + 20) * PT, (innerY + (innerH - badgeH) / 2) * PT, badgeW * PT, badgeH * PT, 4 * PT).fill(ACCENT);
  text(badge.toUpperCase(), MARGIN_X + 1 + 20 + 10, innerY + (innerH - badgeH) / 2 + 6, { size: 12, weight: "bold", color: "#ffffff", tracking: 0.96 });
  paragraph(notice, MARGIN_X + 1 + 20 + badgeW + 16, innerY + (innerH - noticeH) / 2, noticeW, { size: 13 }, 1.5);

  footer([DISCLOSED_AGENT, SPEC_POINTER]);

  // ---- Page 2+: the specification -----------------------------------------
  const COLS = { booking: 0, paid: 110, stay: 190, value: 420, commission: 540, stripe: 548 };
  const X = (n: number) => MARGIN_X + n;
  const commissionHead = rate ? ["Commission", `${rate}%`] : ["Commission"];
  const HEAD_H = 14.5 * 2 + 8;
  const rows = doc.rows;
  const rowHeight = (r: SpecRow) => 9 + (r.refundNote ? 12 * 1.45 * 2 : natural(12)) + 9 + 1;
  const totalsLines = 5;
  const totalsH = natural(12) * totalsLines + 7 * (totalsLines - 1) + 8;

  /** The specification header: title on the left, a block of facts on the right that wraps a long host name. */
  const specHeader = () => {
    const leftH = natural(13, "bold") + 6 + natural(26, "semi");
    const metaRows: [string, string][] = [
      [noun, number],
      ["Host", doc.buyer.legalName],
      ["Period", formatMonth(doc.period.start)],
    ];
    const lW = Math.max(...metaRows.map(([l]) => widthOf(l, 12)));
    const titleW = widthOf("Specification per booking", 26, "semi");
    const maxBlockW = CONTENT_W - titleW - 24;
    const vW = Math.min(
      Math.max(...metaRows.map(([, v], i) => widthOf(v, 12, i === 0 ? "semi" : "regular"))),
      maxBlockW - lW - 16,
    );
    const heights = metaRows.map(([, v], i) =>
      Math.max(natural(12), paragraph(v, 0, 0, vW, { size: 12, weight: i === 0 ? "semi" : "regular" }, natural(12) / 12, false)),
    );
    const rightH = heights.reduce((a, b) => a + b, 0) + 4 * (metaRows.length - 1);
    return { leftH, metaRows, lW, vW, heights, rightH, h: Math.max(leftH, rightH) };
  };

  const specTop = () => {
    let top = 64;
    text("OpenBookings", MARGIN_X, top, { size: 13, weight: "bold", color: ACCENT });
    const { metaRows, lW, vW, heights, rightH, h } = specHeader();
    text("Specification per booking", MARGIN_X, top + h - natural(26, "semi"), { size: 26, weight: "semi" });
    let ry = top + h - rightH;
    metaRows.forEach(([label, value], i) => {
      text(label, RIGHT - vW - 16 - lW, ry, { size: 12, color: GREY });
      paragraph(value, RIGHT - vW, ry, vW, { size: 12, weight: i === 0 ? "semi" : "regular" }, natural(12) / 12, true, "right");
      ry += heights[i]! + 4;
    });
    top += h + 20;
    hline(top, MARGIN_X, RIGHT, RULE);
    top += 1 + 28;
    // Table header.
    const head = { size: 12, weight: "semi" } as const;
    text("Booking", X(COLS.booking), top, head);
    text("Paid", X(COLS.paid + 8), top, head);
    text("Stay", X(COLS.stay + 8), top, head);
    ["Accommodation", "value"].forEach((l, i) => text(l, X(COLS.value - 8), top + i * 14.5, { ...head, right: true }));
    commissionHead.forEach((l, i) => text(l, X(COLS.commission - 8), top + i * 14.5, { ...head, right: true }));
    text("Stripe payment", X(COLS.stripe + 8), top, head);
    top += HEAD_H;
    hline(top, MARGIN_X, RIGHT, INK);
    return top + 1;
  };

  // Pagination: fill pages with rows, leaving room for the short footer; the
  // last page also needs the totals and the longer footer.
  const noteH = paragraph(SPEC_NOTE, 0, 0, CONTENT_W, { size: 12 }, 1.55, false);
  const shortFooterTop = FOOTER_BOTTOM - (1 + 18 + ROW_LH);
  const longFooterTop = FOOTER_BOTTOM - (1 + 18 + noteH + 10 + ROW_LH);
  const headerEnd = 64 + specHeader().h + 20 + 1 + 28 + HEAD_H + 1;
  const pages: SpecRow[][] = [[]];
  let used = headerEnd;
  for (const r of rows) {
    const h = rowHeight(r);
    if (used + h > shortFooterTop - 16 && pages[pages.length - 1]!.length > 0) {
      pages.push([]);
      used = headerEnd;
    }
    pages[pages.length - 1]!.push(r);
    used += h;
  }
  if (used + 28 + totalsH > longFooterTop - 16) pages.push([]);

  pages.forEach((pageRows, pageIndex) => {
    newPage();
    let top = specTop();
    pageRows.forEach((r, i) => {
      const h = rowHeight(r);
      if (r.kind === "fee_refund") pdf.rect(MARGIN_X * PT, top * PT, CONTENT_W * PT, (h - 1) * PT).fill("#f7f7f7");
      const last = pageIndex === pages.length - 1 && i === pageRows.length - 1;
      const ty = top + 9;
      text(r.bookingRef, X(COLS.booking), ty, { size: 12 });
      if (r.refundNote) text(r.refundNote, X(COLS.booking), ty + 12 * 1.45, { size: 12, color: GREY }, 12 * 1.45);
      text(formatDay(r.paidOn), X(COLS.paid + 8), ty, { size: 12 });
      text(formatStay(r.stayStart, r.stayEnd), X(COLS.stay + 8), ty, { size: 12 });
      text(euro(r.base), X(COLS.value - 8), ty, { size: 12, right: true });
      text(euro(r.gross), X(COLS.commission - 8), ty, { size: 12, right: true });
      text(shortenPaymentRef(r.stripePaymentRef), X(COLS.stripe + 8), ty, { size: 12, color: GREY });
      hline(top + h - 0.5, MARGIN_X, RIGHT, last ? INK : ROW_RULE);
      top += h;
    });

    if (pageIndex < pages.length - 1) {
      footer([]);
      return;
    }
    // Totals block on the last page.
    top += 28;
    const bookings = fee;
    const refunds = refund ?? { count: 0, base: 0n, gross: 0n };
    const commCol = [euro(bookings.gross), euro(refunds.gross), euro(bookings.gross + refunds.gross), "Commission"];
    const cW = Math.max(...commCol.map((s) => widthOf(s, 12, "bold")));
    const commRight = RIGHT;
    const valueRight = commRight - cW - 20;
    const lh = natural(12);
    text("Value", valueRight, top, { size: 12, color: GREY, right: true });
    text("Commission", commRight, top, { size: 12, color: GREY, right: true });
    top += lh + 7;
    const lineLeft = RIGHT - 360;
    text(`Bookings (${bookings.count})`, lineLeft, top, { size: 12 });
    text(euro(bookings.base), valueRight, top, { size: 12, right: true });
    text(euro(bookings.gross), commRight, top, { size: 12, right: true });
    top += lh + 7;
    text(`Refunds (${refunds.count})`, lineLeft, top, { size: 12 });
    text(euro(refunds.base), valueRight, top, { size: 12, right: true });
    text(euro(refunds.gross), commRight, top, { size: 12, right: true });
    top += lh + 7;
    hline(top, lineLeft, RIGHT, INK);
    top += 1 + 8;
    text("Total commission", lineLeft, top, { size: 12, weight: "bold" });
    text(euro(bookings.base + refunds.base), valueRight, top, { size: 12, weight: "bold", right: true });
    text(euro(bookings.gross + refunds.gross), commRight, top, { size: 12, weight: "bold", right: true });
    footer([SPEC_NOTE]);
  });

  // ---- "Page x of y" on every page ----------------------------------------
  const count = pdf.bufferedPageRange().count;
  for (let i = 0; i < count; i++) {
    pdf.switchToPage(i);
    const by = bottomRows[i] ?? FOOTER_BOTTOM - ROW_LH;
    text(sellerLegal, MARGIN_X, by, { size: 12, color: LIGHT_GREY }, ROW_LH);
    text(`Page ${i + 1} of ${count}`, RIGHT, by, { size: 12, color: LIGHT_GREY, right: true }, ROW_LH);
  }

  pdf.end();
  await done;
  return new Uint8Array(Buffer.concat(chunks));
}

/** Street lines, then the last line with the country: `3581 AB Utrecht, Netherlands`. */
function addressWithCountry(p: InvoiceDocument["seller"]): string[] {
  const lines = [...p.addressLines];
  if (p.countryName) {
    if (lines.length === 0) lines.push(p.countryName);
    else lines[lines.length - 1] = `${lines[lines.length - 1]}, ${p.countryName}`;
  }
  return lines;
}

function vatLines(p: InvoiceDocument["seller"]): string[] {
  return [...(p.kvk ? [`KvK ${p.kvk}`] : []), ...(p.vatId ? [`VAT ${p.vatId}`] : [])];
}

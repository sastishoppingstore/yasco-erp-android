// Sahl Excel print-tag engine: template configs <-> .xlsx rendering.
// Tags (header): <Data:id|reference|date|time> <Account:title|tax_id|phone>
// <Branch:name> | rows: <Items:title|user_qty|unit|price|total_price|discount|net_price>
// cleaner: <<delete:row>> (blank rows removed) | totals: <Data:total_price|discount|
// <Data:tax_amount|net_price|paid|remaining> <AmountString> | QR: <ZATCA:QR_TLV>

import { FORM0060_B64 } from "./form0060";

export type DocType =
  | "sale" | "quotation" | "purchase" | "sales-return"
  | "payment" | "receipt" | "stocktake" | "transfer";

export interface ColDef { key: string; ar: string; en: string; visible: boolean }
export interface PrintConfig {
  kind: "sahl-xlsx";
  docType: DocType;
  paper: "A4" | "thermal80" | "thermal58";
  titleAr: string;
  titleEn: string;
  headerLines: string[];
  contactLines: string[];
  showSignatures: boolean;
  showTax: boolean;
  showBalances: boolean;
  columns: ColDef[];
  footerText: string;
  accent: string;
}

export const ALL_COLUMNS: ColDef[] = [
  { key: "code", ar: "الكود", en: "Code", visible: true },
  { key: "name", ar: "الصنف", en: "Item", visible: true },
  { key: "unit", ar: "الوحدة", en: "Unit", visible: true },
  { key: "qty", ar: "الكمية", en: "Qty", visible: true },
  { key: "price", ar: "السعر", en: "Price", visible: true },
  { key: "disc", ar: "الخصم", en: "Disc", visible: true },
  { key: "total", ar: "الإجمالي", en: "Total", visible: true },
];

export interface DocLine { code?: string; name: string; nameAr?: string; unit?: string; qty: number; price: number; disc?: number; total: number }
export interface DocData {
  no: string; date: string; time?: string;
  party?: string; partyTax?: string; partyPhone?: string; partyEmail?: string; partyCr?: string; partyAr?: string; branch?: string;
  lines: DocLine[];
  subtotal: number; discount: number; tax: number; net: number;
  paid?: number; notes?: string; notesAr?: string;
  qrText?: string;
  // Which Sahl document this is — lets the print/xlsx gray banner show
  // "Tax Invoice" for sales (مؤسسة name stays on other doc types).
  docType?: DocType;
  // 0060-form extras (all optional; missing values hide their rows like <#if>)
  dueDate?: string; dueDateText?: string; cashier?: string; paymentType?: string;
  additions?: number; additionType?: string;
  qtyTotal?: number; taxPct?: number;
  balBefore?: number; balAfter?: number; hasAccount?: boolean;
  companyTax?: string; companyCr?: string; companyContacts?: string[];
  accountAddress?: string;
  accountAddressAr?: string;
  accountAddressEn?: string;
  labels?: { docNo?: string; party?: string; payment?: string; dueDate?: string; cashier?: string; banner?: string; total?: string; };
  terms?: string;
  origInvoiceNo?: string;
  invoiceType?: "zatca" | "simple";
  hideBalances?: boolean;
  // Reference-workbook design extras
  period?: string;
  po?: string;
}

export const DOC_TITLES: Record<DocType, [string, string]> = {
  sale: ["فاتورة بيع", "Sales invoice"],
  quotation: ["عرض سعر", "Quotation"],
  purchase: ["فاتورة شراء", "Purchase invoice"],
  "sales-return": ["مرتجع بيع", "Sales return"],
  payment: ["سند صرف", "Payment voucher"],
  receipt: ["سند قبض", "Receipt voucher"],
  stocktake: ["جرد مخزن", "Stocktake"],
  transfer: ["تحويل مخزن", "Transfer"],
};

function baseCols(visible: string[]): ColDef[] {
  return ALL_COLUMNS.map((c) => ({ ...c, visible: visible.includes(c.key) }));
}

function stdCfg(p: Partial<PrintConfig> & { docType: DocType }): PrintConfig {
  return {
    kind: "sahl-xlsx", paper: "A4",
    titleAr: "", titleEn: "",
    headerLines: ["", "", ""], contactLines: ["", "", ""],
    showSignatures: true, showTax: true, showBalances: true,
    columns: baseCols(["code", "name", "unit", "qty", "price", "disc", "total"]),
    footerText: "", accent: "#2fae4e",
    ...p,
  };
}

export const BUILTINS: { key: string; name: string; nameAr: string; config: PrintConfig }[] = [
  {
    key: "sales-0060", name: "Sales 0060 (default)", nameAr: "الافتراضي 0060",
    config: stdCfg({
      docType: "sale",
      titleAr: "فاتورة بيع", titleEn: "Sales invoice",
      columns: baseCols(["code", "name", "unit", "qty", "price", "total"]),
    }),
  },
  {
    key: "basic-a4", name: "Basic", nameAr: "أساسي A4",
    config: stdCfg({
      docType: "sale",
      titleAr: "فاتورة بيع", titleEn: "Sales invoice",
    }),
  },
  {
    key: "thermal-80", name: "Small Receipt", nameAr: "حراري 80مم",
    config: stdCfg({
      docType: "sale", paper: "thermal80",
      titleAr: "فاتورة بيع", titleEn: "Sales invoice",
      showSignatures: false,
      columns: baseCols(["name", "qty", "price", "total"]),
      accent: "#111111",
    }),
  },
  {
    key: "corp-01", name: "Template 01", nameAr: "قالب 01",
    config: stdCfg({
      docType: "sale",
      titleAr: "فاتورة ضريبية", titleEn: "Tax invoice",
      columns: baseCols(["code", "name", "qty", "price", "disc", "total"]),
      accent: "#1e40af",
    }),
  },
  {
    key: "indust-02", name: "Template 02", nameAr: "قالب 02",
    config: stdCfg({
      docType: "sale",
      titleAr: "فاتورة بيع", titleEn: "Sales invoice",
      showTax: false,
      columns: baseCols(["code", "name", "unit", "qty", "price", "total"]),
      accent: "#7b2d4e",
    }),
  },
];

// Arabic tafqeet for <AmountString>: e.g. "مائة وخمسة ريال وثمانون هللة فقط لا غير"
const AR_ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة",
  "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const AR_TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
function arTwo(x: number): string {
  if (x < 20) return AR_ONES[x];
  const t = Math.floor(x / 10), o = x % 10;
  return o ? `${AR_ONES[o]} و${AR_TENS[t]}` : AR_TENS[t];
}
function arThree(x: number): string {
  const h = Math.floor(x / 100), r = x % 100;
  let hStr = "";
  if (h === 1) hStr = r ? "مائة و" : "مائة";
  else if (h === 2) hStr = r ? "مائتان و" : "مائتان";
  else if (h > 2) hStr = `${AR_ONES[h]}مائة` + (r ? " و" : "");
  const tail = r ? arTwo(r) : "";
  return `${hStr}${tail}`.replace(/ و$/, "");
}
function arGroup(n: number, one: string, two: string, many: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n <= 10) return `${arThree(n)} ${many}`;
  return `${arThree(n)} ${one}`;
}
function arInt(n: number): string {
  if (n === 0) return "صفر";
  const parts: string[] = [];
  const mil = Math.floor(n / 1e6), tho = Math.floor((n % 1e6) / 1e3), rest = n % 1e3;
  if (mil) parts.push(arGroup(mil, "مليون", "مليونان", "ملايين"));
  if (tho) parts.push(arGroup(tho, "ألف", "ألفان", "آلاف"));
  if (rest) parts.push(arThree(rest));
  return parts.join(" و");
}
export function amountWordsAr(n: number, currency = "ريال", fraction = "هللة"): string {
  if (!Number.isFinite(n)) return "";
  const neg = n < 0 ? "سالب " : "";
  n = Math.abs(Math.round(n * 100) / 100);
  const int = Math.floor(n), dec = Math.round((n - int) * 100);
  let s = `${neg}${arInt(int)} ${currency}`;
  if (dec) s += ` و${arInt(dec)} ${fraction}`;
  return `${s} فقط لا غير`;
}
export function amountWords(n: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number): string => {
    if (x < 20) return ones[x];
    return tens[Math.floor(x / 10)] + (x % 10 ? " " + ones[x % 10] : "");
  };
  const three = (x: number): string => {
    const h = Math.floor(x / 100), r = x % 100;
    return (h ? ones[h] + " Hundred" + (r ? " " : "") : "") + (r ? two(r) : "");
  };
  if (!Number.isFinite(n)) return "";
  const neg = n < 0 ? "Minus " : "";
  n = Math.abs(Math.round(n * 100) / 100);
  const int = Math.floor(n), dec = Math.round((n - int) * 100);
  const parts: string[] = [];
  const mil = Math.floor(int / 1e6), tho = Math.floor((int % 1e6) / 1e3), rest = int % 1e3;
  if (mil) parts.push(three(mil) + " Million");
  if (tho) parts.push(three(tho) + " Thousand");
  if (rest || !parts.length) parts.push(three(rest));
  let s = neg + parts.join(" ");
  if (dec) s += ` and ${dec}/100`;
  return s + " only";
}

// 0060 wording (matches the Excel references): "One Thousand ... SR only"
// or "... SR & Fifty Halalh" when there are halalas.
function amountWordsSr(n: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number): string => {
    if (x < 20) return ones[x];
    return tens[Math.floor(x / 10)] + (x % 10 ? " " + ones[x % 10] : "");
  };
  const three = (x: number): string => {
    const h = Math.floor(x / 100), r = x % 100;
    return (h ? ones[h] + " Hundred" + (r ? " " : "") : "") + (r ? two(r) : "");
  };
  if (!Number.isFinite(n)) return "";
  const neg = n < 0 ? "Minus " : "";
  n = Math.abs(Math.round(n * 100) / 100);
  const int = Math.floor(n), dec = Math.round((n - int) * 100);
  const parts: string[] = [];
  const mil = Math.floor(int / 1e6), tho = Math.floor((int % 1e6) / 1e3), rest = int % 1e3;
  if (mil) parts.push(three(mil) + " Million");
  if (tho) parts.push(three(tho) + " Thousand");
  if (rest || !parts.length) parts.push(three(rest));
  const s = neg + parts.join(" ");
  return dec ? `${s} SR & ${two(dec)} Halalh` : `${s} SR only`;
}

export function resolveTags(cfg: PrintConfig, d: DocData): { rows: string[][]; tags: Record<string, string> } {
  const cols = cfg.columns.filter((c) => c.visible);
  const head = cols.map((c) => c.ar);
  const rows: string[][] = [head];
  for (const l of d.lines) {
    const map: Record<string, string> = {
      code: l.code ?? "", name: l.name, unit: l.unit ?? "",
      qty: String(l.qty), price: Number(l.price).toFixed(2),
      disc: Number(l.disc || 0).toFixed(2), total: Number(l.total).toFixed(2),
    };
    rows.push(cols.map((c) => map[c.key] ?? ""));
  }
  // <<delete:row>> cleaner: drop fully-blank data rows (never header)
  const clean = [rows[0], ...rows.slice(1).filter((r) => r.some((c) => c.trim() !== ""))];
  return {
    rows: clean,
    tags: {
      "<Data:id>": d.no, "<Data:reference>": d.no, "<Data:date>": d.date, "<Data:time>": d.time ?? "",
      "<Account:title>": d.party ?? "", "<Account:tax_id>": d.partyTax ?? "",
      "<Account:phone>": d.partyPhone ?? "", "<Branch:name>": d.branch ?? "",
      "<Data:total_price>": d.subtotal.toFixed(2), "<Data:discount>": d.discount.toFixed(2),
      "<Data:tax_amount>": d.tax.toFixed(2), "<Data:net_price>": d.net.toFixed(2),
      "<Data:paid>": Number(d.paid || 0).toFixed(2),
      "<Data:remaining>": (d.net - Number(d.paid || 0)).toFixed(2),
      "<AmountString>": amountWordsAr(d.net),
    },
  };
}

export async function renderXlsx(cfg: PrintConfig, d: DocData, company: { nameAr?: string; name?: string }): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("invoice", { views: [{ rightToLeft: true }] });
  const narrow = cfg.paper !== "A4";
  ws.columns = [{ width: narrow ? 22 : 18 }, { width: narrow ? 22 : 42 }, { width: 14 }, { width: 14 }, { width: 16 }];
  const accent = cfg.accent || "#2fae4e";

  const title = `${cfg.titleAr} — ${d.no}`;
  const trow = ws.addRow([title]);
  trow.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  trow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + accent.replace("#", "") } };
  ws.mergeCells(`A${trow.number}:E${trow.number}`);
  trow.alignment = { horizontal: "center" };

  ws.addRow([company.nameAr || company.name || ""]);
  ws.addRow([`${d.date}${d.time ? " " + d.time : ""}`, d.party ?? "", d.partyPhone ?? "", d.partyTax ?? ""]);
  for (const h of cfg.headerLines) if (h.trim()) ws.addRow([h]);

  const { rows } = resolveTags(cfg, d);
  const hrow = ws.addRow(rows[0]);
  hrow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  hrow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + accent.replace("#", "") } };
  for (const r of rows.slice(1)) ws.addRow(r);

  ws.addRow([]);
  const tot = (k: string, v: string) => {
    const r = ws.addRow(["", "", "", k, v]);
    r.font = { bold: true };
  };
  tot("Subtotal / الإجمالي", d.subtotal.toFixed(2));
  tot("Discount / الخصم", d.discount.toFixed(2));
  if (cfg.showTax) tot("VAT / الضريبة", d.tax.toFixed(2));
  const net = ws.addRow(["", "", "", "NET / الصافي", d.net.toFixed(2)]);
  net.font = { bold: true, size: 14 };
  ws.addRow(["", "", "", "Words", amountWords(d.net)]);
  if (d.notes) ws.addRow([d.notes]);
  if (cfg.footerText.trim()) ws.addRow([cfg.footerText]);
  if (cfg.showSignatures) {
    ws.addRow([]);
    ws.addRow(["التوقيع / Signature", "", "", "الختم / Stamp", ""]);
  }
  if (d.qrText) {
    try {
      const QRCode = (await import("qrcode")).default;
      const url = await QRCode.toDataURL(d.qrText, { width: 110, margin: 1 });
      const imgId = wb.addImage({ base64: url.split(",")[1], extension: "png" });
      const anchorRow = ws.rowCount + 1;
      ws.addImage(imgId, { tl: { col: 3, row: anchorRow }, ext: { width: 110, height: 110 } });
      ws.addRow(["QR"]);
    } catch { /* QR optional */ }
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// ---------------------------------------------------------------------------
// 0060 ZIP-level patcher — 100% template fidelity.
// The original form-returnsale-0060 file is kept byte-identical EXCEPT:
//  1. sheet1.xml: cell values patched (inline strings / numbers), item row
//     repeated for every line, rows below re-numbered, conditional rows
//     deleted exactly like <#delete row>, merges + dimension updated.
//  2. media/image1.png: the sample QR placeholder is replaced with the real
//     ZATCA QR from the document.
//  3. drawing1.xml: the floating QR anchor follows the Thank-You row.
// Everything else (letterhead text-boxes, YAFCO logo image, fonts, colors,
// A5 page setup, printer settings, sheet2 config) stays untouched — so the
// printed sheet matches the reference file exactly.
// ---------------------------------------------------------------------------
const b64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};
export const bytesToB64 = (u8: Uint8Array): string => {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk)
    s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + chunk)) as any);
  return btoa(s);
};
const escX = (s: any): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const r2 = (x: any): number => Math.round((Number(x) || 0) * 100) / 100;

// 0060 client block: Arabic on the first line, English underneath.
// Old documents only have the joined "EN / AR" address, so split that
// fallback without changing any saved data.
function docPartyLines(d: DocData): { top: string; bottom: string } {
  const en = String(d.party ?? "").trim();
  const ar = String(d.partyAr ?? "").trim();
  const top = ar || en;
  return { top, bottom: en && en !== top ? en : "" };
}
function docAddressLines(d: DocData): { top: string; bottom: string } {
  const raw = String(d.accountAddress ?? "").trim();
  let en = String(d.accountAddressEn ?? "").trim();
  let ar = String(d.accountAddressAr ?? "").trim();
  if (!en && !ar && raw) {
    const parts = raw.split(/\s*\/\s*/).map((x) => x.trim()).filter(Boolean);
    en = parts[0] ?? "";
    if (parts.length > 1) ar = parts.slice(1).join(" / ");
  }
  const top = ar || en;
  return { top, bottom: en && en !== top ? en : "" };
}

// Excel 1900 date-system serial (works for dates after 1900-02-28).
const xlSerial = (dateStr?: string): number | undefined => {
  const m = String(dateStr ?? "").slice(0, 10).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return undefined;
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000);
};
const xlTime = (t?: string): number | undefined => {
  const m = String(t ?? "").match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return undefined;
  return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0)) / 86400;
};

function setCell(rowXml: string, row: number, col: string, val?: string | number | null): string {
  const re = new RegExp(`<c r="${col}${row}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`);
  return rowXml.replace(re, (_m, attrs: string) => {
    const sAttr = (String(attrs).match(/\ss="\d+"/) || [""])[0];
    if (val === undefined || val === null || val === "" || (typeof val === "number" && !isFinite(val)))
      return `<c r="${col}${row}"${sAttr}/>`;
    if (typeof val === "number") return `<c r="${col}${row}"${sAttr}><v>${val}</v></c>`;
    return `<c r="${col}${row}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${escX(val)}</t></is></c>`;
  });
}
// Insert a value right after the anchor cell, with an explicit style (value /
// money / label) instead of cloning the anchor.
function insertCellAfterStyled(
  rowXml: string, row: number, col: string, afterCol: string,
  val: string | number | null | undefined, styleAttr = "",
): string {
  const anchorRe = new RegExp(`<c r="${afterCol}${row}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
  const m = rowXml.match(anchorRe);
  if (!m) return rowXml;
  const found = m[0];
  const sAttr = styleAttr || ((found.match(/\ss="\d+"/) || [""])[0]);
  let cell: string;
  if (val === undefined || val === null || val === "" || (typeof val === "number" && !isFinite(val)))
    cell = `<c r="${col}${row}"${sAttr}/>`;
  else if (typeof val === "number")
    cell = `<c r="${col}${row}"${sAttr}><v>${val}</v></c>`;
  else
    cell = `<c r="${col}${row}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${escX(val)}</t></is></c>`;
  return rowXml.replace(anchorRe, () => found + cell);
}
// The template's first column (A) has no header cell; prepend it in-place.
function prependCell(rowXml: string, row: number, col: string, val: string, styleAttr = ""): string {
  const cell = `<c r="${col}${row}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escX(val)}</t></is></c>`;
  return rowXml.replace(/(<row\b[^>]*>)/, `$1${cell}`);
}
// setCell keeps the existing style; this applies a different one afterwards
// (used when a totals label moves from F to the G column).
function restyleCell(rowXml: string, row: number, col: string, style: number): string {
  const re = new RegExp(`<c r="${col}${row}"([^>]*?)(/>|>)`);
  return rowXml.replace(re, (_m, attrs: string, close: string) => {
    const clean = String(attrs).replace(/\s+s="\d+"/, "");
    return `<c r="${col}${row}"${clean} s="${style}"${close}`;
  });
}
function renumRow(rowXml: string, oldRow: number, newRow: number): string {
  let xml = rowXml;
  if (oldRow !== newRow) {
    xml = xml
      .replace(new RegExp(`<row r="${oldRow}"`), `<row r="${newRow}"`)
      .replace(new RegExp(`(r="[A-I]{1,2})${oldRow}(")`, "g"), `$1${newRow}$2`);
  }
  // The new grid reaches column I, and row 16 gains an A cell, so make the
  // span hint cover A:I instead of leaving cells outside the declared range.
  return xml.replace(/spans="\d+:\d+"/, `spans="1:9"`);
}

// The 0060 template has no left-aligned wrapping data style. Add one to
// styles.xml and return its cellXfs index so the Job Description column can
// wrap long text instead of clipping it.
function ensureWrapStyle(stylesXml: string): { xml: string; index: number } {
  const m = stylesXml.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
  if (!m) return { xml: stylesXml, index: 0 };
  const count = Number(m[1]);
  const xf = `<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>`;
  return {
    xml: stylesXml.replace(m[0], `<cellXfs count="${count + 1}">${m[2]}${xf}</cellXfs>`),
    index: count,
  };
}

function patchSheet060(
  sheet: string, cfg: PrintConfig, d: DocData,
  company: { nameAr?: string; name?: string; tax?: string },
  wrapStyle = 0,
): { xml: string; thankRow: number } {
  const rows = new Map<number, string>();
  const rowRe = /<row r="(\d+)"[^>]*(?:\/>|>[\s\S]*?<\/row>)/g;
  let mm: RegExpExecArray | null;
  while ((mm = rowRe.exec(sheet))) rows.set(Number(mm[1]), mm[0]);

  const note = String(d.notes ?? "").trim();
  const terms = String(d.terms ?? "").trim();
  const origNote = d.origInvoiceNo ? `Original Invoice: ${d.origInvoiceNo}` : "";
  const noteCell = [note, terms ? `Terms: ${terms}` : "", origNote].filter(Boolean).join("\n");
  const addl = r2(d.additions ?? 0);
  const disc = r2(d.discount ?? 0);
  const net = r2(d.net ?? 0);
  const taxPct = Number(d.taxPct ?? 15);
  const isCreditType = /آجل|credit|deferred|ذمم/i.test(String(d.paymentType || ""));
  const paid = d.paid != null ? r2(d.paid) : (isCreditType ? 0 : net);
  const creditDue = r2(net - paid);
  const lines = d.lines ?? [];
  const qtyTotal = d.qtyTotal ?? lines.reduce((a, l) => a + Number(l.qty || 0), 0);
  const linesTotal = r2(lines.reduce((a, l) => a + r2(l.total), 0));
  const subtotal = r2(d.subtotal || linesTotal);
  // Invoice-level discount is spread over the lines so the per-line VAT and
  // Grand Total columns still add up to the invoice totals.
  const discountFactor = subtotal > 0 ? Math.max(0, subtotal - disc) / subtotal : 1;
  const companyName = company.nameAr || company.name || "";
  const contacts = (d.companyContacts?.length ? d.companyContacts : (cfg.contactLines ?? []))
    .map((x) => String(x ?? "")).filter((x) => x.trim());
  const client = docPartyLines(d);
  const address = docAddressLines(d);

  // Style indexes are copied from the untouched template cells, so this keeps
  // working even if the embedded form is ever regenerated.
  const styleOf = (oldRow: number, col: string): number => {
    const m = rows.get(oldRow)?.match(new RegExp(`<c r="${col}${oldRow}"([^>]*)`));
    return Number((m?.[1].match(/\ss="(\d+)"/) || [])[1] ?? 0);
  };
  const valueStyle = styleOf(9, "C") || 5;
  const labelStyle = styleOf(9, "D") || 4;
  const headerStyle = styleOf(16, "B") || 1;
  const itemDescStyle = wrapStyle || styleOf(17, "C") || 16;
  const itemCenterStyle = styleOf(17, "D") || 2;
  const itemMoneyStyle = styleOf(17, "F") || 10;
  const totalLabelStyle = styleOf(18, "F") || labelStyle;
  const totalMoneyStyle = styleOf(18, "G") || 10;
  // Totals: labels sit in H (VAT column) and amounts in I (Grand Total), the
  // same alignment the DC SEP form uses.
  const amountI = (xml: string, row: number, val: number, moneyStyle: number): string => {
    let x = xml;
    if (!new RegExp(`<c r="I${row}"`).test(x))
      x = insertCellAfterStyled(x, row, "I", "H", val, ` s="${moneyStyle}"`);
    else x = setCell(x, row, "I", val);
    return x;
  };
  const labelH = (xml: string, row: number, label: string, style: number): string => {
    let x = setCell(xml, row, "F", null);
    x = setCell(x, row, "G", null);
    if (!new RegExp(`<c r="H${row}"`).test(x))
      x = insertCellAfterStyled(x, row, "H", "G", label, ` s="${style}"`);
    else {
      x = setCell(x, row, "H", label);
      x = restyleCell(x, row, "H", style);
    }
    return x;
  };

  // Output row plan (template row numbers, item row repeated per line).
  type Step = { old: number; itemIdx?: number; headAr?: boolean };
  const plan: Step[] = [];
  for (let r = 7; r <= 14; r++) plan.push({ old: r });
  if (note || terms || origNote) plan.push({ old: 15 });
  plan.push({ old: 16, headAr: true });
  plan.push({ old: 16 });
  const nItems = Math.max(1, lines.length);
  for (let i = 0; i < nItems; i++) plan.push({ old: 17, itemIdx: i });
  plan.push({ old: 18 });
  if (addl !== 0) plan.push({ old: 19 });
  if (disc !== 0) plan.push({ old: 20 });
  plan.push({ old: 21 });
  plan.push({ old: 22 });
  if (!d.hideBalances) plan.push({ old: 23 });
  if (!d.hideBalances && creditDue !== 0) plan.push({ old: 24 });
  if (!d.hideBalances && d.hasAccount) { plan.push({ old: 25 }); plan.push({ old: 26 }); }
  plan.push({ old: 28 });
  plan.push({ old: 29 }); plan.push({ old: 30 }); plan.push({ old: 31 });

  const out: string[] = [];
  let r = 7;
  let thankRow = 28;
  let noteRow = 0;
  for (const step of plan) {
    const tpl = rows.get(step.old);
    if (!tpl) continue;
    let xml = renumRow(tpl, step.old, r);
    // Drop the template's column-I control cells (<#if ... delete row>) before
    // the new I (Grand Total) column is written.
    xml = xml.replace(/<c r="I\d+"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g, "");
    if (step.itemIdx != null) {
      const l = lines[step.itemIdx];
      const disp = l ? (() => { const n = String(l.name ?? "").replace(/^\[(?:custom-)?\d+\]\s*/, "").trim(); const a = String(l.nameAr ?? "").trim(); return a && a !== n ? `${n ? n + " / " : ""}${a}` : n || a; })() : "";
      const qty = Number(l?.qty || 0);
      const price = r2(l?.price ?? 0);
      const gross = r2(qty * price);
      const lineTotal = r2(l?.total ?? gross);
      const lineBase = r2(lineTotal * discountFactor);
      const lineVat = r2(lineBase * taxPct / 100);
      const lineGrand = r2(lineBase + lineVat);
      // Give two-line descriptions enough height so the wrapped text is not
      // clipped when Excel opens the generated workbook.
      const descLines = Math.ceil(disp.length / 16);
      const needH = descLines > 1 ? Math.min(96, descLines * 12 + 4) : 0;
      if (needH) xml = xml.replace(new RegExp(`<row r="${r}"`), `<row r="${r}" ht="${needH}" customHeight="1"`);
      // A Item No | B Job Description | C Unit | D Hours | E Hour Price |
      // F Price | G Total | H VAT | I Grand Total
      xml = setCell(xml, r, "A", l ? step.itemIdx + 1 : null);
      xml = setCell(xml, r, "B", l ? (disp || null) : null);
      xml = restyleCell(xml, r, "B", itemDescStyle);
      xml = setCell(xml, r, "C", l ? (l.unit || null) : null);
      xml = restyleCell(xml, r, "C", itemCenterStyle);
      xml = setCell(xml, r, "D", l ? qty : null);
      xml = restyleCell(xml, r, "D", itemCenterStyle);
      xml = setCell(xml, r, "E", l ? price : null);
      xml = restyleCell(xml, r, "E", itemMoneyStyle);
      xml = setCell(xml, r, "F", l ? gross : null);
      xml = restyleCell(xml, r, "F", itemMoneyStyle);
      xml = setCell(xml, r, "G", l ? lineTotal : null);
      xml = restyleCell(xml, r, "G", itemMoneyStyle);
      xml = insertCellAfterStyled(xml, r, "H", "G", l ? lineVat : null, ` s="${itemMoneyStyle}"`);
      xml = insertCellAfterStyled(xml, r, "I", "H", l ? lineGrand : null, ` s="${itemMoneyStyle}"`);
    } else {
      switch (step.old) {
        case 7:
          // No Arabic document title: the gray banner carries "Tax Invoice".
          xml = setCell(xml, r, "B", null);
          xml = setCell(xml, r, "C", d.labels?.banner ?? (cfg.docType === "sale" ? (d.invoiceType === "simple" ? "Invoice" : "Tax Invoice") : companyName));
          break;
        case 8:
          xml = setCell(xml, r, "B", "Tax No.");
          xml = restyleCell(xml, r, "B", labelStyle);
          xml = setCell(xml, r, "C", d.partyTax || null);
          xml = restyleCell(xml, r, "C", valueStyle);
          xml = setCell(xml, r, "D", null);
          xml = setCell(xml, r, "E", "C.R. No.");
          xml = restyleCell(xml, r, "E", labelStyle);
          xml = insertCellAfterStyled(xml, r, "F", "E", d.partyCr || null, ` s="${valueStyle}"`);
          break;
        case 9:
          xml = setCell(xml, r, "B", d.labels?.docNo ?? "Doc. No.");
          xml = setCell(xml, r, "C", d.no);
          xml = setCell(xml, r, "D", null);
          xml = insertCellAfterStyled(xml, r, "E", "D", d.labels?.party ?? "Client", ` s="${labelStyle}"`);
          xml = insertCellAfterStyled(xml, r, "F", "E", client.top || null, ` s="${valueStyle}"`);
          break;
        case 10:
          xml = setCell(xml, r, "B", d.labels?.payment ?? "Payment");
          xml = setCell(xml, r, "C", d.paymentType ?? null);
          xml = setCell(xml, r, "D", null);
          xml = insertCellAfterStyled(xml, r, "E", "D", null, ` s="${labelStyle}"`);
          xml = insertCellAfterStyled(xml, r, "F", "E", client.bottom || null, ` s="${valueStyle}"`);
          break;
        case 11:
          xml = setCell(xml, r, "B", "Date");
          xml = setCell(xml, r, "C", xlSerial(d.date) ?? null);
          xml = setCell(xml, r, "D", null);
          xml = insertCellAfterStyled(xml, r, "E", "D", "Address", ` s="${labelStyle}"`);
          xml = insertCellAfterStyled(xml, r, "F", "E", address.top || null, ` s="${valueStyle}"`);
          break;
        case 12:
          xml = setCell(xml, r, "B", "Time");
          xml = setCell(xml, r, "C", xlTime(d.time) ?? null);
          xml = setCell(xml, r, "D", null);
          xml = insertCellAfterStyled(xml, r, "E", "D", "Tax No.", ` s="${labelStyle}"`);
          xml = insertCellAfterStyled(xml, r, "F", "E", d.partyTax || null, ` s="${valueStyle}"`);
          break;
        case 13:
          xml = setCell(xml, r, "B", d.labels?.dueDate ?? "Due Date");
          xml = setCell(xml, r, "C", d.dueDateText ? d.dueDateText : (xlSerial(d.dueDate || d.date) ?? null));
          xml = setCell(xml, r, "D", null);
          xml = insertCellAfterStyled(xml, r, "E", "D", "C.R. No.", ` s="${labelStyle}"`);
          xml = insertCellAfterStyled(xml, r, "F", "E", d.partyCr || null, ` s="${valueStyle}"`);
          break;
        case 14: {
          xml = setCell(xml, r, "B", d.labels?.cashier ?? "Owner Name");
          xml = setCell(xml, r, "C", d.cashier ?? null);
          xml = insertCellAfterStyled(xml, r, "D", "C", null, ` s="${labelStyle}"`);
          break;
        }
        case 15: {
          noteRow = r;
          const noteLines = noteCell.split(/\n/).reduce((a, line) => a + Math.max(1, Math.ceil(line.length / 60)), 0);
          xml = xml.replace(new RegExp(`<row r="${r}"`), `<row r="${r}" ht="${Math.max(15, Math.min(90, noteLines * 12 + 4))}" customHeight="1"`);
          xml = setCell(xml, r, "C", noteCell);
          xml = restyleCell(xml, r, "C", itemDescStyle);
          break;
        }
        case 16: {
          const ar = !!step.headAr;
          const labels = ar
            ? ["مسلسل", "الوصف / الفئة", "الوحدة", "الكمية", "السعر الافرادي", "السعر", "الاجمالي", "ض القيمة المضافة", "الإجمالي بالضريبة"]
            : ["Item No.", "Job Description", "Unit", "Hours", "Hour Price", "Price", "Total", "VAT", "Grand Total"];
          xml = xml.replace(/(<row\b[^>]*?)\s+ht="[^"]*"/, "$1");
          xml = xml.replace(/(<row\b[^>]*?)\s+customHeight="[^"]*"/, "$1");
          xml = xml.replace(new RegExp(`<row r="${r}"`), `<row r="${r}" ht="${ar ? 30 : 26}" customHeight="1"`);
          xml = prependCell(xml, r, "A", labels[0], ` s="${headerStyle}"`);
          for (let c = 0; c < 6; c++) xml = setCell(xml, r, "BCDEFG"[c], labels[c + 1]);
          xml = insertCellAfterStyled(xml, r, "H", "G", labels[7], ` s="${headerStyle}"`);
          xml = insertCellAfterStyled(xml, r, "I", "H", labels[8], ` s="${headerStyle}"`);
          break;
        }
        case 18: {
          xml = setCell(xml, r, "B", null);
          xml = insertCellAfterStyled(xml, r, "C", "B", null, ` s="${itemCenterStyle}"`);
          xml = insertCellAfterStyled(xml, r, "D", "C", qtyTotal, ` s="${itemCenterStyle}"`);
          xml = setCell(xml, r, "E", null);
          xml = labelH(xml, r, "Total", totalLabelStyle);
          xml = amountI(xml, r, subtotal, totalMoneyStyle);
          break;
        }
        case 19:
          xml = labelH(xml, r, d.additionType || "Additions", totalLabelStyle);
          xml = amountI(xml, r, addl, totalMoneyStyle);
          break;
        case 20:
          xml = labelH(xml, r, "Discount", totalLabelStyle);
          xml = amountI(xml, r, disc, totalMoneyStyle);
          break;
        case 21:
          xml = labelH(xml, r, `VAT ${taxPct}%`, totalLabelStyle);
          xml = amountI(xml, r, r2(d.tax), totalMoneyStyle);
          break;
        case 22:
          xml = setCell(xml, r, "C", amountWordsSr(net));
          xml = labelH(xml, r, d.labels?.total ?? "Due", totalLabelStyle);
          xml = amountI(xml, r, net, totalMoneyStyle);
          break;
        case 23:
          xml = labelH(xml, r, "Paid", totalLabelStyle);
          xml = amountI(xml, r, paid, totalMoneyStyle);
          break;
        case 24:
          xml = labelH(xml, r, "Credit", totalLabelStyle);
          xml = amountI(xml, r, creditDue, totalMoneyStyle);
          break;
        case 25:
          xml = labelH(xml, r, "Bal. Prior", totalLabelStyle);
          xml = amountI(xml, r, r2(d.balBefore ?? 0), totalMoneyStyle);
          break;
        case 26:
          xml = labelH(xml, r, "Bal. After", totalLabelStyle);
          xml = amountI(xml, r, r2(d.balAfter ?? d.balBefore ?? 0), totalMoneyStyle);
          break;
        case 28: thankRow = r; break;
        case 29: case 30: case 31:
          xml = setCell(xml, r, "B", contacts[step.old - 29] ?? null);
          break;
      }
    }
    out.push(xml);
    r++;
  }

  const s0 = sheet.indexOf("<sheetData>");
  const s1 = sheet.indexOf("</sheetData>");
  if (s0 < 0 || s1 < 0) return { xml: sheet, thankRow };
  let xml = sheet.slice(0, s0) + "<sheetData>" + out.join("") + "</sheetData>" + sheet.slice(s1 + "</sheetData>".length);
  xml = xml.replace(/<dimension ref="[^"]*"[^>]*\/>/, `<dimension ref="A7:I${r - 1}"/>`);
  const merges = [`C7:I7`, ...(noteRow ? [`C${noteRow}:I${noteRow}`] : []), `B${thankRow}:I${thankRow}`];
  xml = xml.replace(
    /<mergeCells count="\d+">[\s\S]*?<\/mergeCells>/,
    `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>`,
  );
  // 9-column grid (DC SEP style): A Item No, B Job Description, C Unit,
  // D Hours, E Hour Price, F Price, G Total, H VAT, I Grand Total.
  xml = xml.replace(/<cols>[\s\S]*?<\/cols>/, `<cols>` +
    `<col min="1" max="1" width="8" style="5" bestFit="1" customWidth="1"/>` +
    `<col min="2" max="2" width="15" style="5" customWidth="1"/>` +
    `<col min="3" max="3" width="11.5" style="5" customWidth="1"/>` +
    `<col min="4" max="4" width="7.5" style="5" customWidth="1"/>` +
    `<col min="5" max="5" width="9.5" style="5" customWidth="1"/>` +
    `<col min="6" max="6" width="10" style="5" customWidth="1"/>` +
    `<col min="7" max="7" width="10" style="5" customWidth="1"/>` +
    `<col min="8" max="8" width="10" style="5" customWidth="1"/>` +
    `<col min="9" max="9" width="12" style="5" customWidth="1"/>` +
    `<col min="10" max="16384" width="11.5703125" style="5"/>` +
    `</cols>`);
  // The 9-column grid is wider than A5: force one-page-wide printing.
  if (!/<sheetPr\b/.test(xml)) {
    xml = xml.replace(/(<worksheet\b[^>]*>)/, `$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`);
  } else if (/<sheetPr\b[^>]*\/>/.test(xml)) {
    xml = xml.replace(/<sheetPr\b[^>]*\/>/, `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`);
  } else if (!/fitToPage=/.test(xml)) {
    xml = xml.replace(/(<sheetPr\b[^>]*>)/, `$1<pageSetUpPr fitToPage="1"/>`);
  }
  xml = xml.replace(/<pageSetup\b[^>]*\/>/, (m) =>
    m.replace(/\s+(?:fitToWidth|fitToHeight|scale)="[^"]*"/g, "").replace(/\s*\/>$/, ` fitToWidth="1" fitToHeight="0"/>`));
  return { xml, thankRow };
}

export async function render060(
  cfg: PrintConfig, d: DocData,
  company: { nameAr?: string; name?: string; tax?: string; logoBase64?: string },
): Promise<Blob> {
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(FORM0060_B64, { base64: true });
    const sheetFile = zip.file("xl/worksheets/sheet1.xml");
    if (!sheetFile) throw new Error("0060 template: sheet1 missing");
    let wrapStyle = 0;
    const stylesFile = zip.file("xl/styles.xml");
    if (stylesFile) {
      const w = ensureWrapStyle(await stylesFile.async("string"));
      zip.file("xl/styles.xml", w.xml);
      wrapStyle = w.index;
    }
    const { xml: patchedSheet, thankRow } = patchSheet060(await sheetFile.async("string"), cfg, d, company, wrapStyle);
    zip.file("xl/worksheets/sheet1.xml", patchedSheet);

    // real ZATCA QR replaces the sample QR placeholder (media/image1.png)
    if (d.qrText) {
      try {
        const QRCode = (await import("qrcode")).default;
        const url = await QRCode.toDataURL(d.qrText, { width: 260, margin: 0, errorCorrectionLevel: "M" });
        zip.file("xl/media/image1.png", b64ToBytes(url.split(",")[1]));
      } catch { /* keep placeholder */ }
    }
    // Company logo (Settings → Company) replaces the sample letterhead logo
    // (media/image2.jpeg) so the exported sheet carries OUR logo.
    const logoBytes = await logoToJpegBytes(company.logoBase64);
    if (logoBytes) zip.file("xl/media/image2.jpeg", logoBytes);
    // floating QR anchor follows the Thank-You row (template: rows 28..33)
    try {
      const drawFile = zip.file("xl/drawings/drawing1.xml");
      if (drawFile) {
        const drw = await drawFile.async("string");
        const m = drw.match(/<xdr:twoCellAnchor[^>]*>[\s\S]*?<\/xdr:twoCellAnchor>/);
        if (m) {
          let a = m[0];
          a = a.replace(/(<xdr:from>[\s\S]*?<xdr:row>)\d+(<\/xdr:row>)/, `$1${thankRow}$2`);
          a = a.replace(/(<xdr:to>[\s\S]*?<xdr:row>)\d+(<\/xdr:row>)/, `$1${thankRow + 5}$2`);
          zip.file("xl/drawings/drawing1.xml", drw.replace(m[0], a));
        }
      }
    } catch { /* keep original anchors */ }

    const out = await zip.generateAsync({
      type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 },
    });
    return new Blob([out as any], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  } catch {
    return render060Scratch(cfg, d, company as any);
  }
}

// Turn the company logo (data URL or raw base64) into JPEG bytes so it can
// replace the template's xl/media/image2.jpeg without breaking the file.
async function logoToJpegBytes(logo?: string | null): Promise<Uint8Array | null> {
  if (!logo) return null;
  try {
    const raw = String(logo).trim();
    const m = raw.match(/^data:(image\/[a-zA-Z+]+);base64,(.*)$/s);
    const mime = m ? m[1] : "";
    const b64 = m ? m[2] : raw;
    if (!b64) return null;
    if (mime === "image/jpeg" || mime === "image/jpg") return b64ToBytes(b64);
    // PNG / SVG / WEBP → draw on a canvas and export as JPEG (keeps the
    // template's .jpeg part name and content type intact).
    const src = mime ? `data:${mime};base64,${b64}` : `data:image/png;base64,${b64}`;
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = src;
    });
    if (!img) return null;
    const maxW = 320;
    const scale = Math.min(1, maxW / (img.width || maxW));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round((img.width || maxW) * scale));
    cv.height = Math.max(1, Math.round((img.height || maxW) * scale));
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const dataUrl = cv.toDataURL("image/jpeg", 0.92);
    return b64ToBytes(dataUrl.split(",")[1]);
  } catch {
    return null;
  }
}

// ZATCA Phase-2 TLV base64 (fields 1-5) — used when an invoice has no
// stored zatcaQrCode so the QR slot still shows a valid e-invoice QR.
export function zatcaQrTlv(f: { seller: string; vat: string; timestamp: string; total: string | number; tax: string | number }): string {
  const enc = (tag: number, val: string): Uint8Array => {
    const b = new TextEncoder().encode(val);
    // Long Arabic seller names run past 127 UTF-8 bytes, and a one-byte
    // length then wraps — the QR stops decoding.
    const head = b.length < 128 ? [tag, b.length] : [tag, 0x81, b.length];
    const out = new Uint8Array(head.length + b.length);
    out.set(head, 0); out.set(b, head.length);
    return out;
  };
  const parts = [
    enc(1, f.seller), enc(2, f.vat), enc(3, f.timestamp),
    enc(4, Number(f.total || 0).toFixed(2)), enc(5, Number(f.tax || 0).toFixed(2)),
  ];
  const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return bytesToB64(all);
}

// ZATCA wants the issue time as ISO-8601 with an offset; the ledger times in
// this app are KSA wall clock.
export function zatcaTimestamp(date?: string, time?: string): string {
  const day = /^\d{4}-\d{2}-\d{2}/.test(String(date || "")) ? String(date).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const t = String(time || "").trim();
  const hm = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const pad = (v: number) => String(v).padStart(2, "0");
  const clock = hm ? `${pad(Number(hm[1]) % 24)}:${pad(Number(hm[2]) % 60)}:${pad(Number(hm[3] || 0) % 60)}` : "00:00:00";
  return `${day}T${clock}+03:00`;
}

// render060Scratch: original from-scratch builder (kept as fallback).
async function render060Scratch(
  cfg: PrintConfig, d: DocData,
  company: { nameAr?: string; name?: string; tax?: string; logoBase64?: string },
): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("invoice", { views: [{ rightToLeft: true }] });
  ws.columns = [
    { width: 5 }, { width: 30 }, { width: 8 }, { width: 7 },
    { width: 10 }, { width: 10 }, { width: 10 }, { width: 9 }, { width: 12 },
  ];
  const accent = (cfg.accent || "#2fae4e").replace("#", "");
  const acc = "FF" + accent;
  const head = (txt: string) => {
    const r = ws.addRow(["", txt]);
    r.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: acc } };
    ws.mergeCells(`A${r.number}:I${r.number}`);
    r.alignment = { horizontal: "center" };
    return r;
  };
  const kv = (label: string, value: string, label2 = "", value2 = "") => {
    const r = ws.addRow(["", label, value, label2, value2]);
    r.getCell(2).font = { bold: true };
    return r;
  };

  head(cfg.titleEn || "");
  const co = company.nameAr || company.name || "";
  ws.addRow(["", "", co]);
  if (company.tax) ws.addRow(["", "", "", "", `Tax No. ${company.tax}`]);
  kv("Doc. No.", d.no, "Client", d.party ?? "");
  kv("Payment", d.paymentType ?? "", "", "");
  kv("Tax No.", d.partyTax ?? "", "C.R. No.", d.partyCr ?? "");
  kv("Date", d.date, "Address", d.accountAddress ?? "");
  kv("Time", d.time ?? "", "", "");
  kv("Due Date", d.dueDate ?? d.date, "", "");
  kv("Owner Name", d.cashier ?? "", "", "");
  kv("Remarks", d.notes ?? "", "", "");
  const itemHead = ws.addRow(["Item No.", "Job Description", "Unit", "Hours", "Hour Price", "Price", "Total", "VAT", "Grand Total"]);
  itemHead.font = { bold: true, color: { argb: "FFFFFFFF" } };
  itemHead.fill = { type: "pattern", pattern: "solid", fgColor: { argb: acc } };
  const subTot = Number(d.subtotal || 0);
  const discFactor = subTot > 0 ? Math.max(0, subTot - Number(d.discount || 0)) / subTot : 1;
  let sn = 0;
  for (const l of d.lines) {
    sn++;
    const lineBase = Math.round(Number(l.total) * discFactor * 100) / 100;
    const lineVat = Math.round(lineBase * Number(d.taxPct ?? 15) / 100 * 100) / 100;
    ws.addRow([sn, l.name, l.unit ?? "", l.qty,
      Number(l.price).toFixed(2), Number(l.qty * l.price).toFixed(2), Number(l.total).toFixed(2),
      lineVat.toFixed(2), (lineBase + lineVat).toFixed(2)]);
  }
  const qtyTot = d.qtyTotal ?? d.lines.reduce((a, l) => a + Number(l.qty || 0), 0);
  ws.addRow(["", "", "", qtyTot, "", "", "", "Total", subTot.toFixed(2)]);
  if ((d.additions ?? 0) !== 0)
    ws.addRow(["", "", "", "", "", "", "", d.additionType ?? "Additions", Number(d.additions).toFixed(2)]);
  if (d.discount !== 0)
    ws.addRow(["", "", "", "", "", "", "", "Discount", d.discount.toFixed(2)]);
  if (cfg.showTax)
    ws.addRow(["", "", "", "", "", "", "", `VAT ${d.taxPct ?? 15}%`, d.tax.toFixed(2)]);
  const due = ws.addRow(["", "Due", amountWordsSr(d.net), "", "", "", "", "Due", d.net.toFixed(2)]);
  due.font = { bold: true };
  ws.addRow(["", "", "", "", "", "", "", "Paid", Number(d.paid || 0).toFixed(2)]);
  const remaining = d.net - Number(d.paid || 0);
  if (remaining !== 0)
    ws.addRow(["", "", "", "", "", "", "", "Credit", remaining.toFixed(2)]);
  if (cfg.showBalances !== false && d.hasAccount) {
    ws.addRow(["", "", "", "", "", "", "", "Bal. Prior", Number(d.balBefore ?? 0).toFixed(2)]);
    ws.addRow(["", "", "", "", "", "", "", "Bal. After", Number(d.balAfter ?? d.balBefore ?? 0).toFixed(2)]);
  }
  const th = ws.addRow(["", "Thank You"]);
  th.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  th.fill = { type: "pattern", pattern: "solid", fgColor: { argb: acc } };
  ws.mergeCells(`A${th.number}:I${th.number}`);
  th.alignment = { horizontal: "center" };
  const contacts = d.companyContacts?.length ? d.companyContacts : (cfg.contactLines ?? []);
  for (const c of contacts) if (c && c.trim()) ws.addRow(["", c]);
  if (cfg.footerText.trim()) ws.addRow(["", cfg.footerText]);
  if (company.logoBase64) {
    try {
      const jpg = await logoToJpegBytes(company.logoBase64);
      if (jpg) {
        const imgId = wb.addImage({ base64: bytesToB64(jpg), extension: "jpeg" });
        ws.addImage(imgId, { tl: { col: 7, row: 0 }, ext: { width: 90, height: 60 } });
      }
    } catch { /* logo optional */ }
  }
  if (d.qrText) {
    try {
      const QRCode = (await import("qrcode")).default;
      const url = await QRCode.toDataURL(d.qrText, { width: 100, margin: 1 });
      const imgId = wb.addImage({ base64: url.split(",")[1], extension: "png" });
      const anchorRow = ws.rowCount + 1;
      ws.addImage(imgId, { tl: { col: 0, row: anchorRow }, ext: { width: 100, height: 100 } });
      ws.addRow(["QR"]);
    } catch { /* QR optional */ }
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function downloadBlob(blob: Blob, name: string) {  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// Import: parse an .xlsx file back into a template config (tags detected).
export async function importXlsx(file: File, docType: DocType): Promise<Partial<PrintConfig>> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
  const found = new Set<string>();
  const tags = ["code", "name", "unit", "qty", "price", "disc", "total"];
  const colTag: Record<string, RegExp> = {
    name: /<Items:\s*title\s*>/,
    qty: /<Items:\s*user_qty\s*>/,
    unit: /<Items:\s*unit\s*>/,
    price: /<Items:\s*price\s*>/,
    disc: /<Items:\s*discount\s*>/,
    total: /<Items:\s*(total_price|net_price)\s*>/,
    code: /<Data:\s*id\s*>|<Items:\s*code\s*>/,
  };
  for (const row of grid) {
    for (const cell of row) {
      for (const k of tags) if (colTag[k].test(cell)) found.add(k);
    }
  }
  const title = grid.flat().find((c) => c && !c.startsWith("<") && c.trim().length > 1) ?? "";
  return {
    kind: "sahl-xlsx",
    docType,
    paper: "A4",
    titleAr: title.slice(0, 60),
    titleEn: "",
    headerLines: ["", "", ""],
    showSignatures: true,
    showTax: true,
    columns: ALL_COLUMNS.map((c) => ({ ...c, visible: found.size ? found.has(c.key) : c.visible })),
    footerText: "",
    accent: "#2fae4e",
  };
}

export function printHtml(title: string, bodyHtml: string) {
  const f = document.createElement("iframe");
  f.style.display = "none";
  document.body.appendChild(f);
  const doc = f.contentDocument!;
  doc.open();
  doc.write(`<html dir="rtl"><head><title>${title}</title><style>
    body{font-family:Tahoma,Arial;font-size:12px;color:#000}
    table{width:100%;border-collapse:collapse}th,td{border:1px solid #555;padding:4px;text-align:center}
    th{background:#2fae4e;color:#fff}h1{text-align:center;font-size:18px}
    .tot{text-align:left;font-weight:bold;margin-top:8px}
  </style></head><body>${bodyHtml}</body></html>`);
  doc.close();
  setTimeout(() => { f.contentWindow!.print(); setTimeout(() => f.remove(), 2000); }, 300);
}

// ---------------------------------------------------------------------------
// A4 print view of form-returnsale-0060: same design as the .xlsx output
// (letterhead boxes + YAFCO logo, gray title/thanks banners, items grid,
// totals block, contacts + floating ZATCA QR) rendered as a real A4 document
// so "Save as PDF" produces the invoice itself — not a screenshot of the app.
// ---------------------------------------------------------------------------
function invoice060Html(
  d: DocData,
  company: { nameAr?: string; name?: string; tax?: string; taxNumber?: string; crNumber?: string; address?: string; addressAr?: string },
  title: string, logoUrl: string, qrUrl: string,
): string {
  const esc = (x: any) => String(x ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const n2 = (x: any) => (Number(x) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const addl = Number(d.additions ?? 0);
  const disc = Number(d.discount ?? 0);
  const net = Number(d.net || 0);
  const isCreditType = /آجل|credit|deferred|ذمم/i.test(String(d.paymentType || ""));
  const paid = d.paid != null ? Number(d.paid) : (isCreditType ? 0 : net);
  const creditDue = Math.round((net - paid) * 100) / 100;
  const lines = d.lines ?? [];
  const qtyTotal = d.qtyTotal ?? lines.reduce((a, l) => a + Number(l.qty || 0), 0);
  const subtotal = Number(d.subtotal || lines.reduce((a, l) => a + Number(l.total || 0), 0));
  const taxPct = Number(d.taxPct ?? 15);
  const discountFactor = subtotal > 0 ? Math.max(0, subtotal - disc) / subtotal : 1;
  const contacts = (d.companyContacts ?? []).map((x) => String(x ?? "")).filter((x) => x.trim());
  const co = company.nameAr || company.name || "";
  const coAddrEn = String(company.address ?? "").trim();
  const coAddrAr = String(company.addressAr ?? "").trim();
  const words = amountWordsSr(net);
  const client = docPartyLines(d);
  const address = docAddressLines(d);
  const twoLine = (top: string, bottom: string) =>
    [top, bottom].filter(Boolean).map((x) => `<div dir="auto">${esc(x)}</div>`).join("");
  const noteTxt = [String(d.notes ?? ""), d.terms ? `Terms: ${String(d.terms)}` : "", d.origInvoiceNo ? `Original Invoice: ${String(d.origInvoiceNo)}` : ""]
    .filter((x) => x !== "").join("\n");
  const cleanIt = (s: any) => String(s ?? "").replace(/^\[(?:custom-)?\d+\]\s*/, "").trim();
  const itRows = lines.length
    ? lines.map((l, i) => {
        const lineTotal = Number(l.total || 0);
        const lineBase = Math.round(lineTotal * discountFactor * 100) / 100;
        const lineVat = Math.round(lineBase * taxPct) / 100;
        const lineGrand = Math.round((lineBase + lineVat) * 100) / 100;
        return `<tr><td class="sn bd">${i + 1}</td><td class="l bd desc">${esc(cleanIt(l.name))}${l.nameAr && cleanIt(l.nameAr) !== cleanIt(l.name) ? ` <span dir="rtl">${esc(l.nameAr)}</span>` : ""}</td>` +
          `<td class="c bd">${esc(l.unit ?? "")}</td><td class="c bd">${Number(l.qty || 0)}</td>` +
          `<td class="c bd">${n2(l.price)}</td><td class="c bd">${n2(Number(l.qty || 0) * Number(l.price || 0))}</td>` +
          `<td class="c bd">${n2(lineTotal)}</td><td class="c bd">${n2(lineVat)}</td><td class="c bd bold">${n2(lineGrand)}</td></tr>`;
      }).join("")
    : `<tr><td class="sn bd">1</td><td class="l bd"></td><td class="c bd"></td><td class="c bd"></td><td class="c bd"></td><td class="c bd"></td><td class="c bd"></td><td class="c bd"></td><td class="c bd"></td></tr>`;

  const valRow = (label: string, val: string, bold = false, size = "") =>
    `<tr><td colspan="7"></td><td class="lbl"${size ? ` style="font-size:${size}"` : ""}>${label}</td>` +
    `<td class="c bd ${bold ? "bold" : ""}"${size ? ` style="font-size:${size}"` : ""}>${val}</td></tr>`;

  // Time shown like the .xlsx does (h:mm AM/PM instead of 24h "18:09").
  const t12 = (() => {
    const t = String(d.time ?? "").trim();
    const m = t.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return t;
    let h = Number(m[1]);
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${m[2]} ${ap}`;
  })();

  return `<!doctype html><html dir="ltr"><head><meta charset="utf-8"><title>${esc(title)}${d.no ? " — " + esc(d.no) : ""}</title><style>
  @page { size: A4 portrait; margin: 8mm; }
  html,body { margin:0; padding:0; }
  body { font-family: Vazir, Tahoma, "Segoe UI", Arial, sans-serif; font-size:8pt; color:#000;
         -webkit-print-color-adjust: exact; print-color-adjust: exact;
         background:#e9ecef; padding:10mm 0; }
  /* On screen: white A4 paper on a gray desk (looks exactly like the printed PDF).
     In print: the page itself is the paper — backdrop & shadow are dropped. */
  .sheet { width:210mm; min-height:297mm; margin:0 auto; padding:8mm; background:#fff;
           box-shadow:0 2px 14px rgba(0,0,0,.28); box-sizing:border-box; }
  @media print {
    body { background:#fff; padding:0; }
    .sheet { width:auto; min-height:0; margin:0; padding:0; box-shadow:none; }
  }
  table { width:100%; border-collapse:collapse; table-layout:fixed; }
  td { vertical-align:middle; padding:1pt 2pt; overflow:hidden; }
  .lh { display:flex; align-items:center; margin-bottom:4pt; }
  .lh-l { width:38%; text-align:center; font-family:Calibri,Arial,sans-serif; font-size:10.5pt; line-height:1.35; }
  .lh-l .t1 { font-size:12pt; font-weight:700; }
  .lh-l .red, .lh-r .red { color:#FF0000; font-weight:700; font-size:11pt; }
  .lh-c { width:24%; text-align:center; }
  /* Same picture box the 0060 template uses for the logo image
     (a:ext 1201615x816532 EMU) so print/PDF matches the .xlsx letterhead. */
  .lh-c img { width:33.4mm; height:22.7mm; object-fit:fill; }
  .lh-r { width:38%; text-align:center; font-family:Arial,Tahoma,sans-serif; direction:rtl; font-size:10.5pt; line-height:1.35; }
  .lh-r .t1 { font-weight:700; font-size:11pt; }
  .gray { background:#D9D9D9; }
  .bd { border:1px solid #808080; }
  .c { text-align:center; } .l { text-align:left; }
  .sn { text-align:center; }
  .lbl { font-weight:700; text-align:left; white-space:nowrap; }
  .desc { white-space:normal; word-break:break-word; }
  .wrap { white-space:normal; word-break:break-word; }
  .bold { font-weight:700; }
  </style></head><body><div class="sheet">
  <div class="lh">
    <div class="lh-l">
      <div class="t1">Kingdom Saudi Arabia</div>
      <div class="red">${esc(company.name ?? "Yousef Jameel Al-Juhani")}</div>
      <div class="red">${esc(company.nameAr ?? "Contracting Est.")}</div>
      <div>C . R . No: ${esc(company.crNumber ?? "4700012896")}</div>
      <div>Tax No: ${esc(company.taxNumber ?? company.tax ?? "300995897900003")}</div>
    </div>
    <div class="lh-c">${logoUrl ? `<img src="${logoUrl}" alt="">` : ""}</div>
    <div class="lh-r">
      <div class="t1">المملكة العربية السعودية</div>
      <div class="red">${esc(company.nameAr)}</div>
      <div class="red">${esc(company.name)}</div>
      <div>س . ت : ${esc(company.crNumber ?? "4700012896")}</div>
      <div>الرقم الضريبي : ${esc(company.taxNumber ?? company.tax ?? "300995897900003")}</div>
    </div>
  </div>
  <table><colgroup>
    <col style="width:8%"><col style="width:21%"><col style="width:7%">
    <col style="width:6%"><col style="width:10%"><col style="width:10%">
    <col style="width:10%"><col style="width:10%"><col style="width:18%">
  </colgroup><tbody>
    <tr class="gray" style="height:26.25pt">
      <td></td><td></td>
      <td colspan="7" class="c" style="font-size:16pt">${esc(d.labels?.banner ?? (d.docType === "sale" ? (d.invoiceType === "simple" ? "Invoice" : "Tax Invoice") : co))}</td>
    </tr>
    <tr><td></td><td class="lbl">${esc(d.labels?.docNo ?? "Doc. No.")}</td><td colspan="2">${esc(d.no)}</td><td class="lbl">${esc(d.labels?.party ?? "Client")}</td><td colspan="4" class="l wrap">${twoLine(client.top, client.bottom)}</td></tr>
    <tr><td></td><td class="lbl">${esc(d.labels?.payment ?? "Payment")}</td><td colspan="2">${esc(d.paymentType ?? "")}</td><td colspan="5"></td></tr>
    <tr><td></td><td class="lbl">Date</td><td colspan="2">${esc(d.date)}</td><td class="lbl">Address</td><td colspan="4" class="l wrap">${twoLine(address.top, address.bottom)}</td></tr>
    <tr><td></td><td class="lbl">Time</td><td colspan="2">${esc(t12)}</td><td class="lbl">Tax No.</td><td colspan="4">${esc(d.partyTax ?? "")}</td></tr>
    <tr><td></td><td class="lbl">${esc(d.labels?.dueDate ?? "Due Date")}</td><td colspan="2">${esc(d.dueDate ?? d.date)}</td><td class="lbl">C.R. No.</td><td colspan="4">${esc(d.partyCr ?? "")}</td></tr>
    <tr><td></td><td class="lbl">${esc(d.labels?.cashier ?? "Owner Name")}</td><td colspan="2">${esc(d.cashier ?? "")}</td><td colspan="5"></td></tr>
    ${noteTxt ? `<tr><td></td><td></td><td colspan="2"></td><td class="lbl">Note</td><td colspan="4" class="l wrap" style="font-size:9pt;white-space:pre-wrap">${esc(noteTxt)}</td></tr>` : ""}
    <tr style="height:30pt;font-weight:700" class="c">
      <td class="bd">مسلسل</td><td class="bd">الوصف / الفئة</td><td class="bd">الوحدة</td>
      <td class="bd">الكمية</td><td class="bd">السعر الافرادي</td><td class="bd">السعر</td><td class="bd">الاجمالي</td>
      <td class="bd">ض القيمة المضافة</td><td class="bd">الإجمالي بالضريبة</td>
    </tr>
    <tr style="height:26pt;font-weight:700" class="c">
      <td class="bd">Item No.</td><td class="bd">Job Description</td><td class="bd">Unit</td>
      <td class="bd">Hours</td><td class="bd">Hour Price</td><td class="bd">Price</td><td class="bd">Total</td>
      <td class="bd">VAT</td><td class="bd">Grand Total</td>
    </tr>
    ${itRows}
    <tr><td></td><td></td><td></td><td class="c bd">${qtyTotal}</td><td></td><td></td><td></td><td class="lbl">Total</td><td class="c bd">${n2(subtotal)}</td></tr>
    ${addl ? valRow(esc(d.additionType || "Additions"), n2(addl)) : ""}
    ${disc ? valRow("Discount", n2(disc)) : ""}
    <tr><td colspan="7"></td><td class="lbl">VAT ${taxPct}%</td><td class="c bd">${n2(d.tax)}</td></tr>
    <tr style="height:17.25pt">
      <td></td><td class="lbl">${esc(d.labels?.total ?? "Due")}</td><td colspan="5" class="l wrap" style="font-size:8pt">${esc(words)}</td>
      <td class="lbl" style="font-size:10pt">Due</td><td class="c bd bold" style="font-size:10pt">${n2(net)}</td>
    </tr>
    ${d.hideBalances ? "" : valRow("Paid", n2(paid))}
    ${!d.hideBalances && creditDue ? valRow("Credit", n2(creditDue)) : ""}
    ${!d.hideBalances && d.hasAccount ? valRow("Bal. Prior", n2(d.balBefore)) + valRow("Bal. After", n2(d.balAfter ?? d.balBefore)) : ""}
    <tr style="height:8pt"><td colspan="9"></td></tr>
    <tr class="gray" style="height:26.25pt">
      <td></td><td colspan="8" class="c" style="font-size:12pt;font-weight:700;line-height:1.35">${coAddrEn || coAddrAr ? `${coAddrEn ? `<div dir="auto">${esc(coAddrEn)}</div>` : ""}${coAddrAr ? `<div dir="auto">${esc(coAddrAr)}</div>` : ""}` : "Thank You"}</td>
    </tr>
    <tr>
      <td></td>
      <td colspan="8" style="vertical-align:top;font-size:8pt;line-height:1.4">${contacts.map((c) => `<div>${esc(c)}</div>`).join("")}</td>
    </tr>
    <tr>
      <td colspan="9" class="c" style="padding-top:4pt">${qrUrl ? `<img src="${qrUrl}" style="width:26mm;height:26mm" alt="">` : ""}</td>
    </tr>
  </tbody></table>
  </div></body></html>`;
}

// Opens the invoice as a real A4 print document in a new window/tab.
// Printing (or "Save as PDF") yields the invoice document itself.
// ---------------------------------------------------------------------------
// Tenant's own Excel design (uploaded .xlsx).
// The uploaded file IS the invoice form: every Sahl tag inside it
// (<Data:…>, <Account:…>, <Items:…>, <AmountString>) is replaced with the
// document values and the item row is repeated for every invoice line — so
// the exported workbook looks exactly like the design the tenant uploaded.
// ---------------------------------------------------------------------------
function xmlDecode(s: string) {
  return String(s ?? "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}
function xmlEncode(s: string) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function readSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    out.push(xmlDecode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("")));
  }
  return out;
}
function cellTextOf(cellXml: string, shared: string[]): string {
  const t = (cellXml.match(/\st="([^"]+)"/) || [])[1] || "n";
  if (t === "s") {
    const v = (cellXml.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || "";
    return shared[Number(v)] ?? "";
  }
  if (t === "inlineStr") {
    return xmlDecode([...cellXml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
  }
  return xmlDecode((cellXml.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || "");
}
function periodLabel(dateStr?: string): string {
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const dt = new Date(String(dateStr || "").slice(0, 10) + "T00:00:00");
  if (isNaN(dt.getTime())) return "";
  return `${dt.getFullYear()} -${months[dt.getMonth()]}`;
}
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
function periodLong(dateStr?: string): string {
  const dt = new Date(String(dateStr || "").slice(0, 10) + "T00:00:00");
  if (isNaN(dt.getTime())) return "";
  return `${dt.getFullYear()} ${MONTHS_LONG[dt.getMonth()]}`;
}
// Excel serials so the template's own date/time number formats are used.
function excelSerialDate(value?: string): number | null {
  const m = String(value || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}
function excelSerialTime(value?: string): number | null {
  const m = String(value || "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]), s = Number(m[3] || 0);
  if (h > 23 || mi > 59 || s > 59) return null;
  return (h * 3600 + mi * 60 + s) / 86400;
}
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
function arDigits(value: any): string {
  return String(value ?? "").replace(/[0-9]/g, (c) => AR_DIGITS[Number(c)]);
}

function tagValue(
  tag: string, d: DocData, company: any, line: DocLine | null, lineIndex = 0,
): string | number | null {
  const t = tag.trim();
  const n = (v: any) => Number(v || 0);
  const pct = Number(d.taxPct ?? 15);
  if (/^<Items:/i.test(t)) {
    if (!line) return ""; // stray item tag outside the item row → clear it
    if (/^<Items:no>/i.test(t)) return lineIndex + 1;
    if (/^<Items:title>/i.test(t)) return line.name ?? "";
    if (/^<Items:code>/i.test(t)) return line.code ?? "";
    if (/^<Items:unit>/i.test(t)) return line.unit ?? "";
    if (/^<Items:user_qty>|^<Items:qty>/i.test(t)) return n(line.qty);
    if (/^<Items:price>/i.test(t)) return n(line.price);
    if (/^<Items:total>|^<Items:total_price>|^<Items:net_price>|^<Items:amount>/i.test(t)) return n(line.total);
    if (/^<Items:discount>/i.test(t)) return n(line.disc);
    if (/^<Items:vat>|^<Items:tax_amount>/i.test(t)) return Math.round(n(line.total) * pct) / 100;
    if (/^<Items:grand>|^<Items:grand_total>/i.test(t)) return Math.round(n(line.total) * (100 + pct)) / 100;
    return null;
  }
  if (/^<Data:no>/i.test(t)) return d.no ?? "";
  if (/^<Data:reference>/i.test(t)) return (d as any).reference ?? "";
  if (/^<Data:date>/i.test(t)) { const s = excelSerialDate(d.date); return s ?? (d.date ?? ""); }
  if (/^<Data:time>/i.test(t)) { const s = excelSerialTime(d.time); return s ?? (d.time ?? ""); }
  if (/^<Data:period_long>/i.test(t)) return (d as any).periodLong || periodLong(d.date);
  if (/^<Data:period>/i.test(t)) return d.period || periodLabel(d.date);
  if (/^<Data:payment>/i.test(t)) return d.paymentType ?? "";
  if (/^<Data:cashier>/i.test(t)) return d.cashier ?? "";
  if (/^<Data:due_date>/i.test(t)) {
    const v = d.dueDate || d.dueDateText || "";
    const s = excelSerialDate(v);
    return s ?? v;
  }
  if (/^<Data:po>/i.test(t)) return d.po ?? "";
  if (/^<Data:note>/i.test(t)) return d.notes ?? "";
  if (/^<Data:qty_total>/i.test(t)) return n(d.qtyTotal);
  if (/^<Data:vat_pct>/i.test(t)) return pct;
  if (/^<Data:subtotal>|^<Data:total_price>/i.test(t)) return n(d.subtotal);
  if (/^<Data:discount>/i.test(t)) return n(d.discount);
  if (/^<Data:net_price>|^<Data:grand_total>/i.test(t)) return n(d.net);
  if (/^<Data:tax_amount>/i.test(t)) return n(d.tax);
  if (/^<Data:paid>/i.test(t)) return n(d.paid);
  if (/^<Data:remaining>/i.test(t)) return n(d.net) - n(d.paid);
  // Arabic line only — never fall back to the Latin name, otherwise designs that
  // print name_ar above name show the same client twice.
  if (/^<Account:name_ar>/i.test(t)) return d.partyAr ?? "";
  if (/^<Account:name>/i.test(t)) return d.party ?? "";
  if (/^<Account:title>/i.test(t)) return d.party ?? "";
  if (/^<Account:tax>|^<Account:tax_id>/i.test(t)) return d.partyTax ?? "";
  if (/^<Account:cr>/i.test(t)) return d.partyCr ?? "";
  if (/^<Account:phone>/i.test(t)) return d.partyPhone ?? "";
  if (/^<Account:email>/i.test(t)) return d.partyEmail ?? "";
  if (/^<Account:address_ar>/i.test(t)) return d.accountAddressAr ?? "";
  if (/^<Account:address>|^<Account:address_en>/i.test(t)) return d.accountAddressEn ?? d.accountAddress ?? "";
  if (/^<Branch:name>/i.test(t)) return d.branch ?? "";
  if (/^<Company:name_ar>/i.test(t)) return company?.nameAr ?? "";
  if (/^<Company:name>/i.test(t)) return company?.name ?? "";
  if (/^<Company:tax_ar>/i.test(t)) return arDigits(company?.tax ?? "");
  if (/^<Company:cr_ar>/i.test(t)) return arDigits(company?.cr ?? "");
  if (/^<Company:tax>/i.test(t)) return company?.tax ?? "";
  if (/^<Company:cr>/i.test(t)) return company?.cr ?? "";
  if (/^<Company:phone>/i.test(t)) return company?.phone ?? "";
  if (/^<Company:email>/i.test(t)) return company?.email ?? "";
  if (/^<Company:website>/i.test(t)) return company?.website ?? "";
  if (/^<Company:address_ar>/i.test(t)) return company?.addressAr ?? "";
  if (/^<Company:address>/i.test(t)) return company?.address ?? "";
  if (/^<Company:unn>|^<Company:unified>/i.test(t)) return company?.unn ?? "";
  if (/^<Company:city>/i.test(t)) return company?.city ?? "";
  if (/^<Company:country>/i.test(t)) return company?.country ?? "";
  if (/^<Company:zip>|^<Company:postal>/i.test(t)) return company?.zip ?? "";
  if (/^<AmountWords>/i.test(t)) return amountWordsSr(n(d.net));
  if (/^<AmountString>/i.test(t)) return amountWords(d.net);
  if (/^<ZATCA:QR_TLV>/i.test(t)) return d.qrText ?? "";
  return null;
}

function patchTemplateSheet(
  sheet: string, d: DocData, company: any, shared: string[],
): { xml: string; itemRow: number; delta: number } {
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  const rows: { num: number; attrs: string; inner: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(sheet))) {
    const attrs = m[1] || "";
    rows.push({
      num: Number((attrs.match(/r="(\d+)"/) || [])[1] || 0),
      attrs,
      inner: m[2] ?? "",
    });
  }
  if (!rows.length) return { xml: sheet, itemRow: 0, delta: 0 };

  const lines = d.lines ?? [];
  // The tag text inside the XML is escaped (&lt;Items:title&gt;) — the row is
  // detected through the DECODED cell text, otherwise the item row is missed.
  const rowHasItems = (inner: string) => {
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(inner))) {
      if (/<Items:/i.test(cellTextOf(cm[0], shared))) return true;
    }
    return false;
  };
  const itemIdx = rows.findIndex((r) => rowHasItems(r.inner));

  const patchInner = (inner: string, rowNum: number, line: DocLine | null, li: number): string => {
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    return inner.replace(cellRe, (full, attrs: string) => {
      const ref = (attrs.match(/r="([A-Z]+)\d+"/) || [])[1];
      if (!ref) return full;
      const text = cellTextOf(full, shared);
      const tags = text.match(/<[^<>]+>/g) || [];
      let newText = text;
      let numeric = false;
      for (const tg of tags) {
        const v = tagValue(tg, d, company, line, li);
        if (v === null) continue;
        newText = newText.replace(tg, typeof v === "number" ? String(v) : String(v));
        if (typeof v === "number" && text.trim() === tg) numeric = true;
      }
      const newRef = `${ref}${rowNum}`;
      const oldRef = (attrs.match(/r="([^"]+)"/) || [])[1] || "";
      if (newText === text && newRef === oldRef) return full;
      const style = (attrs.match(/s="(\d+)"/) || [])[1];
      const keep = style ? ` s="${style}"` : "";
      if (newText === text) {
        // no tag to replace, only the row number moved
        return full.replace(/r="[^"]*"/, `r="${newRef}"`);
      }
      const innerXml = numeric
        ? `<v>${newText}</v>`
        : `<is><t xml:space="preserve">${xmlEncode(newText)}</t></is>`;
      const tAttr = numeric ? "" : ' t="inlineStr"';
      return `<c r="${newRef}"${keep}${tAttr}>${innerXml}</c>`;
    });
  };

  const out: { num: number; attrs: string; inner: string }[] = [];
  const delta = itemIdx >= 0 ? Math.max(0, lines.length - 1) : 0;
  const itemRow = itemIdx >= 0 ? rows[itemIdx].num : 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (i === itemIdx) {
      const list = lines.length ? lines : [null as any];
      list.forEach((ln, li) => {
        const newNum = r.num + li;
        out.push({
          num: newNum,
          attrs: r.attrs.replace(/r="\d+"/, `r="${newNum}"`),
          inner: patchInner(r.inner, newNum, ln, li),
        });
      });
      continue;
    }
    const newNum = r.num + (itemIdx >= 0 && i > itemIdx ? delta : 0);
    out.push({
      num: newNum,
      attrs: newNum !== r.num ? r.attrs.replace(/r="\d+"/, `r="${newNum}"`) : r.attrs,
      inner: patchInner(r.inner, newNum, null, 0),
    });
  }

  const body = out.map((r) => {
    const attrs = r.attrs.replace(/\s*spans="[^"]*"/, "");
    return r.inner ? `<row${attrs}>${r.inner}</row>` : `<row${attrs}/>`;
  }).join("");
  let outXml = sheet.replace(/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/, `<sheetData>${body}</sheetData>`);
  const maxRow = out.length ? Math.max(...out.map((r) => r.num)) : 1;
  outXml = outXml.replace(/<dimension ref="([^"]+)"/, (_m, ref) =>
    `<dimension ref="${ref.replace(/(\d+)$/, String(maxRow))}"`);
  outXml = shiftMerges(outXml, itemRow, delta);
  return { xml: outXml, itemRow, delta };
}

// Rows below the item row move down by `delta` — merged ranges must follow.
function shiftMerges(xml: string, itemRow: number, delta: number): string {
  if (!itemRow || delta <= 0) return xml;
  return xml.replace(/<mergeCell ref="([^"]+)"\/>/g, (_full, ref: string) => {
    const moved = ref.replace(/([A-Z]+)(\d+)/g, (mm, col: string, row: string) =>
      Number(row) > itemRow ? `${col}${Number(row) + delta}` : mm);
    return `<mergeCell ref="${moved}"/>`;
  });
}

// Drawing anchors (QR, stamp, footer art) sit below the item row: move them.
function shiftDrawingAnchors(drawing: string, itemRow: number, delta: number): string {
  if (!itemRow || delta <= 0) return drawing;
  return drawing.replace(/<xdr:twoCellAnchor\b[\s\S]*?<\/xdr:twoCellAnchor>/g, (anchor) => {
    const fromRow = Number((anchor.match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/) || [])[1] || 0);
    if (fromRow < itemRow) return anchor;
    return anchor.replace(/(<xdr:(?:from|to)>[\s\S]*?<xdr:row>)(\d+)(<\/xdr:row>)/g,
      (_m, a: string, row: string, b: string) => `${a}${Number(row) + delta}${b}`);
  });
}

// Print area of the workbook grows with the repeated item rows.
function shiftPrintArea(xml: string, itemRow: number, delta: number): string {
  if (!itemRow || delta <= 0) return xml;
  return xml.replace(/(<definedName name="_xlnm\.Print_Area"[^>]*>)([^<]*)(<\/definedName>)/,
    (_m, a: string, ref: string, b: string) => {
      const moved = ref.replace(/(\$?[A-Z]+\$?)(\d+)/g, (mm, col: string, row: string) =>
        Number(row) > itemRow ? `${col}${Number(row) + delta}` : mm);
      return a + moved + b;
    });
}

// Tags inside text boxes / drawing runs must be replaced there as well.
function patchDrawingTags(drawing: string, d: DocData, company: any): string {
  return drawing.replace(/<a:t>([\s\S]*?)<\/a:t>/g, (full, raw: string) => {
    const text = xmlDecode(raw);
    const tags = text.match(/<[^<>]+>/g);
    if (!tags) return full;
    let out = text;
    for (const tg of tags) {
      const v = tagValue(tg, d, company, null, 0);
      if (v !== null) out = out.replace(tg, String(v));
    }
    return `<a:t>${xmlEncode(out)}</a:t>`;
  });
}

// Pictures in a design are addressed by name:
//   <#invoice_qrcode> -> ZATCA QR, <#company_logo> -> tenant logo,
//   <#company_stamp> -> tenant stamp.  Legacy designs without a name keep the
//   old behaviour (first non-QR picture = logo).
type ImgSlots = { qr?: string | null; logo?: string | null; stamp?: string | null };

function asDataUrl(src?: string | null): string | null {
  if (!src) return null;
  const s = String(src).trim();
  if (!s) return null;
  return /^data:/i.test(s) ? s : `data:image/png;base64,${s}`;
}

// Logos/stamps straight from company settings are often 1200px+ photos; at
// the ~1.2in they print, 300px is already 240dpi, and shrinking them keeps
// the print workbook small (the PDF upload drops from >1MB to <200KB).
const IMG_MAX_PX = 300;

async function loadImageEl(url: string): Promise<HTMLImageElement | null> {
  return await new Promise<HTMLImageElement | null>((resolve) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => resolve(null);
    el.src = url;
  });
}

async function rasterTo(
  url: string,
  mime: "image/png" | "image/jpeg",
  maxPx = 0,
  preloaded?: HTMLImageElement | null,
): Promise<Uint8Array | null> {
  const img = preloaded || (await loadImageEl(url));
  if (!img) return null;
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  const scale = maxPx > 0 ? Math.min(1, maxPx / Math.max(nw, nh)) : 1;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(nw * scale));
  c.height = Math.max(1, Math.round(nh * scale));
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  if (mime === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return b64ToBytes(c.toDataURL(mime, 0.95).split(",")[1]);
}

async function imageBytes(url: string | null, target: string): Promise<Uint8Array | null> {
  if (!url) return null;
  let src = url.trim();
  // Some company profiles store the payload without the data: prefix.
  if (!/^data:/i.test(src) && /^[A-Za-z0-9+/]+={0,2}$/.test(src) && src.length > 512 && src.length % 4 === 0) {
    src = `data:image/png;base64,${src}`;
  }
  const m = src.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const ext = (target.toLowerCase().split(".").pop() || "png");
  if (ext === "png" || ext === "jpg" || ext === "jpeg") {
    const out = ext === "png" ? "image/png" : "image/jpeg";
    const same = out === mime;
    const el = await loadImageEl(url);
    const dim = el ? Math.max(el.naturalWidth || el.width, el.naturalHeight || el.height) : 0;
    if (!dim) return b64ToBytes(m[2]);
    if (dim <= IMG_MAX_PX && same) return b64ToBytes(m[2]);
    return rasterTo(url, out, IMG_MAX_PX, el);
  }
  return b64ToBytes(m[2]);
}

async function applyTemplateImages(zip: any, slots: ImgSlots): Promise<void> {
  try {
    const rels = zip.file("xl/drawings/_rels/drawing1.xml.rels");
    const drw = zip.file("xl/drawings/drawing1.xml");
    if (!rels || !drw) return;
    const relXml = await rels.async("string");
    const drwXml = await drw.async("string");
    const relMap: Record<string, string> = {};
    for (const m of relXml.matchAll(/Id="([^"]+)"[^>]*Target="\.\.\/media\/([^"]+)"/g)) relMap[m[1]] = m[2];
    let logoDone = false;
    for (const pic of drwXml.match(/<xdr:pic>[\s\S]*?<\/xdr:pic>/g) || []) {
      const name = xmlDecode((pic.match(/name="([^"]*)"/) || [])[1] || "");
      const rid = (pic.match(/r:embed="([^"]+)"/) || [])[1] || "";
      const target = relMap[rid];
      if (!target) continue;
      let url: string | null | undefined;
      if (/qrcode/i.test(name)) url = slots.qr;
      else if (/stamp/i.test(name)) url = slots.stamp;
      else if (/logo/i.test(name)) { url = slots.logo; logoDone = true; }
      else if (!logoDone) { url = slots.logo; logoDone = true; }
      if (!url) continue;
      const bytes = await imageBytes(url, target);
      if (bytes) zip.file(`xl/media/${target}`, bytes);
    }
  } catch { /* images optional */ }
}

// Is this uploaded file the 0060 tax-invoice form? Then the proven 0060
// patcher is used instead of the tag based one (the 0060 form carries no
// Sahl tags — its cells are at fixed positions).
function looksLike0060(sheetXml: string, shared: string[], drawingXml: string): boolean {
  const texts: string[] = [];
  for (const m of sheetXml.matchAll(/<c\b[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const t = cellTextOf(m[0], shared);
    if (t) texts.push(t);
  }
  const all = texts.join(" | ");
  // A tagged reference-workbook design is never the 0060 form.
  if (/<Company:|<Account:|<Items:|<AmountWords>/i.test(all + " " + xmlDecode(drawingXml))) return false;
  const hasQrSlot = /invoice_qrcode/i.test(drawingXml);
  const docNo = /Doc\.?\s*No|Doc\.?\s*Number|رقم\s*المستند/i.test(all);
  const client = /Client|العميل/i.test(all);
  return hasQrSlot && docNo && client;
}

// The company row straight from settings.companySettingsGet, in the shape the
// invoice designs ask for. Logo/stamp can be saved under either column name by
// the different company-profile screens, so both are accepted.
export function printCompany(comp: any) {
  const c = comp ?? {};
  return {
    name: c.companyName ?? "", nameAr: c.companyNameAr ?? "",
    tax: c.taxNumber ?? "", cr: c.crNumber ?? c.commercialRegistration ?? "",
    phone: c.phone ?? c.mobile ?? "", email: c.email ?? "",
    website: c.website ?? "", address: c.address ?? "", addressAr: c.addressAr ?? "",
    // ZATCA seller identity: unified national number plus the address parts
    // the e-invoice rules ask for on a tax invoice.
    unn: c.unifiedNationalNo ?? "", city: c.city ?? "",
    country: c.country ?? "", zip: c.zipCode ?? "",
    logoBase64: c.logo || c.logoUrl || undefined,
    stampBase64: c.stamp || c.stampUrl || undefined,
  };
}

// Render an invoice from the tenant's uploaded Excel design (or one of the
// three built-in reference designs).
/**
 * Force a worksheet onto a single printed page.
 *
 * Excel/LibreOffice honour `fitToPage` together with fitToWidth/fitToHeight=1 by
 * scaling the sheet down until it fits one page — which is what the invoice
 * designs need (an invoice must never spill onto a second sheet). A fixed
 * `scale` is removed because OOXML forbids combining it with fitToPage.
 */
function forceSinglePage(xml: string): string {
  // 1) <sheetPr> (first child of <worksheet>) must carry <pageSetUpPr fitToPage="1"/>.
  if (/<pageSetUpPr\b[^>]*\/>/.test(xml)) {
    xml = xml.replace(/<pageSetUpPr\b[^>]*\/>/, `<pageSetUpPr fitToPage="1"/>`);
  } else if (/<sheetPr\b[^>]*\/>/.test(xml)) {
    xml = xml.replace(/<sheetPr\b[^>]*\/>/, `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`);
  } else if (/<sheetPr\b[^>]*>/.test(xml)) {
    xml = xml.replace(/(<sheetPr\b[^>]*>)/, `$1<pageSetUpPr fitToPage="1"/>`);
  } else {
    xml = xml.replace(/(<worksheet\b[^>]*>)/, `$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`);
  }

  // 2) Fit to exactly one page wide AND one page tall.
  const fitOne = ` fitToWidth="1" fitToHeight="1"`;
  if (/<pageSetup\b[^>]*\/>/.test(xml)) {
    xml = xml.replace(/<pageSetup\b[^>]*\/>/, (m) =>
      m.replace(/\s+(?:fitToWidth|fitToHeight|scale)="[^"]*"/g, "").replace(/\s*\/>$/, `${fitOne}/>`));
  } else if (/<pageSetup\b[^>]*>[\s\S]*?<\/pageSetup>/.test(xml)) {
    xml = xml.replace(/<pageSetup\b[^>]*>[\s\S]*?<\/pageSetup>/, `<pageSetup${fitOne}/>`);
  } else if (/<pageMargins\b[^>]*\/>/.test(xml)) {
    xml = xml.replace(/(<pageMargins\b[^>]*\/>)/, `$1<pageSetup${fitOne}/>`);
  }
  return xml;
}

export async function renderTemplateXlsx(
  templateB64: string, cfg: PrintConfig, d: DocData,
  company: {
    nameAr?: string; name?: string; tax?: string; cr?: string; phone?: string;
    email?: string; website?: string; address?: string; addressAr?: string;
    unn?: string; city?: string; country?: string; zip?: string;
    logoBase64?: string; stampBase64?: string;
  },
): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(templateB64, { base64: true });
  const sheetFile = zip.file("xl/worksheets/sheet1.xml");
  if (!sheetFile) throw new Error("Template: sheet1 missing");
  const sharedFile = zip.file("xl/sharedStrings.xml");
  const shared = sharedFile ? readSharedStrings(await sharedFile.async("string")) : [];
  const sheet = await sheetFile.async("string");
  const drawFile = zip.file("xl/drawings/drawing1.xml");
  const drawing = drawFile ? await drawFile.async("string") : "";

  // real ZATCA QR (png) for the QR slot
  let qrUrl: string | null = null;
  if (d.qrText) {
    try {
      const QRCode = (await import("qrcode")).default;
      qrUrl = await QRCode.toDataURL(d.qrText, { width: 320, margin: 0, errorCorrectionLevel: "M" });
    } catch { /* qr optional */ }
  }
  const slots: ImgSlots = {
    qr: qrUrl,
    logo: asDataUrl(company.logoBase64),
    stamp: asDataUrl(company.stampBase64),
  };

  if (looksLike0060(sheet, shared, drawing)) {
    // ---- the uploaded file IS the 0060 tax form: patch it the proven way ----
    let wrapStyle = 0;
    const stylesFile = zip.file("xl/styles.xml");
    if (stylesFile) {
      const w = ensureWrapStyle(await stylesFile.async("string"));
      zip.file("xl/styles.xml", w.xml);
      wrapStyle = w.index;
    }
    const { xml: patchedSheet, thankRow } = patchSheet060(sheet, cfg, d, company as any, wrapStyle);
    zip.file("xl/worksheets/sheet1.xml", patchedSheet);
    await applyTemplateImages(zip, slots);
    // keep the QR anchor beside the Thank-You row
    try {
      const drwFile = zip.file("xl/drawings/drawing1.xml");
      if (drwFile) {
        const drw = await drwFile.async("string");
        const m = drw.match(/<xdr:twoCellAnchor[^>]*>[\s\S]*?<\/xdr:twoCellAnchor>/);
        if (m) {
          let a = m[0];
          a = a.replace(/(<xdr:from>[\s\S]*?<xdr:row>)\d+(<\/xdr:row>)/, `$1${thankRow}$2`);
          a = a.replace(/(<xdr:to>[\s\S]*?<xdr:row>)\d+(<\/xdr:row>)/, `$1${thankRow + 5}$2`);
          zip.file("xl/drawings/drawing1.xml", drw.replace(m[0], a));
        }
      }
    } catch { /* keep original anchors */ }
  } else {
    // ---- any other design: replace the Sahl tags inside it ----
    const patched = patchTemplateSheet(sheet, d, company, shared);
    zip.file("xl/worksheets/sheet1.xml", patched.xml);

    if (drawing) {
      let drw = patchDrawingTags(drawing, d, company);
      drw = shiftDrawingAnchors(drw, patched.itemRow, patched.delta);
      zip.file("xl/drawings/drawing1.xml", drw);
    }
    if (patched.delta > 0) {
      const wbFile = zip.file("xl/workbook.xml");
      if (wbFile) {
        const wb = await wbFile.async("string");
        zip.file("xl/workbook.xml", shiftPrintArea(wb, patched.itemRow, patched.delta));
      }
    }
    await applyTemplateImages(zip, slots);
  }

  // One-page print: force every design (and the 0060 form) to scale down to a
  // single sheet, so neither the PDF nor the Excel export ever spills onto a
  // second page.
  {
    const sheetFile2 = zip.file("xl/worksheets/sheet1.xml");
    if (sheetFile2) zip.file("xl/worksheets/sheet1.xml", forceSinglePage(await sheetFile2.async("string")));
  }

  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return new Blob([out as any], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export async function printInvoice060(
  d: DocData,
  company: { nameAr?: string; name?: string; tax?: string; taxNumber?: string; crNumber?: string; logoBase64?: string; address?: string; addressAr?: string },
  title?: string,
): Promise<void> {
  const w = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
  let logoUrl = "";
  try {
    // company logo first, template letterhead logo as fallback
    const jpg = await logoToJpegBytes(company.logoBase64);
    if (jpg) logoUrl = "data:image/jpeg;base64," + bytesToB64(jpg);
    else {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(FORM0060_B64, { base64: true });
      const img = zip.file("xl/media/image2.jpeg");
      if (img) logoUrl = "data:image/jpeg;base64," + bytesToB64(await img.async("uint8array"));
    }
  } catch { /* logo optional */ }
  let qrUrl = "";
  if (d.qrText) {
    try {
      const QRCode = (await import("qrcode")).default;
      qrUrl = await QRCode.toDataURL(d.qrText, { width: 240, margin: 0 });
    } catch { /* qr optional */ }
  }
  const html = invoice060Html(d, company, title ?? "invoice", logoUrl, qrUrl);
  if (w) {
    try {
      w.document.open();
      w.document.write(html);
      w.document.close();
      if (!(window as any).__NO_AUTOPRINT)
        setTimeout(() => { try { w.focus(); w.print(); } catch { /* ignore */ } }, 700);
      return;
    } catch { /* fall through to iframe */ }
  }
  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(f);
  f.contentDocument!.open();
  f.contentDocument!.write(html);
  f.contentDocument!.close();
  setTimeout(() => { try { f.contentWindow!.print(); } catch { /* ignore */ } setTimeout(() => f.remove(), 1500); }, 700);
}

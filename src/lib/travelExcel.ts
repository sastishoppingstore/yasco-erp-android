// Travel & Tours — Excel (.xlsx) exports.
//
// Reuses `exceljs`, the exact same library the other ERP modules (Sahl print
// engine / report builder) use for styled, print-ready workbooks, so the files
// open reliably on web and on the Windows desktop bundle.
//
// Four customer-safe outputs are produced here:
//   • Excel A4 invoice   (exportTravelExcel(detail, "a4"))
//   • Excel thermal 80mm (exportTravelExcel(detail, "thermal"))
//   • History ledger     (exportTravelHistoryExcel(rows))
//
// PRIVACY: the customer-facing invoices never contain the internal base cost or
// the agency profit. Only the history ledger (internal agency accounting) shows
// Base Cost / Sale Price / Profit.
import { buildTravelDocModel, docMoney, type TravelDocModel } from "./travelDocModel";
import type { TravelTicketDetail } from "./travelPrint";

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Convert an image URL / data URL to an exceljs image descriptor (or null). */
async function toImage(url?: string): Promise<{ base64: string; extension: "png" | "jpeg" } | null> {
  if (!url) return null;
  try {
    if (url.startsWith("data:")) {
      const m = /^data:(image\/[a-z+.-]+);base64,(.*)$/i.exec(url);
      if (!m) return null;
      const extension = m[1].includes("jpeg") || m[1].includes("jpg") ? "jpeg" : "png";
      return { base64: m[2], extension };
    }
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const buf = await blob.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const extension = blob.type.includes("jpeg") || blob.type.includes("jpg") ? "jpeg" : "png";
    return { base64: btoa(binary), extension };
  } catch {
    return null;
  }
}

const THIN = { style: "thin" as const, color: { argb: "FF9CA3AF" } };
const BORDER_ALL = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const HEAD_FILL = "FF1D7A37";
const ZEBRA = "FFF1F8E9";

function safeName(s: string) {
  return String(s || "ticket").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
}

/* ───────────────────────── Airline-brand header ───────────────────────── */

function writeBrandHeader(ws: any, m: TravelDocModel, lastCol: number) {
  const right = (row: number, value: string, opts: { bold?: boolean; size?: number } = {}) => {
    if (!value) return;
    const cell = ws.getCell(row, lastCol);
    cell.value = value;
    cell.font = { bold: opts.bold, size: opts.size };
    cell.alignment = { horizontal: "right", vertical: "top" };
  };

  ws.mergeCells(1, 1, 1, lastCol);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = m.brand.name || "Travel Invoice";
  titleCell.font = { bold: true, size: 16 };
  titleCell.alignment = { horizontal: "left" };

  ws.mergeCells(2, 1, 2, lastCol);
  const ar = ws.getCell(2, 1);
  ar.value = m.brand.nameAr || "";
  ar.font = { bold: true, size: 13 };
  ar.alignment = { horizontal: "right" };

  let r = 3;
  const info: Array<[string, string]> = [
    [m.brand.tagline || m.brand.taglineAr || "", ""],
    [m.brand.vat ? `VAT No.: ${m.brand.vat}` : "", ""],
    [m.brand.licenseNo ? `Tourism Licence: ${m.brand.licenseNo} ${m.brand.licenseTypeAr || ""}` : "", ""],
    [m.brand.phone ? `Tel: ${m.brand.phone}` : "", ""],
  ];
  for (const [text] of info) right(r++, text, { size: 10 });
}

/* ─────────────────────────────── A4 invoice ─────────────────────────────── */

async function buildA4Workbook(m: TravelDocModel) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = m.brand.name || "YASCO Travel";
  const ws = wb.addWorksheet("A4 Invoice", {
    pageSetup: {
      paperSize: 9, // A4
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });

  const COLS = [40, 9, 15, 17, 10, 14];
  ws.columns = COLS.map((width) => ({ width }));
  const LAST = COLS.length;

  writeBrandHeader(ws, m, LAST);

  // Left meta block (customer + invoice details), right-aligned branding above.
  let r = 7;
  const meta: Array<[string, string]> = [
    ["Invoice type", `${m.title} / ${m.titleAr}`],
    ["Invoice number", m.invoiceNumber],
    ["Date", m.date || ""],
    ["Due date", m.dueDate || ""],
    ["Bill to", m.customerName],
  ];
  if (m.customerNameAr) meta.push(["", m.customerNameAr]);
  if (m.passengerName) meta.push(["Passenger", m.passengerName]);
  if (m.pnr) meta.push(["PNR", m.pnr]);
  if (m.route) meta.push(["Route", m.route]);
  for (const [k, v] of meta) {
    ws.getCell(r, 1).value = k;
    ws.getCell(r, 1).font = { bold: true, size: 10 };
    ws.mergeCells(r, 2, r, 4);
    ws.getCell(r, 2).value = v || "";
    ws.getCell(r, 2).font = { size: 10 };
    r++;
  }

  r += 1;
  const headRow = r;
  const headers = ["Item / Description", "Quantity", "Price", "Taxable amount", "VAT", "Amount"];
  headers.forEach((h, i) => {
    const c = ws.getCell(headRow, i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_FILL } };
    c.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle", wrapText: true };
    c.border = BORDER_ALL;
  });
  r++;

  m.items.forEach((it, idx) => {
    const desc = [it.description, it.descriptionAr, [it.route, it.ticketRef].filter(Boolean).join(" · ")]
      .filter(Boolean).join("\n");
    const values = [desc, it.quantity, it.unitPrice, it.taxableAmount, it.taxAmount, it.totalAmount];
    values.forEach((v, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = v as any;
      c.border = BORDER_ALL;
      c.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "top", wrapText: i === 0 };
      if (typeof v === "number") c.numFmt = "#,##0.00";
      if (idx % 2 === 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
    });
    r++;
  });

  r++;
  const summary: Array<[string, number, boolean]> = [
    ["SubTotal / المجموع الفرعي", m.subTotal, false],
    ["Total VAT / إجمالي القيمة المضافة", m.taxAmount, false],
    ["Total / الاجمالي", m.totalAmount, true],
  ];
  for (const [label, value, big] of summary) {
    ws.mergeCells(r, 1, r, 4);
    const lc = ws.getCell(r, 1);
    lc.value = label;
    lc.alignment = { horizontal: "right" };
    lc.font = { bold: big, size: big ? 12 : 10 };
    const vc = ws.getCell(r, LAST);
    vc.value = value;
    vc.numFmt = "#,##0.00";
    vc.font = { bold: big, size: big ? 12 : 10 };
    vc.alignment = { horizontal: "right" };
    if (big) { ws.getCell(r, 1).border = { top: { style: "medium", color: { argb: "FF111827" } } }; }
    r++;
  }
  if (m.paidAmount) {
    ws.mergeCells(r, 1, r, 4);
    ws.getCell(r, 1).value = "Paid / المدفوع";
    ws.getCell(r, 1).alignment = { horizontal: "right" };
    ws.getCell(r, LAST).value = m.paidAmount;
    ws.getCell(r, LAST).numFmt = "#,##0.00";
    r++;
  }

  // ZATCA QR image, bottom-left.
  if (m.isZatca && m.qrDataUrl) {
    const img = await toImage(m.qrDataUrl);
    if (img) {
      const id = wb.addImage(img);
      ws.addImage(id, { tl: { col: 0, row: r + 0.3 }, ext: { width: 110, height: 110 } });
    }
  }

  return wb;
}

/* ─────────────────────────── Thermal 80mm sheet ─────────────────────────── */

async function buildThermalWorkbook(m: TravelDocModel) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = m.brand.name || "YASCO Travel";
  const ws = wb.addWorksheet("Thermal 80mm", {
    pageSetup: {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.2, right: 0.2, top: 0.2, bottom: 0.2, header: 0, footer: 0 },
    },
  });
  ws.columns = [{ width: 22 }, { width: 16 }];

  const center = (row: number, text: string, opts: { bold?: boolean; size?: number; merge?: boolean } = {}) => {
    if (opts.merge !== false) ws.mergeCells(row, 1, row, 2);
    const c = ws.getCell(row, 1);
    c.value = text;
    c.font = { bold: opts.bold, size: opts.size };
    c.alignment = { horizontal: "center", wrapText: true };
  };

  let r = 1;
  center(r++, m.brand.name, { bold: true, size: 13 });
  if (m.brand.nameAr) center(r++, m.brand.nameAr, { bold: true, size: 11 });
  if (m.brand.tagline || m.brand.taglineAr) center(r++, m.brand.tagline || m.brand.taglineAr, { size: 9 });
  if (m.brand.vat) center(r++, `VAT: ${m.brand.vat}`, { size: 9 });
  if (m.brand.licenseNo) center(r++, `Tourism Licence: ${m.brand.licenseNo} ${m.brand.licenseTypeAr || ""}`, { size: 9 });
  if (m.brand.phone) center(r++, `Tel: ${m.brand.phone}`, { size: 9 });

  center(r++, `${m.title} / ${m.titleAr}`, { bold: true, size: 11 });

  const kv = (label: string, value: string, bold = false) => {
    const lc = ws.getCell(r, 1);
    lc.value = label;
    lc.font = { size: 10, bold };
    const vc = ws.getCell(r, 2);
    vc.value = value;
    vc.font = { size: 10, bold };
    vc.alignment = { horizontal: "right", wrapText: true };
    r++;
  };
  kv("Invoice #", m.invoiceNumber);
  kv("Date", m.date || "");
  kv("Customer", m.customerName);
  if (m.passengerName && m.passengerName !== m.customerName) kv("Passenger", m.passengerName);
  if (m.route) kv("Route", m.route);
  if (m.pnr) kv("PNR", m.pnr);
  if (m.ticketNumber) kv("Ticket #", m.ticketNumber);

  r++;
  for (const it of m.items) {
    const desc = [it.description, [it.route, it.ticketRef].filter(Boolean).join(" · ")].filter(Boolean).join(" — ");
    const dc = ws.getCell(r, 1);
    dc.value = desc;
    dc.font = { bold: true, size: 10 };
    dc.alignment = { wrapText: true };
    ws.mergeCells(r, 1, r, 2);
    r++;
    kv(`${it.quantity} × ${docMoney(it.unitPrice)}`, docMoney(it.totalAmount));
  }

  r++;
  kv("Sale Price", `${docMoney(m.subTotal)} ${m.symbol}`);
  kv(`VAT (${m.vatPercent}%)`, `${docMoney(m.taxAmount)} ${m.symbol}`);
  kv("Grand Total", `${docMoney(m.totalAmount)} ${m.symbol}`, true);

  if (m.isZatca && m.qrDataUrl) {
    const img = await toImage(m.qrDataUrl);
    if (img) {
      const id = wb.addImage(img);
      ws.addImage(id, { tl: { col: 0.3, row: r + 0.2 }, ext: { width: 120, height: 120 } });
    }
  }

  return wb;
}

/* ─────────────────────────────── Public API ─────────────────────────────── */

export async function exportTravelExcel(
  detail: TravelTicketDetail,
  format: "a4" | "thermal" = "a4",
): Promise<void> {
  const m = await buildTravelDocModel(detail);
  const wb = format === "thermal" ? await buildThermalWorkbook(m) : await buildA4Workbook(m);
  const buffer = await wb.xlsx.writeBuffer();
  const suffix = format === "thermal" ? "thermal-80mm" : "A4";
  downloadBlob(new Blob([buffer], { type: MIME_XLSX }), `${safeName(m.invoiceNumber)}-${suffix}.xlsx`);
}

/**
 * Internal agency accounting ledger — the ONLY export that may show the base
 * cost, sale price and profit.
 */
export async function exportTravelHistoryExcel(rows: any[]): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "YASCO Travel";
  const ws = wb.addWorksheet("Travel History", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const headers = [
    "Invoice #", "Date", "Mode", "Customer", "Passenger", "Route / PNR",
    "Base Cost", "Sale Price", "Profit", "VAT", "Total", "Status",
  ];
  ws.addRow(headers);
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.alignment = { horizontal: "center", vertical: "middle" };
  head.height = 20;
  head.eachCell((c: any) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_FILL } };
    c.border = BORDER_ALL;
  });

  const n = (v: unknown) => Number(v) || 0;
  for (const t of rows) {
    const row = ws.addRow([
      t.invoiceNumber,
      t.date,
      t.mode === "zatca" ? "ZATCA" : `NON-TAX ${n(t.vatPercent)}%`,
      t.customerName || t.passengerName || "—",
      t.passengerName || "",
      [t.serviceRef, t.origin, t.destination, t.pnr].filter(Boolean).join(" · "),
      n(t.nonTaxableAmount),
      n(t.subTotal),
      n(t.taxableAmount),
      n(t.taxAmount),
      n(t.totalAmount),
      t.status,
    ]);
    row.eachCell((c: any, col: number) => {
      c.border = BORDER_ALL;
      if (col >= 7 && col <= 11) { c.numFmt = "#,##0.00"; c.alignment = { horizontal: "right" }; }
    });
  }

  ws.columns.forEach((c) => { c.width = 16; });
  ws.getColumn(1).width = 16;
  ws.getColumn(4).width = 26;
  ws.getColumn(6).width = 26;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: MIME_XLSX }), `travel-history-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

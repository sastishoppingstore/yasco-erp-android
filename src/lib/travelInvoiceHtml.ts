// Travel & Tours — printable ticket / tax-invoice HTML (A4 + 80mm thermal).
//
// Reproduces the bilingual (EN/AR) "Dazzling Travel & Tours" layout for A4 and
// a compact 80mm POS thermal slip. Two modes:
//   • mode "zatca"   → "Simplified Tax Invoice", ZATCA TLV QR shown.
//   • mode "non_tax" → "Invoice" / "فاتورة"; QR hidden at 0% VAT.
//
// PRIVACY: the customer-facing HTML never renders the internal base cost
// (supplier/airline fare) or the agency profit as separate figures. Only the
// customer price, the taxable amount, VAT and the total are shown. Branding is
// always the logged-in travel agency.
import { docMoney as money } from "./travelDocModel";
import type { TravelDocModel, TravelDocLine } from "./travelDocModel";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

function subline(it: TravelDocLine): string {
  const sub = [it.route, it.ticketRef].filter(Boolean).join(" · ");
  return sub ? `<div class="desc-sub">${esc(sub)}</div>` : "";
}

/* ─────────────────────────────── A4 ─────────────────────────────── */

export function buildTravelA4Html(p: TravelDocModel): string {
  const isZatca = p.isZatca;
  const sym = p.symbol;

  const rows = p.items.map((it) => `<tr>
      <td class="c-item">
        <div class="desc-en">${esc(it.description)}</div>
        ${it.descriptionAr ? `<div class="desc-ar" dir="rtl">${esc(it.descriptionAr)}</div>` : ""}
        ${subline(it)}
      </td>
      <td class="c-num">${esc(it.quantity)}</td>
      <td class="c-num">${money(it.unitPrice)}</td>
      <td class="c-num">${money(it.taxableAmount)}</td>
      <td class="c-num">${money(it.taxAmount)}</td>
      <td class="c-num b">${money(it.totalAmount)}</td>
    </tr>`).join("");

  const qrBlock = isZatca
    ? `<div class="qr-wrap">
         ${p.qrDataUrl ? `<img class="qr" src="${p.qrDataUrl}" alt="ZATCA QR" />` : `<div class="qr qr-empty">QR</div>`}
         <div class="qr-note">
           <div>This QR code is encoded as per ZATCA e-invoicing requirements</div>
           <div class="ar" dir="rtl">رمز الاستجابة السريعة مشفر بحسب متطلبات هيئة الزكاة والضريبة والجمارك للفوترة الإلكترونية</div>
         </div>
       </div>`
    : `<div class="nontax-box">
         <div class="nontax-title">Non-Tax Invoice / فاتورة غير ضريبية</div>
         <div class="nontax-remarks">${esc(p.notes || "This invoice is issued without VAT.")}</div>
         <div class="sign-row">
           <div class="sign-line"><span>Authorized Signature / التوقيع المعتمد</span></div>
           <div class="stamp">${p.stampUrl ? `<img src="${p.stampUrl}" alt="stamp" />` : `<span>Stamp / الختم</span>`}</div>
         </div>
       </div>`;

  const vatLine = isZatca
    ? `<div class="kv"><span>VAT No. / رقم التسجيل الضريبي</span><b>${esc(p.brand.vat || "")}</b></div>`
    : "";
  const licenseLine = p.brand.licenseNo
    ? `<div class="kv"><span>رقم ترخيص وزارة السياحة</span><b>${esc(p.brand.licenseNo)} ${esc(p.brand.licenseTypeAr || "")}</b></div>`
    : "";
  const phoneLine = p.brand.phone
    ? `<div class="kv"><span>هاتف :</span><b dir="ltr">${esc(p.brand.phone)}</b></div>`
    : "";

  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8" />
<title>${esc(p.invoiceNumber || p.brand.name)}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { font-family: 'Cairo','Segoe UI',Tahoma,Arial,sans-serif; color: #1f2937; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { width: 190mm; margin: 0 auto; padding: 2mm; background: #fff; }
  .ar { font-family: 'Cairo',Tahoma,Arial,sans-serif; }

  /* header — a 3-column table keeps the agency block pinned to the top-right */
  table.head { width: 100%; border-collapse: collapse; border-bottom: 2px solid #111827; }
  table.head > tbody > tr > td { vertical-align: top; padding: 0 4px 8px; }
  .col-left { width: 32%; text-align: left; }
  .col-mid  { width: 30%; }
  .col-right{ width: 38%; text-align: right; }
  .doc-title { font-size: 17px; font-weight: 800; color: #0f172a; }
  .doc-title-ar { font-size: 15px; font-weight: 700; color: #334155; margin-bottom: 14px; }
  .bill-label { font-size: 12px; color: #64748b; }
  .bill-label .ar { display:block; }
  .bill-name { font-size: 15px; font-weight: 800; text-transform: uppercase; }
  .meta-row { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; margin-bottom: 6px; }
  .meta-row .k { color: #475569; text-align: left; }
  .meta-row .k .ar { display:block; color:#94a3b8; }
  .meta-row b { color: #0f172a; }
  .brand-logo { max-height: 62px; max-width: 165px; object-fit: contain; }
  .brand-name { font-size: 15px; font-weight: 800; margin-top: 2px; }
  .brand-name-ar { font-size: 14px; font-weight: 700; color:#334155; }
  .kv { font-size: 11.5px; color: #334155; display: flex; gap: 6px; justify-content: flex-end; }
  .kv b { color: #0f172a; font-weight: 700; }
  .due { margin-top: 10px; border: 1.5px solid #111827; border-radius: 6px; padding: 6px 8px; display: inline-block; text-align: right; }
  .due .lbl { font-size: 11px; color: #475569; }
  .due .amt { font-size: 20px; font-weight: 800; color: #0f172a; }
  .due .amt span { font-size: 12px; font-weight: 600; }

  /* table */
  table.items { width: 100%; border-collapse: collapse; margin-top: 14px; }
  table.items thead th { background: #f1f5f9; border-top: 1.5px solid #111827; border-bottom: 1px solid #cbd5e1; padding: 6px 6px; font-size: 11px; color: #0f172a; text-align: center; }
  table.items thead th .ar { display:block; font-size: 10.5px; color:#64748b; }
  table.items td { border-bottom: 1px solid #e2e8f0; padding: 7px 6px; font-size: 12px; vertical-align: top; }
  .c-item { text-align: left; }
  .c-num { text-align: center; white-space: nowrap; }
  .c-num.b { font-weight: 700; }
  .desc-en { font-weight: 700; }
  .desc-ar { font-size: 11.5px; color:#334155; }
  .desc-sub { font-size: 11px; color: #2563eb; }

  /* bottom */
  .bottom { display: flex; gap: 14px; margin-top: 16px; align-items: flex-start; }
  .bottom-left { flex: 0 0 150px; }
  .bottom-right { flex: 1; }
  .qr { width: 128px; height: 128px; border: 1px solid #cbd5e1; }
  .qr-empty { display:flex; align-items:center; justify-content:center; color:#94a3b8; font-size: 12px; }
  .qr-note { font-size: 9px; color: #475569; margin-top: 4px; line-height: 1.35; }
  .qr-note .ar { direction: rtl; text-align: right; }
  .totals { width: 100%; }
  .totals .row { display: flex; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding: 7px 4px; font-size: 13px; }
  .totals .row .lbl .ar { display:block; font-size: 10.5px; color:#64748b; }
  .totals .row.total { border-bottom: none; border-top: 2px solid #111827; font-size: 16px; font-weight: 800; }
  .totals .cur { color: #64748b; font-size: 11px; margin-inline-end: 6px; }
  .nontax-box { border: 1.5px solid #cbd5e1; border-radius: 6px; padding: 10px; }
  .nontax-title { font-weight: 800; color: #0f172a; margin-bottom: 6px; }
  .nontax-remarks { font-size: 11.5px; color: #475569; min-height: 40px; }
  .sign-row { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 26px; }
  .sign-line { border-top: 1px solid #94a3b8; padding-top: 4px; font-size: 10.5px; color: #64748b; width: 45%; }
  .stamp { font-size: 10.5px; color: #94a3b8; }
  .stamp img { max-height: 60px; }
  .notes { margin-top: 14px; font-size: 11px; color: #475569; }
  .notes .ar { direction: rtl; }
</style>
</head>
<body>
  <div class="sheet">
    <table class="head"><tbody><tr>
      <td class="col-left">
        <div class="doc-title">${esc(p.title)}</div>
        <div class="doc-title-ar ar" dir="rtl">${esc(p.titleAr)}</div>
        <div class="bill-label">Bill to <span class="ar" dir="rtl">العميل</span></div>
        <div class="bill-name">${esc(p.customerName)}</div>
        ${p.customerNameAr ? `<div class="desc-ar ar" dir="rtl">${esc(p.customerNameAr)}</div>` : ""}
      </td>
      <td class="col-mid">
        <div class="meta-row"><span class="k">Invoice number <span class="ar">رقم الفاتورة</span></span><b>${esc(p.invoiceNumber)}</b></div>
        <div class="meta-row"><span class="k">Date <span class="ar">التاريخ</span></span><b>${esc(p.date || "")}</b></div>
        <div class="meta-row"><span class="k">Due date <span class="ar">تاريخ الإستحقاق</span></span><b>${esc(p.dueDate || "")}</b></div>
        ${p.pnr ? `<div class="meta-row"><span class="k">PNR <span class="ar">رقم الحجز</span></span><b>${esc(p.pnr)}</b></div>` : ""}
        ${p.passengerName ? `<div class="meta-row"><span class="k">Passenger <span class="ar">المسافر</span></span><b>${esc(p.passengerName)}</b></div>` : ""}
      </td>
      <td class="col-right">
        ${p.brand.logo ? `<img class="brand-logo" src="${p.brand.logo}" alt="logo" />` : ""}
        <div class="brand-name">${esc(p.brand.name)}</div>
        ${p.brand.nameAr ? `<div class="brand-name-ar ar" dir="rtl">${esc(p.brand.nameAr)}</div>` : ""}
        ${p.brand.tagline ? `<div class="kv"><span>${esc(p.brand.tagline)}</span></div>` : ""}
        ${phoneLine}
        ${vatLine}
        ${licenseLine}
        <div class="due">
          <div class="lbl">Total due <span class="ar" dir="rtl">الرصيد المستحق</span></div>
          <div class="amt"><span>${esc(sym)}</span> ${money(p.balanceDue ?? p.totalAmount)}</div>
        </div>
      </td>
    </tr></tbody></table>

    <table class="items">
      <thead>
        <tr>
          <th style="width:38%">Item / Description<span class="ar" dir="rtl">الوصف / المنتج</span></th>
          <th style="width:8%">Quantity<span class="ar" dir="rtl">الكمية</span></th>
          <th style="width:15%">Price<span class="ar" dir="rtl">السعر</span></th>
          <th style="width:16%">Taxable amount<span class="ar" dir="rtl">المبلغ الخاضع للضريبة</span></th>
          <th style="width:10%">VAT<span class="ar" dir="rtl">القيمة المضافة</span></th>
          <th style="width:13%">Amount<span class="ar" dir="rtl">المجموع</span></th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="6" style="text-align:center;color:#94a3b8">—</td></tr>`}</tbody>
    </table>

    <div class="bottom">
      <div class="bottom-left">${qrBlock}</div>
      <div class="bottom-right">
        <div class="totals">
          <div class="row"><span class="lbl">SubTotal <span class="ar" dir="rtl">المجموع الفرعي</span></span><span><span class="cur">${esc(sym)}</span><b>${money(p.subTotal)}</b></span></div>
          <div class="row"><span class="lbl">Total VAT <span class="ar" dir="rtl">إجمالي ضريبة القيمة المضافة</span></span><span><span class="cur">${esc(sym)}</span><b>${money(p.taxAmount)}</b></span></div>
          <div class="row total"><span class="lbl">Total <span class="ar" dir="rtl">الاجمالي</span></span><span><span class="cur">${esc(sym)}</span><b>${money(p.totalAmount)}</b></span></div>
        </div>
        ${p.notes || p.notesAr ? `<div class="notes">${p.notes ? esc(p.notes) : ""}${p.notesAr ? `<div class="ar" dir="rtl">${esc(p.notesAr)}</div>` : ""}</div>` : ""}
      </div>
    </div>
  </div>
</body>
</html>`;
}

/* ─────────────────────────── Thermal 80mm ─────────────────────────── */

export function buildTravelThermalHtml(p: TravelDocModel): string {
  const sym = p.symbol;
  const lineRows = p.items.map((it) => `
    <div class="li">
      <div class="li-desc">${esc(it.description)}${it.descriptionAr ? `<div class="li-ar" dir="rtl">${esc(it.descriptionAr)}</div>` : ""}</div>
      <div class="li-calc">
        <span>${esc(it.quantity)} × ${money(it.unitPrice)}</span>
        <span>${money(it.totalAmount)}</span>
      </div>
      ${[it.route, it.ticketRef].filter(Boolean).length ? `<div class="li-sub">${esc([it.route, it.ticketRef].filter(Boolean).join(" · "))}</div>` : ""}
    </div>`).join("");

  const qr = p.isZatca
    ? `<div class="qr">
         ${p.qrDataUrl ? `<img src="${p.qrDataUrl}" alt="ZATCA QR" />` : ""}
         <div class="qr-cap">ZATCA e-invoicing QR</div>
       </div>`
    : `<div class="nontax">${esc(p.notes || "Non-tax invoice / فاتورة غير ضريبية")}</div>`;

  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8" />
<title>${esc(p.invoiceNumber || p.brand.name)}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>
  @page { size: 80mm auto; margin: 2mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { font-family: 'Cairo','Segoe UI',Tahoma,Arial,sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .slip { width: 76mm; margin: 0 auto; padding: 0; font-size: 11px; line-height: 1.35; }
  .center { text-align: center; }
  .ar { font-family: 'Cairo',Tahoma,Arial,sans-serif; }
  .biz-name { font-size: 15px; font-weight: 800; }
  .biz-name-ar { font-size: 13px; font-weight: 700; }
  .muted { font-size: 10px; color: #333; }
  .hr { border-top: 1px dashed #000; margin: 6px 0; }
  .hr2 { border-top: 2px solid #000; margin: 6px 0; }
  .kv { display: flex; justify-content: space-between; gap: 6px; }
  .kv .l { color: #333; }
  .kv .v { font-weight: 700; text-align: right; }
  .li { margin-bottom: 4px; }
  .li-desc { font-weight: 700; }
  .li-ar { font-size: 10.5px; }
  .li-sub { font-size: 10px; color: #333; }
  .li-calc { display: flex; justify-content: space-between; }
  .tot { font-size: 14px; font-weight: 800; }
  .qr { text-align: center; margin-top: 6px; }
  .qr img { width: 42mm; height: 42mm; }
  .qr-cap { font-size: 9px; color: #333; }
  .nontax { border: 1px dashed #000; padding: 4px; font-size: 10px; margin-top: 6px; text-align: center; }
  .foot { text-align: center; font-size: 9px; color: #333; margin-top: 6px; }
</style>
</head>
<body>
  <div class="slip">
    <div class="center">
      <div class="biz-name">${esc(p.brand.name)}</div>
      ${p.brand.nameAr ? `<div class="biz-name-ar ar" dir="rtl">${esc(p.brand.nameAr)}</div>` : ""}
      ${p.brand.tagline || p.brand.taglineAr ? `<div class="muted">${esc(p.brand.tagline || p.brand.taglineAr)}</div>` : ""}
      ${p.brand.vat ? `<div class="muted">VAT / الرقم الضريبي: ${esc(p.brand.vat)}</div>` : ""}
      ${p.brand.licenseNo ? `<div class="muted">رقم ترخيص وزارة السياحة: ${esc(p.brand.licenseNo)} ${esc(p.brand.licenseTypeAr || "")}</div>` : ""}
      ${p.brand.phone ? `<div class="muted">Tel: ${esc(p.brand.phone)}</div>` : ""}
    </div>
    <div class="hr2"></div>
    <div class="center">
      <div class="b"><b>${esc(p.title)}</b> / <span class="ar" dir="rtl">${esc(p.titleAr)}</span></div>
    </div>
    <div class="hr"></div>
    <div class="kv"><span class="l">Invoice #</span><span class="v">${esc(p.invoiceNumber)}</span></div>
    <div class="kv"><span class="l">Date</span><span class="v">${esc(p.date || "")}</span></div>
    <div class="kv"><span class="l">Customer</span><span class="v">${esc(p.customerName)}</span></div>
    ${p.passengerName && p.passengerName !== p.customerName ? `<div class="kv"><span class="l">Passenger</span><span class="v">${esc(p.passengerName)}</span></div>` : ""}
    ${p.route ? `<div class="kv"><span class="l">Route</span><span class="v">${esc(p.route)}</span></div>` : ""}
    ${p.pnr ? `<div class="kv"><span class="l">PNR</span><span class="v">${esc(p.pnr)}</span></div>` : ""}
    ${p.ticketNumber ? `<div class="kv"><span class="l">Ticket #</span><span class="v">${esc(p.ticketNumber)}</span></div>` : ""}
    <div class="hr"></div>
    ${lineRows || `<div class="center muted">—</div>`}
    <div class="hr"></div>
    <div class="kv"><span class="l">Sale Price / سعر البيع</span><span class="v">${money(p.subTotal)} ${esc(sym)}</span></div>
    <div class="kv"><span class="l">VAT / القيمة المضافة (${esc(p.vatPercent)}%)</span><span class="v">${money(p.taxAmount)} ${esc(sym)}</span></div>
    <div class="kv tot"><span class="l">Grand Total / الإجمالي</span><span class="v">${money(p.totalAmount)} ${esc(sym)}</span></div>
    ${qr}
    <div class="foot">${esc(p.brand.name)} · ${esc(p.invoiceNumber)}</div>
  </div>
</body>
</html>`;
}

/* ─────────────────────────────── Print ─────────────────────────────── */

export interface PrintHtmlOptions {
  /** iframe width in mm (paper width + margins). */
  widthMm?: number;
  /** iframe height in mm. */
  heightMm?: number;
}

/**
 * Print HTML through a hidden iframe (pattern used across the ERP). The paper
 * size itself comes from the document's own `@page` rule.
 */
export function printTravelHtml(html: string, opts: PrintHtmlOptions = {}) {
  const widthMm = opts.widthMm ?? 210;
  const heightMm = opts.heightMm ?? 297;
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.width = `${widthMm}mm`;
  iframe.style.height = `${heightMm}mm`;
  iframe.style.border = "0";
  iframe.setAttribute("aria-hidden", "true");
  const cleanup = () => { try { iframe.remove(); } catch { /* gone */ } };
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  // Open the browser print dialog once the logo / ZATCA QR images are decoded
  // (fall back to a short timer so it can never hang).
  let printed = false;
  const doPrint = () => {
    if (printed) return;
    printed = true;
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch { /* print may be blocked by the browser */ }
    window.addEventListener("focus", cleanup, { once: true });
    setTimeout(cleanup, 60000);
  };

  const pending = Array.from(doc.images || []).filter((img) => !img.complete);
  if (pending.length) {
    let remaining = pending.length;
    const done = () => { if (--remaining <= 0) setTimeout(doPrint, 60); };
    pending.forEach((img) => {
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
    });
    setTimeout(doPrint, 1500);
  } else {
    setTimeout(doPrint, 120);
  }
}

/** Print the A4 sheet (210×297mm). */
export function printTravelInvoiceHtml(html: string) {
  printTravelHtml(html, { widthMm: 210, heightMm: 297 });
}

/** Print the 80mm thermal slip. */
export function printTravelThermalHtml(html: string) {
  printTravelHtml(html, { widthMm: 80, heightMm: 200 });
}

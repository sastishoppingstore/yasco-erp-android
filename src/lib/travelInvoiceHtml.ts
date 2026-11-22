// Travel & Tours — printable ticket / tax-invoice HTML (A4 + 80mm thermal).
//
// A4 layout reproduces the client-approved "Dazzling Travel & Tours" reference:
// a strict 3-column header table (so the agency block can never drop below the
// title), the bilingual item table, the ZATCA QR / Non-Tax remarks block and
// the right-aligned totals table.
//
// Two modes:
//   • mode "zatca"   → "Simplified Tax Invoice", ZATCA TLV QR shown, VAT block shown.
//   • mode "non_tax" → "Invoice" / "فاتورة"; the whole `.zatca-only` block
//     (VAT number, QR, e-invoicing note) is hidden and a Non-Tax remarks +
//     signature block is shown instead.
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
  const bodyClass = isZatca ? "zatca" : "non-tax";
  const titleEn = isZatca ? "Simplified Tax Invoice" : "Invoice";
  const titleAr = isZatca ? "فاتورة ضريبية مبسطة" : "فاتورة";

  const rows = p.items.map((it) => `<tr>
        <td>${esc(it.description)}${it.descriptionAr ? `<span class="ar" dir="rtl">${esc(it.descriptionAr)}</span>` : ""}${subline(it)}</td>
        <td>${esc(it.quantity)}</td>
        <td>${money(it.unitPrice)}</td>
        <td>${money(it.taxableAmount)}</td>
        <td>${money(it.taxAmount)}</td>
        <td>${money(it.totalAmount)}</td>
      </tr>`).join("\n");

  const nonTaxBlock = `<div class="non-tax-only">
          <div class="nontax-title">Non-Tax Invoice / <span class="ar">فاتورة غير ضريبية</span></div>
          <div class="nontax-remark">${esc(p.notes || "This invoice is issued without VAT.")}</div>
          <div class="sign-row">
            <div class="sign-line">Authorized Signature / <span class="ar">التوقيع المعتمد</span></div>
            <div class="stamp">${p.stampUrl ? `<img src="${p.stampUrl}" alt="stamp" />` : "Stamp / <span class=\"ar\">الختم</span>"}</div>
          </div>
        </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${esc(titleEn)} - A4</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@600;700;800&family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', 'Cairo', sans-serif; color: #0f172a; background: #fff; font-size: 13px; }
    .ar { font-family: 'Cairo', sans-serif; display: block; line-height: 1.35; }
    .desc-sub { font-family: 'Inter', sans-serif; font-size: 11px; color: #2563eb; display: block; }

    /* Mode toggles */
    .non-tax .zatca-only { display: none !important; }
    .zatca .non-tax-only { display: none !important; }

    /* Strict 3-Column Header Table so right block NEVER drops down */
    .header-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    .header-table td { vertical-align: top; }
    .col-left { width: 34%; text-align: left; }
    .col-mid { width: 26%; text-align: left; padding-top: 26px; }
    .col-right { width: 40%; text-align: right; }

    .doc-title { font-size: 20px; font-weight: 800; margin-bottom: 22px; }
    .doc-title .ar { font-size: 18px; font-weight: 700; }
    .bill-lbl { font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 6px; }
    .customer-val { font-size: 15px; font-weight: 800; text-transform: uppercase; }

    .meta-block { margin-bottom: 14px; }
    .meta-lbl { font-size: 12.5px; font-weight: 700; color: #334155; }
    .meta-val { font-size: 14px; font-weight: 700; margin-top: 2px; }

    .agency-en { font-size: 17px; font-weight: 800; }
    .agency-ar { font-family: 'Cairo', sans-serif; font-size: 16px; font-weight: 700; margin-bottom: 6px; }
    .agency-meta { font-size: 12px; font-weight: 600; line-height: 1.65; color: #1e293b; }

    .total-due-box { margin-top: 14px; display: inline-block; text-align: right; }
    .total-due-lbl { font-size: 12px; font-weight: 700; color: #334155; }
    .total-due-val { font-size: 24px; font-weight: 800; margin-top: 2px; }
    .total-due-val small { font-size: 13px; font-weight: 600; color: #64748b; margin-right: 8px; }

    /* Line Items Table */
    .items-table { width: 100%; border-collapse: collapse; margin-bottom: 22px; }
    .items-table th {
      border-top: 1.5px solid #cbd5e1;
      border-bottom: 1.5px solid #cbd5e1;
      padding: 9px 6px;
      font-size: 12px;
      font-weight: 700;
      text-align: center;
    }
    .items-table th:first-child { text-align: left; }
    .items-table th:last-child { text-align: right; }
    .items-table td {
      padding: 12px 6px;
      font-size: 13.5px;
      font-weight: 600;
      text-align: center;
      border-bottom: 1.5px solid #cbd5e1;
    }
    .items-table td:first-child { text-align: left; font-weight: 700; }
    .items-table td:last-child { text-align: right; font-weight: 700; }

    /* Bottom QR & Totals Table */
    .bottom-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    .bottom-table td { vertical-align: top; }
    .qr-box img { width: 130px; height: 130px; display: block; }
    .zatca-note { margin-top: 14px; font-size: 12px; font-weight: 600; line-height: 1.55; }

    .totals-table { width: 320px; margin-left: auto; border-collapse: collapse; }
    .totals-table td { padding: 8px 4px; font-weight: 700; border-bottom: 1px solid #e2e8f0; }
    .totals-table tr:last-child td { border-bottom: none; font-size: 16px; font-weight: 800; padding-top: 10px; }
    .t-lbl { text-align: left; }
    .t-curr { text-align: right; color: #64748b; font-size: 12px; width: 65px; }
    .t-num { text-align: right; width: 95px; }

    /* Non-tax block */
    .nontax-title { font-size: 14px; font-weight: 800; margin-bottom: 8px; }
    .nontax-remark { font-size: 12px; font-weight: 600; line-height: 1.5; color: #334155; min-height: 48px; }
    .sign-row { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 34px; }
    .sign-line { border-top: 1px solid #94a3b8; padding-top: 4px; font-size: 11px; color: #64748b; width: 55%; }
    .stamp { font-size: 11px; color: #94a3b8; }
    .stamp img { max-height: 60px; }
  </style>
</head>
<body class="${bodyClass}">
  <table class="header-table">
    <tr>
      <td class="col-left">
        <div class="doc-title">${esc(titleEn)}<span class="ar">${esc(titleAr)}</span></div>
        <div class="bill-lbl">Bill to<span class="ar">العميل</span></div>
        <div class="customer-val">${esc(p.customerName)}</div>
        ${p.customerNameAr ? `<div class="ar" dir="rtl" style="font-size:13px;font-weight:700;">${esc(p.customerNameAr)}</div>` : ""}
      </td>
      <td class="col-mid">
        <div class="meta-block">
          <div class="meta-lbl">Invoice number<span class="ar">رقم الفاتورة</span></div>
          <div class="meta-val">${esc(p.invoiceNumber)}</div>
        </div>
        <div class="meta-block">
          <div class="meta-lbl">Date<span class="ar">التاريخ</span></div>
          <div class="meta-val">${esc(p.date || "")}</div>
        </div>
        <div class="meta-block">
          <div class="meta-lbl">Due date<span class="ar">تاريخ الإستحقاق</span></div>
          <div class="meta-val">${esc(p.dueDate || "")}</div>
        </div>
        ${p.pnr ? `<div class="meta-block"><div class="meta-lbl">PNR<span class="ar">رقم الحجز</span></div><div class="meta-val">${esc(p.pnr)}</div></div>` : ""}
        ${p.passengerName ? `<div class="meta-block"><div class="meta-lbl">Passenger<span class="ar">المسافر</span></div><div class="meta-val">${esc(p.passengerName)}</div></div>` : ""}
      </td>
      <td class="col-right">
        <div class="agency-en">${esc(p.brand.name || "Dazzling Travel & Tours")}</div>
        <div class="agency-ar">${esc(p.brand.nameAr || "مبهر للسفر والسياحة")}</div>
        <div class="agency-meta">
          <div>رقم الهاتف : ${esc(p.brand.phone || "+966 14 321 2300")}</div>
          <div class="zatca-only">Vat number | رقم التسجيل الضريبي</div>
          <div class="zatca-only"><strong>${esc(p.brand.vat || "")}</strong></div>
          <div>${esc(p.brand.licenseNo || "")} : رقم ترخيص وزارة السياحة (${esc(p.brand.licenseTypeAr || "وكيل سفر وسياحه")})</div>
        </div>
        <div class="total-due-box">
          <div class="total-due-lbl">Total due<span class="ar">الرصيد المستحق</span></div>
          <div class="total-due-val"><small>${esc(sym)}</small>${money(p.balanceDue ?? p.totalAmount)}</div>
        </div>
      </td>
    </tr>
  </table>

  <table class="items-table">
    <thead>
      <tr>
        <th>Item / Description<span class="ar">الوصف / المنتج</span></th>
        <th>Quantity<span class="ar">الكمية</span></th>
        <th>Price<span class="ar">السعر</span></th>
        <th>Taxable amount<span class="ar">المبلغ الخاضع للضريبة</span></th>
        <th>VAT<span class="ar">القيمة المضافة</span></th>
        <th>Amount<span class="ar">المجموع</span></th>
      </tr>
    </thead>
    <tbody>
${rows || `<tr><td colspan="6" style="text-align:center;color:#94a3b8">—</td></tr>`}
    </tbody>
  </table>

  <table class="bottom-table">
    <tr>
      <td style="width: 52%;">
        <div class="qr-box zatca-only">
          ${p.qrDataUrl ? `<img src="${p.qrDataUrl}" alt="ZATCA QR" />` : ""}
        </div>
        <div class="zatca-note zatca-only">
          <div>This Qr code encoded as per ZATCA e-invoicing requirements</div>
          <div class="ar">رمز الاستجابة السريعة مشفر بحسب متطلبات هيئة الزكاة والضريبة والجمارك للفوترة الإلكترونية</div>
        </div>
        ${nonTaxBlock}
      </td>
      <td style="width: 48%;">
        <table class="totals-table">
          <tr>
            <td class="t-lbl">SubTotal<span class="ar">المجموع الفرعي</span></td>
            <td class="t-curr">${esc(sym)}</td>
            <td class="t-num">${money(p.subTotal)}</td>
          </tr>
          <tr>
            <td class="t-lbl">Total vat<span class="ar">إجمالي ضريبة القيمة المضافة</span></td>
            <td class="t-curr">${esc(sym)}</td>
            <td class="t-num">${money(p.taxAmount)}</td>
          </tr>
          <tr>
            <td class="t-lbl">Total<span class="ar">الاجمالي</span></td>
            <td class="t-curr">${esc(sym)}</td>
            <td class="t-num">${money(p.totalAmount)}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
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

// Travel & Tours — printable A4 ticket / tax-invoice HTML.
//
// Reproduces the bilingual (EN/AR) "Dazzling Travel & Tours" layout:
//   3-column header (title+bill-to · meta · branding+total-due),
//   6-column items table, bottom split (ZATCA QR + totals), compliance footer.
//
// Two modes:
//   • mode="zatca"   → title "Simplified Tax Invoice", QR shown, VAT number
//                      shown, ZATCA compliance footer.
//   • mode="non_tax" → title "Invoice" / "فاتورة", QR hidden, a non-tax
//                      remarks + signature/stamp box replaces the QR block.

export interface TravelInvoiceHtmlItem {
  description: string;
  descriptionAr?: string | null;
  ticketRef?: string | null;
  route?: string | null;
  quantity: number;
  unitPrice: string | number;
  /** non-taxable base fare total for the line */
  baseFare?: string | number | null;
  /** taxable service fee total for the line */
  serviceFee?: string | number | null;
  taxableAmount?: string | number | null;
  taxAmount?: string | number | null;
  totalAmount: string | number;
}

export interface TravelInvoiceHtmlParams {
  mode: "zatca" | "non_tax";
  title: string;
  titleAr: string;
  companyName: string;
  companyNameAr?: string;
  companyLogo?: string;
  companyPhone?: string;
  companyVat?: string;
  tourismLicenseNo?: string;
  tourismLicenseTypeAr?: string;
  tagline?: string;
  taglineAr?: string;
  customerName: string;
  customerNameAr?: string;
  invoiceNumber: string;
  date?: string;
  dueDate?: string;
  currency?: string;
  subTotal: string | number;
  nonTaxableAmount?: string | number;
  taxableAmount?: string | number;
  taxAmount: string | number;
  totalAmount: string | number;
  paidAmount?: string | number;
  balanceDue?: string | number;
  vatPercent: number | string;
  qrDataUrl?: string;
  items: TravelInvoiceHtmlItem[];
  notes?: string;
  notesAr?: string;
  /** stamp image data URL for the non-tax signature box */
  stampUrl?: string;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

const money = (v: unknown) =>
  (Number(v) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function buildTravelInvoiceHtml(p: TravelInvoiceHtmlParams): string {
  const isZatca = p.mode === "zatca";
  const currency = p.currency || "SAR";
  const sym = `${currency} ر.س`;

  const rows = p.items.map((it) => {
    const sub = [it.route, it.ticketRef].filter(Boolean).join(" · ");
    const marginNote =
      !isZatca || (Number(it.baseFare) > 0 || Number(it.serviceFee) > 0)
        ? `<div class="subline">${[
            Number(it.baseFare) > 0 ? `Base price: ${money(it.baseFare)} ${currency} (Non-Taxable)` : "",
            Number(it.serviceFee) > 0 ? `Agency profit: ${money(it.serviceFee)} ${currency}` : "",
          ].filter(Boolean).join(" + ")}</div>`
        : "";
    return `<tr>
      <td class="c-item">
        <div class="desc-en">${esc(it.description)}</div>
        ${it.descriptionAr ? `<div class="desc-ar">${esc(it.descriptionAr)}</div>` : ""}
        ${sub ? `<div class="desc-sub">${esc(sub)}</div>` : ""}
        ${marginNote}
      </td>
      <td class="c-num">${esc(it.quantity)}</td>
      <td class="c-num">${money(it.unitPrice)}</td>
      <td class="c-num">${money(it.taxableAmount)}</td>
      <td class="c-num">${money(it.taxAmount)}</td>
      <td class="c-num b">${money(it.totalAmount)}</td>
    </tr>`;
  }).join("");

  const qrBlock = isZatca
    ? `<div class="qr-wrap">
         ${p.qrDataUrl ? `<img class="qr" src="${p.qrDataUrl}" alt="ZATCA QR" />` : `<div class="qr qr-empty">QR</div>`}
         <div class="qr-note">
           <div>This Qr code encoded as per ZATCA e-invoicing requirements</div>
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
    ? `<div class="kv"><span>Vat number / رقم التسجيل الضريبي</span><b>${esc(p.companyVat || "")}</b></div>`
    : "";
  const licenseLine = p.tourismLicenseNo
    ? `<div class="kv"><span>رقم ترخيص وزارة السياحة</span><b>${esc(p.tourismLicenseNo)} ${esc(p.tourismLicenseTypeAr || "")}</b></div>`
    : "";

  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8" />
<title>${esc(p.invoiceNumber)}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Cairo','Segoe UI',Tahoma,Arial,sans-serif; color: #1f2937; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { width: 190mm; min-height: 277mm; margin: 0 auto; padding: 6mm; background: #fff; }
  .ar { font-family: 'Cairo',Tahoma,Arial,sans-serif; }

  /* header */
  .head { display: flex; gap: 8px; border-bottom: 2px solid #111827; padding-bottom: 8px; }
  .col-left { flex: 0 0 30%; }
  .col-mid  { flex: 0 0 34%; }
  .col-right{ flex: 1; text-align: right; }
  .doc-title { font-size: 17px; font-weight: 800; color: #0f172a; }
  .doc-title-ar { font-size: 15px; font-weight: 700; color: #334155; margin-bottom: 14px; }
  .bill-label { font-size: 12px; color: #64748b; }
  .bill-label .ar { display:block; }
  .bill-name { font-size: 15px; font-weight: 800; text-transform: uppercase; }
  .meta-row { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; margin-bottom: 6px; }
  .meta-row .k { color: #475569; }
  .meta-row .k .ar { display:block; color:#94a3b8; }
  .meta-row b { color: #0f172a; }
  .brand-logo { max-height: 64px; max-width: 170px; object-fit: contain; }
  .brand-name { font-size: 15px; font-weight: 800; }
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
  .subline { font-size: 10.5px; color: #64748b; margin-top: 2px; }

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
    <div class="head">
      <div class="col-left">
        <div class="doc-title">${esc(p.title)}</div>
        <div class="doc-title-ar ar" dir="rtl">${esc(p.titleAr)}</div>
        <div class="bill-label">Bill to <span class="ar" dir="rtl">العميل</span></div>
        <div class="bill-name">${esc(p.customerName)}</div>
        ${p.customerNameAr ? `<div class="desc-ar ar" dir="rtl">${esc(p.customerNameAr)}</div>` : ""}
      </div>
      <div class="col-mid">
        <div class="meta-row"><span class="k">Invoice number <span class="ar">رقم الفاتورة</span></span><b>${esc(p.invoiceNumber)}</b></div>
        <div class="meta-row"><span class="k">Date <span class="ar">التاريخ</span></span><b>${esc(p.date || "")}</b></div>
        <div class="meta-row"><span class="k">Due date <span class="ar">تاريخ الإستحقاق</span></span><b>${esc(p.dueDate || "")}</b></div>
      </div>
      <div class="col-right">
        ${p.companyLogo ? `<img class="brand-logo" src="${p.companyLogo}" alt="logo" />` : ""}
        <div class="brand-name">${esc(p.companyName)}</div>
        ${p.companyNameAr ? `<div class="brand-name-ar ar" dir="rtl">${esc(p.companyNameAr)}</div>` : ""}
        ${p.companyPhone ? `<div class="kv"><span>رقم الهاتف :</span><b>${esc(p.companyPhone)}</b></div>` : ""}
        ${vatLine}
        ${licenseLine}
        <div class="due">
          <div class="lbl">Total due <span class="ar" dir="rtl">الرصيد المستحق</span></div>
          <div class="amt"><span>${sym}</span> ${money(p.balanceDue ?? p.totalAmount)}</div>
        </div>
      </div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th style="width:38%">Item / Description<span class="ar" dir="rtl">الوصف / المنتج</span></th>
          <th style="width:9%">Quantity<span class="ar" dir="rtl">الكمية</span></th>
          <th style="width:12%">Base / Price<span class="ar" dir="rtl">السعر / التكلفة</span></th>
          <th style="width:15%">Taxable profit<span class="ar" dir="rtl">الربح الخاضع</span></th>
          <th style="width:11%">VAT<span class="ar" dir="rtl">القيمة المضافة</span></th>
          <th style="width:15%">Amount<span class="ar" dir="rtl">المجموع</span></th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="6" style="text-align:center;color:#94a3b8">—</td></tr>`}</tbody>
    </table>

    <div class="bottom">
      <div class="bottom-left">${qrBlock}</div>
      <div class="bottom-right">
        <div class="totals">
          <div class="row"><span class="lbl">SubTotal <span class="ar" dir="rtl">المجموع الفرعي</span></span><span><span class="cur">${sym}</span><b>${money(p.subTotal)}</b></span></div>
          <div class="row"><span class="lbl">Total vat <span class="ar" dir="rtl">إجمالي ضريبة القيمة المضافة</span></span><span><span class="cur">${sym}</span><b>${money(p.taxAmount)}</b></span></div>
          <div class="row total"><span class="lbl">Total <span class="ar" dir="rtl">الاجمالي</span></span><span><span class="cur">${sym}</span><b>${money(p.totalAmount)}</b></span></div>
        </div>
        ${p.notes || p.notesAr ? `<div class="notes">${p.notes ? esc(p.notes) : ""}${p.notesAr ? `<div class="ar" dir="rtl">${esc(p.notesAr)}</div>` : ""}</div>` : ""}
      </div>
    </div>
  </div>
</body>
</html>`;
}

/** Print HTML through a hidden A4-width iframe (pattern used across the ERP). */
export function printTravelInvoiceHtml(html: string) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.width = "210mm";
  iframe.style.height = "297mm";
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

  // Open the browser print dialog for the A4 sheet once the logo / ZATCA QR
  // images are decoded (fall back to a short timer so it can never hang).
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

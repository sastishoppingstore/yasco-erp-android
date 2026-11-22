/**
 * Render the travel A4 ticket/invoice HTML for a given ticketGet payload so it
 * can be eyeballed (or screenshotted) without opening the app.
 *
 *   npx tsx scripts/render-travel-sheet.ts /tmp/opencode/ticket3.json /tmp/opencode/ticket-sheet.html
 */
import { readFileSync, writeFileSync } from "node:fs";
import QRCode from "qrcode";
import { buildTravelInvoiceHtml, type TravelInvoiceHtmlItem } from "../src/lib/travelInvoiceHtml";
import { travelZatcaQr } from "../src/lib/travelCalc";

async function main() {
  const inPath = process.argv[2];
  const outPath = process.argv[3] || "/tmp/opencode/ticket-sheet.html";
  const raw = JSON.parse(readFileSync(inPath, "utf8"));
  const payload = Array.isArray(raw) ? raw[0] : raw;
  const detail = payload?.result?.data?.json ?? payload;
  const { doc, items, invoice, company, travelSettings, customer } = detail;
  const isZatca = doc?.mode === "zatca";

  let qrPayload: string = invoice?.zatcaQrCode || invoice?.qrPhase2 || "";
  if (isZatca && !qrPayload) {
    qrPayload = travelZatcaQr({
      seller: company?.companyNameAr || company?.companyName || "",
      vat: company?.taxNumber || "",
      iso: `${doc?.date}T00:00:00Z`,
      total: doc?.totalAmount ?? 0,
      vatAmt: doc?.taxAmount ?? 0,
    });
  }
  const qrDataUrl = isZatca && qrPayload
    ? await QRCode.toDataURL(qrPayload, { margin: 1, width: 256, errorCorrectionLevel: "M" })
    : undefined;

  const lineOf = (it: any): TravelInvoiceHtmlItem => ({
    description: it.description || "—",
    descriptionAr: it.descriptionAr,
    ticketRef: it.ticketRef,
    route: it.route,
    quantity: Number(it.quantity) || 0,
    unitPrice: it.unitPrice,
    baseFare: it.baseFare,
    serviceFee: it.serviceFee,
    taxableAmount: it.taxableAmount,
    taxAmount: it.taxAmount,
    totalAmount: it.totalAmount,
  });

  const html = buildTravelInvoiceHtml({
    mode: doc?.mode || "non_tax",
    title: isZatca ? "Simplified Tax Invoice" : "Invoice",
    titleAr: isZatca ? "فاتورة ضريبية مبسطة" : "فاتورة",
    companyName: company?.companyName || "",
    companyNameAr: company?.companyNameAr || "",
    companyLogo: company?.logo || undefined,
    companyPhone: company?.phone || company?.mobile || "",
    companyVat: company?.taxNumber || "",
    tourismLicenseNo: travelSettings?.tourismLicenseNo || "",
    tourismLicenseTypeAr: travelSettings?.tourismLicenseTypeAr || "",
    tagline: travelSettings?.tagline || "",
    taglineAr: travelSettings?.taglineAr || "",
    customerName: doc?.customerName || customer?.name || doc?.passengerName || "Walk-in Customer",
    customerNameAr: doc?.customerNameAr || customer?.nameAr || "",
    invoiceNumber: doc?.invoiceNumber || "",
    date: doc?.date || "",
    dueDate: doc?.dueDate || "",
    currency: doc?.currency || "SAR",
    subTotal: Number(doc?.subTotal) || 0,
    nonTaxableAmount: doc?.nonTaxableAmount,
    taxableAmount: doc?.taxableAmount,
    taxAmount: Number(doc?.taxAmount) || 0,
    totalAmount: Number(doc?.totalAmount) || 0,
    balanceDue: doc?.balanceDue ?? (Number(doc?.totalAmount) || 0),
    vatPercent: doc?.vatPercent ?? 15,
    qrDataUrl,
    items: (items || []).map(lineOf),
    notes: doc?.notes,
    notesAr: doc?.notesAr,
    stampUrl: company?.stamp || undefined,
  });

  writeFileSync(outPath, html, "utf8");
  console.log(`wrote ${outPath} (${html.length} bytes)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
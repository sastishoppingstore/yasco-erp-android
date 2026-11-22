// Builds + prints a travel ticket from a `travel.ticketGet` payload.
import QRCode from "qrcode";
import { buildTravelInvoiceHtml, printTravelInvoiceHtml, type TravelInvoiceHtmlItem } from "./travelInvoiceHtml";
import { travelZatcaQr, r2 } from "./travelCalc";

export interface TravelTicketDetail {
  doc: any;
  items: any[];
  invoice: any;
  company: any;
  travelSettings: any;
  customer: any;
  zatcaStatus?: any;
}

function lineOf(it: any): TravelInvoiceHtmlItem {
  return {
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
  };
}

export async function printTravelTicket(detail: TravelTicketDetail): Promise<void> {
  const { doc, items, invoice, company, travelSettings, customer } = detail;
  const isZatca = doc?.mode === "zatca";

  // Prefer the signed Phase-2 QR; fall back to a locally built TLV QR so a
  // just-created (not-yet-signed) ticket still prints a scannable code.
  let qrPayload: string = invoice?.zatcaQrCode || "";
  if (isZatca && !qrPayload) {
    const seller = company?.companyName || "";
    const vat = company?.taxNumber || "";
    const iso = `${doc?.date || new Date().toISOString().slice(0, 10)}T${new Date().toTimeString().slice(0, 8)}Z`;
    qrPayload = travelZatcaQr({
      seller,
      vat,
      iso,
      total: doc?.totalAmount ?? 0,
      vatAmt: doc?.taxAmount ?? 0,
    });
  }

  let qrDataUrl: string | undefined;
  if (isZatca && qrPayload) {
    try {
      qrDataUrl = await QRCode.toDataURL(qrPayload, { margin: 1, width: 256, errorCorrectionLevel: "M" });
    } catch {
      qrDataUrl = undefined;
    }
  }

  const subTotal = Number(doc?.subTotal) || 0;
  const taxAmount = Number(doc?.taxAmount) || 0;
  const totalAmount = Number(doc?.totalAmount) || 0;

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
    subTotal,
    nonTaxableAmount: doc?.nonTaxableAmount,
    taxableAmount: doc?.taxableAmount,
    taxAmount,
    totalAmount,
    balanceDue: doc?.balanceDue ?? totalAmount,
    vatPercent: doc?.vatPercent ?? 15,
    qrDataUrl,
    items: (items || []).map(lineOf),
    notes: doc?.notes,
    notesAr: doc?.notesAr,
    stampUrl: company?.stamp || undefined,
  });

  printTravelInvoiceHtml(html);
  void r2;
}

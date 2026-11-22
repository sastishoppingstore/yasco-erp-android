// Travel & Tours — normalized printable document model.
//
// A single mapper turns a `travel.ticketGet` payload into one shape that all
// four outputs consume (A4 HTML/print, thermal HTML/print, A4 Excel, thermal
// Excel). Keeping the mapping in one place guarantees every output shows the
// exact same numbers and, crucially, the same *privacy* rules:
//
//   • The customer NEVER sees the internal base cost (supplier/airline fare) or
//     the agency profit as separate figures — only the customer-facing price,
//     the taxable amount, VAT and the total.
//   • Branding is always the logged-in travel agency (name/logo/VAT/licence),
//     never "YASCO ERP".
//
// This file belongs to the Travel module only and does not touch any other
// module.
import QRCode from "qrcode";
import { travelZatcaQr } from "./travelCalc";

export type TravelDocMode = "zatca" | "non_tax";
export type TravelOutputFormat = "a4" | "thermal";

export interface TravelDocLine {
  description: string;
  descriptionAr?: string | null;
  route?: string | null;
  ticketRef?: string | null;
  quantity: number;
  /** Customer-facing price per unit (never the internal base cost). */
  unitPrice: number;
  /** Pre-VAT line sale amount (base + profit) — the customer's price. */
  saleAmount: number;
  /** VAT base (net of VAT). */
  taxableAmount: number;
  taxAmount: number;
  /** Line total including VAT. */
  totalAmount: number;
}

export interface TravelDocBrand {
  name: string;
  nameAr?: string;
  logo?: string;
  phone?: string;
  vat?: string;
  licenseNo?: string;
  licenseTypeAr?: string;
  tagline?: string;
  taglineAr?: string;
}

export interface TravelDocModel {
  mode: TravelDocMode;
  isZatca: boolean;
  title: string;
  titleAr: string;
  brand: TravelDocBrand;
  invoiceNumber: string;
  date?: string;
  dueDate?: string;
  currency: string;
  /** e.g. "SAR ر.س" */
  symbol: string;
  customerName: string;
  customerNameAr?: string;
  passengerName?: string;
  pnr?: string;
  ticketNumber?: string;
  serviceRef?: string;
  route?: string;
  subTotal: number;
  taxableAmount: number;
  nonTaxableAmount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  balanceDue: number;
  vatPercent: number | string;
  notes?: string;
  notesAr?: string;
  stampUrl?: string;
  qrDataUrl?: string;
  items: TravelDocLine[];
}

const n = (v: unknown) => Number(v) || 0;

/**
 * Build the printable model for a `travel.ticketGet` payload.
 *
 * `buildQr` controls whether a ZATCA QR data URL is generated (needs the async
 * `qrcode` encoder). Callers that already have the QR can pass it in via
 * `qrcode`.
 */
export async function buildTravelDocModel(
  detail: any,
  opts: { qrDataUrl?: string } = {},
): Promise<TravelDocModel> {
  const doc = detail?.doc || {};
  const items = Array.isArray(detail?.items) ? detail.items : [];
  const invoice = detail?.invoice || null;
  const company = detail?.company || null;
  const tset = detail?.travelSettings || null;
  const customer = detail?.customer || null;

  const isZatca = doc?.mode === "zatca";
  const currency = doc?.currency || tset?.defaultCurrency || "SAR";

  // One QR for every output: prefer the signed Phase-2 code, fall back to a
  // locally built TLV payload so a just-created ticket still scans.
  let qrDataUrl = opts.qrDataUrl;
  if (isZatca && !qrDataUrl) {
    let payload: string = invoice?.zatcaQrCode || "";
    if (!payload) {
      const iso = `${doc?.date || new Date().toISOString().slice(0, 10)}T${new Date().toTimeString().slice(0, 8)}Z`;
      payload = travelZatcaQr({
        seller: company?.companyName || "",
        vat: company?.taxNumber || "",
        iso,
        total: doc?.totalAmount ?? 0,
        vatAmt: doc?.taxAmount ?? 0,
      });
    }
    if (payload) {
      try {
        qrDataUrl = await QRCode.toDataURL(payload, { margin: 1, width: 256, errorCorrectionLevel: "M" });
      } catch {
        qrDataUrl = undefined;
      }
    }
  }

  const lines: TravelDocLine[] = items.map((it: any) => {
    const quantity = n(it.quantity) || 1;
    const nonTaxable = n(it.nonTaxableAmount);
    const taxable = n(it.taxableAmount);
    const unitPrice = n(it.unitPrice);
    return {
      description: it.description || "—",
      descriptionAr: it.descriptionAr || null,
      route: it.route || null,
      ticketRef: it.ticketRef || null,
      quantity,
      unitPrice,
      saleAmount: nonTaxable + taxable,
      taxableAmount: taxable,
      taxAmount: n(it.taxAmount),
      totalAmount: n(it.totalAmount),
    };
  });

  const subTotal = n(doc?.subTotal) || lines.reduce((s, l) => s + l.saleAmount, 0);
  const totalAmount = n(doc?.totalAmount);
  const paidAmount = n(doc?.paidAmount);

  return {
    mode: isZatca ? "zatca" : "non_tax",
    isZatca,
    title: isZatca ? "Simplified Tax Invoice" : "Invoice",
    titleAr: isZatca ? "فاتورة ضريبية مبسطة" : "فاتورة",
    brand: {
      name: company?.companyName || "",
      nameAr: company?.companyNameAr || "",
      logo: company?.logo || undefined,
      phone: company?.phone || company?.mobile || "",
      vat: company?.taxNumber || "",
      licenseNo: tset?.tourismLicenseNo || "",
      licenseTypeAr: tset?.tourismLicenseTypeAr || "",
      tagline: tset?.tagline || "",
      taglineAr: tset?.taglineAr || "",
    },
    invoiceNumber: doc?.invoiceNumber || "",
    date: doc?.date || "",
    dueDate: doc?.dueDate || "",
    currency,
    symbol: `${currency} ر.س`,
    customerName: doc?.customerName || customer?.name || doc?.passengerName || "Walk-in Customer",
    customerNameAr: doc?.customerNameAr || customer?.nameAr || "",
    passengerName: doc?.passengerName || "",
    pnr: doc?.pnr || "",
    ticketNumber: doc?.ticketNumber || "",
    serviceRef: doc?.serviceRef || "",
    route: doc?.serviceRef || [doc?.origin, doc?.destination].filter(Boolean).join("-"),
    subTotal,
    taxableAmount: n(doc?.taxableAmount),
    nonTaxableAmount: n(doc?.nonTaxableAmount),
    taxAmount: n(doc?.taxAmount),
    totalAmount,
    paidAmount,
    balanceDue: doc?.balanceDue != null ? n(doc.balanceDue) : totalAmount - paidAmount,
    vatPercent: doc?.vatPercent ?? 15,
    notes: doc?.notes || undefined,
    notesAr: doc?.notesAr || undefined,
    stampUrl: company?.stamp || company?.stampUrl || undefined,
    qrDataUrl,
    items: lines,
  };
}

/** 2-decimals with thousands separators — e.g. 1557.5 → "1,557.50". */
export const docMoney = (v: unknown): string =>
  (Number(v) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

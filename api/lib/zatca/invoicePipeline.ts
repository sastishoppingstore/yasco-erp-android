/**
 * ZATCA Phase 2 — single entry point for every invoice-producing module.
 *
 * `buildAndPersistInvoice()` loads the invoice, its lines, the seller settings
 * and the buyer, then runs the one shared pipeline in ./phase2.ts. Sales, POS,
 * offline sync, decoration, hotel, workshop and any future module call THIS
 * function so there is exactly one XML builder, one hash chain, one signer and
 * one QR implementation in the whole system.
 *
 * The function is idempotent per invoice: re-running it on a signed invoice
 * reuses the same UUID/ICV, and on a cleared/reported/rejected invoice it
 * refuses to run (issue a credit/debit note instead).
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "../../queries/connection";
import {
  invoices,
  invoiceItems,
  companySettings,
  customers,
} from "@db/schema";
import {
  finalizeZatcaInvoice,
  sellerFromSettings,
  buyerFromInvoice,
  type FinalizeInvoiceResult,
  type ZatcaDocumentType,
  type ZatcaEnvironment,
  type ZatcaLineInput,
  type TaxCategory,
} from "./phase2";

export interface BuildInvoiceOptions {
  tenantId: number;
  invoiceId: number;
  /** Defaults to the invoice's own type + buyer VAT. */
  documentType?: ZatcaDocumentType;
  environment?: ZatcaEnvironment;
  egsDeviceId?: string | null;
  billingReference?: { id: string; uuid?: string | null } | null;
  instructionNote?: string | null;
  supplyDate?: string | null;
  offline?: boolean;
  /** Explicit environment override from settings (sandbox flag). */
  sandbox?: boolean;
}

function categoryFor(taxPercent: number | string | null | undefined, explicit?: string | null): TaxCategory {
  if (explicit === "E" || explicit === "Z" || explicit === "O" || explicit === "S") return explicit;
  return Number(taxPercent ?? 15) === 0 ? "Z" : "S";
}

export async function buildAndPersistInvoice(
  opts: BuildInvoiceOptions,
): Promise<FinalizeInvoiceResult> {
  const db = getDb();

  const invoice = await db.query.invoices.findFirst({
    where: and(eq(invoices.id, opts.invoiceId), eq(invoices.tenantId, opts.tenantId)),
  });
  if (!invoice) {
    throw new Error(`Invoice ${opts.invoiceId} not found for tenant ${opts.tenantId}`);
  }

  const [settings] = await db
    .select()
    .from(companySettings)
    .where(eq(companySettings.tenantId, opts.tenantId))
    .limit(1);

  const customer = invoice.customerId
    ? await db.query.customers.findFirst({
        where: and(eq(customers.id, invoice.customerId), eq(customers.tenantId, opts.tenantId)),
      })
    : null;

  const itemRows = await db
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, invoice.id));

  if (!itemRows.length) {
    throw new Error(`Invoice ${opts.invoiceId} has no lines; refusing to sign an empty invoice.`);
  }

  const seller = sellerFromSettings(settings);
  const buyer = buyerFromInvoice(invoice, customer);

  // Missing seller VAT / buyer VAT is a hard error for a legal e-invoice.
  if (!seller.vatNumber) {
    throw new Error(
      "Seller VAT number is missing. Set it in Settings → Company Profile before issuing ZATCA invoices.",
    );
  }

  const documentType: ZatcaDocumentType =
    opts.documentType ||
    (invoice.invoiceType === "simplified"
      ? "simplified"
      : buyer.vatNumber
        ? "standard"
        : "simplified");

  if (documentType === "standard" && !buyer.vatNumber) {
    throw new Error(
      "A standard (B2B) invoice requires the buyer's VAT number. Add it on the customer or use a simplified invoice.",
    );
  }

  const lines: ZatcaLineInput[] = itemRows.map((item) => ({
    description: item.description || "Item",
    descriptionAr: item.descriptionAr,
    quantity: Number(item.quantity) || 0,
    unitPrice: item.unitPrice,
    discount: item.discountPercent
      ? Number((((Number(item.quantity) || 0) * Number(item.unitPrice || 0) * Number(item.discountPercent)) / 100).toFixed(2))
      : 0,
    taxPercent: item.taxPercent ?? 15,
    taxCategory: categoryFor(item.taxPercent, item.taxCategory),
    exemptionReason: item.exemptionReason,
    exemptionReasonCode: item.exemptionReasonCode,
    unitCode: item.unit || "PCE",
  }));

  const environment: ZatcaEnvironment =
    opts.environment || (settings?.zatcaSandbox === false ? "production" : "sandbox");

  const issueDate =
    typeof invoice.date === "string"
      ? invoice.date
      : new Date(invoice.date as any).toISOString().slice(0, 10);

  return finalizeZatcaInvoice({
    tenantId: opts.tenantId,
    invoiceId: invoice.id,
    documentType,
    invoiceNumber: invoice.invoiceNumber,
    issueDate,
    issueTime: invoice.time || undefined,
    currency: settings?.defaultCurrency || "SAR",
    seller,
    buyer,
    lines,
    headerDiscount: invoice.discountAmount,
    paymentType: invoice.paymentMethod,
    environment,
    egsDeviceId: opts.egsDeviceId || invoice.egsDeviceId || "default",
    billingReference: opts.billingReference || null,
    instructionNote: opts.instructionNote || null,
    supplyDate: opts.supplyDate || (invoice as any).supplyDate || null,
    offline: opts.offline,
  });
}

/**
 * Convenience for routers that create an invoice then immediately sign it.
 * Errors are logged and swallowed so a ZATCA outage cannot block the sale;
 * the invoice stays in `draft` and can be re-signed by the retry worker.
 */
export async function signInvoiceSafely(
  opts: BuildInvoiceOptions,
): Promise<FinalizeInvoiceResult | null> {
  try {
    return await buildAndPersistInvoice(opts);
  } catch (error) {
    console.error("[zatca] buildAndPersistInvoice failed for invoice", opts.invoiceId, error);
    return null;
  }
}
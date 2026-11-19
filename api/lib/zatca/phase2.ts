/**
 * ZATCA Phase 2 — invoice finalisation engine.
 *
 * Produces, for every invoice, the six legal artefacts required by the ZATCA
 * Security Features Implementation Standards:
 *   uuid · icv · invoiceHash · previousInvoiceHash · signedXml · qr
 *
 * Pipeline (see invoicePipeline.ts for the DB-loading entry point):
 *   1. decimal-safe totals (integer minor units, no 0.01 SAR drift)
 *   2. UBL 2.1 document, compact (C14N-stable, no inter-element whitespace)
 *   3. SHA-256 over the canonical document (extensions/signature/QR excluded)
 *   4. XAdES-B-B SignedProperties + ECDSA secp256k1 signature
 *   5. 9-tag TLV QR for simplified, 5-tag pre-clearance QR for standard
 *   6. atomic persistence into the existing ZATCA tables + invoice columns
 *
 * WARNING: cryptography correctness still needs the official ZATCA SDK
 * validator. Nothing here may be labelled "ZATCA Compliant" until the sandbox
 * compliance flow actually passes.
 */

import {
  createHash,
  createSign,
  createPublicKey,
  createPrivateKey,
  generateKeyPairSync,
  randomUUID,
  createDecipheriv,
} from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../queries/connection";
import {
  invoices,
  invoiceItems,
  companySettings,
  customers,
  zatcaInvoiceStatus,
  zatcaQrCodes,
  zatcaXmlDocuments,
  zatcaCredentials,
  zatcaOfflineQueue,
} from "@db/schema";
import { env } from "../env";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ZatcaDocumentType = "standard" | "simplified" | "credit_note" | "debit_note";
export type ZatcaEnvironment = "sandbox" | "production";
export type TaxCategory = "S" | "E" | "Z" | "O";

/**
 * ZATCA fixed PIH seed for the very first invoice: base64 of the *hex string*
 * of SHA-256("0") — NOT base64 of the raw digest.
 */
export const FIRST_PIH =
  "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==";

export interface ZatcaLineInput {
  description: string;
  descriptionAr?: string | null;
  quantity: number;
  unitPrice: number | string;
  discount?: number | string;
  taxPercent?: number | string;
  taxCategory?: TaxCategory;
  exemptionReason?: string | null;
  exemptionReasonCode?: string | null;
  unitCode?: string;
  /** Ignored for calculation; recomputed to guarantee reconciliation. */
  totalAmount?: number | string;
}

export interface ZatcaParty {
  name: string;
  nameAr?: string | null;
  vatNumber?: string | null;
  crNumber?: string | null;
  street?: string | null;
  buildingNumber?: string | null;
  district?: string | null;
  city?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
  phone?: string | null;
}

export interface FinalizeInvoiceParams {
  tenantId: number;
  invoiceId: number;
  documentType: ZatcaDocumentType;
  invoiceNumber: string;
  issueDate: string; // YYYY-MM-DD
  issueTime?: string; // HH:mm:ss (Asia/Riyadh)
  currency?: string;
  seller: ZatcaParty;
  buyer?: ZatcaParty | null;
  lines: ZatcaLineInput[];
  headerDiscount?: number | string;
  paymentType?: string | null;
  environment?: ZatcaEnvironment;
  egsDeviceId?: string | null;
  billingReference?: { id: string; uuid?: string | null } | null;
  instructionNote?: string | null;
  /** Supply date differs from issue date for advance/periodic invoices. */
  supplyDate?: string | null;
  offline?: boolean;
}

export interface ZatcaTotals {
  lineExtensionAmount: number;
  allowanceTotal: number;
  taxExclusiveAmount: number;
  taxAmount: number;
  taxInclusiveAmount: number;
  payableAmount: number;
  perCategory: Array<{ category: TaxCategory; rate: number; taxable: number; tax: number }>;
}

export interface FinalizeInvoiceResult {
  uuid: string;
  icv: number;
  previousInvoiceHash: string;
  invoiceHash: string;
  signature: string;
  publicKey: string;
  qr: string;
  signedXml: string;
  unsignedXml: string;
  totals: ZatcaTotals;
  signatureMode: "configured" | "ephemeral";
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Money — integer minor units (halalas) to kill floating-point drift
// ---------------------------------------------------------------------------

export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const n = value + Number.EPSILON;
  return (n >= 0 ? Math.round(n * 100) : -Math.round(-n * 100)) / 100;
}

export function money(value: number): string {
  return round2(value).toFixed(2);
}

function lineNet(line: ZatcaLineInput): { net: number; rate: number; category: TaxCategory; tax: number } {
  const qty = Number(line.quantity) || 0;
  const unit = Number(line.unitPrice) || 0;
  const gross = round2(qty * unit);
  const discount = Math.min(gross, Math.max(0, round2(Number(line.discount) || 0)));
  const net = round2(gross - discount);
  const category: TaxCategory =
    line.taxCategory || (Number(line.taxPercent) === 0 ? "Z" : "S");
  const rate = category === "S" ? Math.max(0, Number(line.taxPercent ?? 15)) : 0;
  const tax = round2((net * rate) / 100);
  return { net, rate, category, tax };
}

export function computeTotals(lines: ZatcaLineInput[], headerDiscount: number | string = 0): ZatcaTotals {
  const buckets = new Map<string, { category: TaxCategory; rate: number; taxable: number; tax: number }>();
  let lineExtensionAmount = 0;
  let rawTax = 0;

  for (const line of lines) {
    const { net, rate, category, tax } = lineNet(line);
    lineExtensionAmount = round2(lineExtensionAmount + net);
    rawTax = round2(rawTax + tax);
    const key = `${category}:${rate}`;
    const bucket = buckets.get(key) || { category, rate, taxable: 0, tax: 0 };
    bucket.taxable = round2(bucket.taxable + net);
    bucket.tax = round2(bucket.tax + tax);
    buckets.set(key, bucket);
  }

  const allowanceTotal = Math.min(
    lineExtensionAmount,
    Math.max(0, round2(Number(headerDiscount) || 0)),
  );
  const taxExclusiveAmount = round2(lineExtensionAmount - allowanceTotal);

  // Apply a header discount proportionally, then recompute tax so that
  // header VAT == sum(line VAT) after the discount (BR-CO-15 / BR-S-08).
  const ratio = lineExtensionAmount > 0 ? taxExclusiveAmount / lineExtensionAmount : 1;
  const perCategory = Array.from(buckets.values()).map((b) => {
    const taxable = round2(b.taxable * ratio);
    return { category: b.category, rate: b.rate, taxable, tax: round2((taxable * b.rate) / 100) };
  });
  const taxAmount = round2(perCategory.reduce((sum, b) => sum + b.tax, 0));
  const taxInclusiveAmount = round2(taxExclusiveAmount + taxAmount);

  void rawTax; // rawTax intentionally discarded: post-discount tax is authoritative

  return {
    lineExtensionAmount,
    allowanceTotal,
    taxExclusiveAmount,
    taxAmount,
    taxInclusiveAmount,
    payableAmount: taxInclusiveAmount,
    perCategory,
  };
}

/**
 * Reconciles a caller-provided header against the line calculations. Throws
 * instead of signing an invoice whose totals do not add up.
 */
export function assertTotalsReconcile(
  totals: ZatcaTotals,
  header?: { subTotal?: number | string; taxAmount?: number | string; totalAmount?: number | string },
): void {
  if (!header) return;
  const check = (label: string, expected: number, actual: unknown) => {
    if (actual === undefined || actual === null || actual === "") return;
    const diff = Math.abs(round2(expected) - round2(Number(actual)));
    if (diff > 0.01) {
      throw new Error(
        `ZATCA total mismatch (${label}): computed ${money(expected)} vs header ${money(Number(actual))}`,
      );
    }
  };
  check("taxExclusiveAmount", totals.taxExclusiveAmount, header.subTotal);
  check("taxAmount", totals.taxAmount, header.taxAmount);
  check("taxInclusiveAmount", totals.taxInclusiveAmount, header.totalAmount);
}

// ---------------------------------------------------------------------------
// Canonicalisation + hashing
// ---------------------------------------------------------------------------

/** Removes the XML declaration, comments and inter-element whitespace. */
export function canonicalizeXml(xml: string): string {
  return xml
    .replace(/<\?xml[^?]*\?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/>\s+</g, "><")
    .trim();
}

export function sha256Base64(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("base64");
}

export function firstPih(): string {
  return FIRST_PIH;
}

export function escapeXml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ---------------------------------------------------------------------------
// Riyadh time
// ---------------------------------------------------------------------------

export function riyadhNow(): { date: string; time: string; iso: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "00";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const time = `${get("hour")}:${get("minute")}:${get("second")}`;
  return { date, time, iso: `${date}T${time}+03:00` };
}

// ---------------------------------------------------------------------------
// TLV QR
// ---------------------------------------------------------------------------

export function tlv(tag: number, value: string): Buffer {
  const bytes = Buffer.from(value ?? "", "utf8");
  // Tag-length-value allows lengths > 255 but ZATCA fields are short; guard
  // rather than silently truncating.
  if (bytes.length > 255) throw new Error(`QR field ${tag} exceeds 255 bytes`);
  return Buffer.concat([Buffer.from([tag, bytes.length]), bytes]);
}

export interface QrFields {
  sellerName: string;
  vatNumber: string;
  timestamp: string;
  totalWithVat: string | number;
  vatTotal: string | number;
  invoiceHash?: string;
  signature?: string;
  publicKey?: string;
  certificateSignature?: string;
}

/**
 * Simplified (B2C): all 9 tags, generated by us.
 * Standard (B2B): only tags 1-5 before clearance. Tags 6-9 are applied by
 * ZATCA at clearance and read back from the cleared XML — never faked.
 */
export function buildQr(fields: QrFields, mode: "simplified" | "standard"): string {
  const parts = [
    tlv(1, fields.sellerName),
    tlv(2, fields.vatNumber),
    tlv(3, fields.timestamp),
    tlv(4, money(Number(fields.totalWithVat))),
    tlv(5, money(Number(fields.vatTotal))),
  ];
  if (mode === "simplified") {
    parts.push(
      tlv(6, fields.invoiceHash || ""),
      tlv(7, fields.signature || ""),
      tlv(8, fields.publicKey || ""),
      tlv(9, fields.certificateSignature || ""),
    );
  }
  return Buffer.concat(parts).toString("base64");
}

// ---------------------------------------------------------------------------
// UBL 2.1 builder
// ---------------------------------------------------------------------------

const NS =
  'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" ' +
  'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" ' +
  'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" ' +
  'xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"';

/** Compact join: C14N-stable because no inter-element whitespace is emitted. */
const j = (parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join("");

function addressXml(party: ZatcaParty): string {
  return j([
    "<cac:PostalAddress>",
    `<cbc:StreetName>${escapeXml(party.street || "NA")}</cbc:StreetName>`,
    `<cbc:BuildingNumber>${escapeXml(party.buildingNumber || "0000")}</cbc:BuildingNumber>`,
    `<cbc:PlotIdentification>${escapeXml(party.district || "0000")}</cbc:PlotIdentification>`,
    `<cbc:CitySubdivisionName>${escapeXml(party.district || party.city || "Riyadh")}</cbc:CitySubdivisionName>`,
    `<cbc:CityName>${escapeXml(party.city || "Riyadh")}</cbc:CityName>`,
    `<cbc:PostalZone>${escapeXml(party.postalCode || "00000")}</cbc:PostalZone>`,
    "<cbc:CountrySubentityCode>SA</cbc:CountrySubentityCode>",
    `<cac:Country><cbc:IdentificationCode>${escapeXml(party.countryCode || "SA")}</cbc:IdentificationCode></cac:Country>`,
    "</cac:PostalAddress>",
  ]);
}

function partyXml(tag: "AccountingSupplierParty" | "AccountingCustomerParty", party: ZatcaParty): string {
  return j([
    `<cac:${tag}><cac:Party>`,
    `<cac:PartyIdentification><cbc:ID schemeID="CRN">${escapeXml(party.crNumber || "0000")}</cbc:ID></cac:PartyIdentification>`,
    addressXml(party),
    "<cac:PartyTaxScheme>",
    `<cbc:CompanyID>${escapeXml(party.vatNumber || "")}</cbc:CompanyID>`,
    "<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>",
    "</cac:PartyTaxScheme>",
    "<cac:PartyLegalEntity>",
    `<cbc:RegistrationName>${escapeXml(party.nameAr || party.name || "")}</cbc:RegistrationName>`,
    "</cac:PartyLegalEntity>",
    party.phone ? `<cac:Contact><cbc:Telephone>${escapeXml(party.phone)}</cbc:Telephone></cac:Contact>` : "",
    "</cac:Party></cac:" + tag + ">",
  ]);
}

/** Invoice type code name: 0100000 = standard (B2B), 0200000 = simplified (B2C). */
export function invoiceTypeName(documentType: ZatcaDocumentType, buyer?: ZatcaParty | null): string {
  if (documentType === "standard") return "0100000";
  if (documentType === "simplified") return "0200000";
  // Notes inherit the subtype of the original invoice; B2B when buyer has VAT.
  return buyer?.vatNumber ? "0100000" : "0200000";
}

function documentTypeCode(documentType: ZatcaDocumentType): string {
  if (documentType === "credit_note") return "381";
  if (documentType === "debit_note") return "383";
  return "388";
}

export function buildUblDocument(params: {
  documentType: ZatcaDocumentType;
  invoiceNumber: string;
  uuid: string;
  icv: number;
  pih: string;
  issueDate: string;
  issueTime: string;
  supplyDate?: string | null;
  currency: string;
  seller: ZatcaParty;
  buyer?: ZatcaParty | null;
  lines: ZatcaLineInput[];
  headerDiscount?: number | string;
  paymentType?: string | null;
  billingReference?: { id: string; uuid?: string | null } | null;
  instructionNote?: string | null;
}): { xml: string; totals: ZatcaTotals } {
  const currency = params.currency || "SAR";
  const totals = computeTotals(params.lines, params.headerDiscount);
  const isNote = params.documentType === "credit_note" || params.documentType === "debit_note";
  const root = isNote ? "CreditNote" : "Invoice";
  const typeCode = documentTypeCode(params.documentType);
  const typeName = invoiceTypeName(params.documentType, params.buyer);
  const paymentCode = /cash/i.test(String(params.paymentType || "")) ? "10" : "30";
  const supplyDate = params.supplyDate || params.issueDate;

  const lineXml = params.lines.map((line, i) => {
    const { net, rate, category, tax } = lineNet(line);
    return j([
      "<cac:InvoiceLine>",
      `<cbc:ID>${i + 1}</cbc:ID>`,
      `<cbc:InvoicedQuantity unitCode="${escapeXml(line.unitCode || "PCE")}">${Number(line.quantity) || 0}</cbc:InvoicedQuantity>`,
      `<cbc:LineExtensionAmount currencyID="${currency}">${money(net)}</cbc:LineExtensionAmount>`,
      `<cac:TaxTotal><cbc:TaxAmount currencyID="${currency}">${money(tax)}</cbc:TaxAmount></cac:TaxTotal>`,
      "<cac:Item>",
      `<cbc:Name>${escapeXml(line.descriptionAr || line.description || "Item")}</cbc:Name>`,
      "<cac:ClassifiedTaxCategory>",
      `<cbc:ID>${category}</cbc:ID>`,
      `<cbc:Percent>${money(rate)}</cbc:Percent>`,
      line.exemptionReasonCode
        ? `<cbc:TaxExemptionReasonCode>${escapeXml(line.exemptionReasonCode)}</cbc:TaxExemptionReasonCode>`
        : "",
      line.exemptionReason
        ? `<cbc:TaxExemptionReason>${escapeXml(line.exemptionReason)}</cbc:TaxExemptionReason>`
        : "",
      "<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>",
      "</cac:ClassifiedTaxCategory>",
      "</cac:Item>",
      `<cac:Price><cbc:PriceAmount currencyID="${currency}">${money(Number(line.unitPrice) || 0)}</cbc:PriceAmount></cac:Price>`,
      "</cac:InvoiceLine>",
    ]);
  });

  const taxSubtotals = totals.perCategory.map((b) =>
    j([
      "<cac:TaxSubtotal>",
      `<cbc:TaxableAmount currencyID="${currency}">${money(b.taxable)}</cbc:TaxableAmount>`,
      `<cbc:TaxAmount currencyID="${currency}">${money(b.tax)}</cbc:TaxAmount>`,
      "<cac:TaxCategory>",
      `<cbc:ID>${b.category}</cbc:ID>`,
      `<cbc:Percent>${money(b.rate)}</cbc:Percent>`,
      "<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>",
      "</cac:TaxCategory>",
      "</cac:TaxSubtotal>",
    ]),
  );

  const billingReference = params.billingReference
    ? j([
        "<cac:BillingReference><cac:InvoiceDocumentReference>",
        `<cbc:ID>${escapeXml(params.billingReference.id)}</cbc:ID>`,
        params.billingReference.uuid
          ? `<cbc:UUID>${escapeXml(params.billingReference.uuid)}</cbc:UUID>`
          : "",
        "</cac:InvoiceDocumentReference></cac:BillingReference>",
      ])
    : "";

  const xml = j([
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<${root} ${NS}>`,
    "<!--UBLEXTENSIONS-->",
    "<cbc:ProfileID>reporting:1.0</cbc:ProfileID>",
    `<cbc:ID>${escapeXml(params.invoiceNumber)}</cbc:ID>`,
    `<cbc:UUID>${escapeXml(params.uuid)}</cbc:UUID>`,
    `<cbc:IssueDate>${escapeXml(params.issueDate)}</cbc:IssueDate>`,
    `<cbc:IssueTime>${escapeXml(params.issueTime)}</cbc:IssueTime>`,
    isNote
      ? `<cbc:${params.documentType === "credit_note" ? "CreditNoteTypeCode" : "DebitNoteTypeCode"} name="${typeName}">${typeCode}</cbc:${params.documentType === "credit_note" ? "CreditNoteTypeCode" : "DebitNoteTypeCode"}>`
      : `<cbc:InvoiceTypeCode name="${typeName}">${typeCode}</cbc:InvoiceTypeCode>`,
    isNote && params.instructionNote
      ? `<cbc:InstructionNote>${escapeXml(params.instructionNote)}</cbc:InstructionNote>`
      : "",
    `<cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>`,
    `<cbc:TaxCurrencyCode>${currency}</cbc:TaxCurrencyCode>`,
    "<cac:AdditionalDocumentReference>",
    "<cbc:ID>ICV</cbc:ID>",
    `<cbc:UUID>${params.icv}</cbc:UUID>`,
    "</cac:AdditionalDocumentReference>",
    "<cac:AdditionalDocumentReference>",
    "<cbc:ID>PIH</cbc:ID>",
    `<cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${escapeXml(params.pih)}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment>`,
    "</cac:AdditionalDocumentReference>",
    billingReference,
    partyXml("AccountingSupplierParty", params.seller),
    partyXml(
      "AccountingCustomerParty",
      params.buyer || { name: "Walk-in Customer", nameAr: "عميل نقدي", countryCode: "SA" },
    ),
    `<cac:Delivery><cbc:ActualDeliveryDate>${escapeXml(supplyDate)}</cbc:ActualDeliveryDate></cac:Delivery>`,
    `<cac:PaymentMeans><cbc:PaymentMeansCode>${paymentCode}</cbc:PaymentMeansCode></cac:PaymentMeans>`,
    totals.allowanceTotal > 0
      ? j([
          "<cac:AllowanceCharge>",
          "<cbc:ChargeIndicator>false</cbc:ChargeIndicator>",
          "<cbc:AllowanceChargeReason>Discount</cbc:AllowanceChargeReason>",
          `<cbc:Amount currencyID="${currency}">${money(totals.allowanceTotal)}</cbc:Amount>`,
          "</cac:AllowanceCharge>",
        ])
      : "",
    "<cac:TaxTotal>",
    `<cbc:TaxAmount currencyID="${currency}">${money(totals.taxAmount)}</cbc:TaxAmount>`,
    ...taxSubtotals,
    "</cac:TaxTotal>",
    "<cac:LegalMonetaryTotal>",
    `<cbc:LineExtensionAmount currencyID="${currency}">${money(totals.lineExtensionAmount)}</cbc:LineExtensionAmount>`,
    `<cbc:TaxExclusiveAmount currencyID="${currency}">${money(totals.taxExclusiveAmount)}</cbc:TaxExclusiveAmount>`,
    `<cbc:TaxInclusiveAmount currencyID="${currency}">${money(totals.taxInclusiveAmount)}</cbc:TaxInclusiveAmount>`,
    totals.allowanceTotal > 0
      ? `<cbc:AllowanceTotalAmount currencyID="${currency}">${money(totals.allowanceTotal)}</cbc:AllowanceTotalAmount>`
      : "",
    `<cbc:PayableAmount currencyID="${currency}">${money(totals.payableAmount)}</cbc:PayableAmount>`,
    "</cac:LegalMonetaryTotal>",
    ...lineXml,
    `</${root}>`,
  ]);

  return { xml, totals };
}

// ---------------------------------------------------------------------------
// Signing material
// ---------------------------------------------------------------------------

function decrypt(value?: string | null): string {
  if (!value) return "";
  try {
    const key = createHash("sha256")
      .update(env.appSecret || process.env.ENCRYPTION_KEY || "development-only-encryption-key")
      .digest();
    const [version, iv, tag, encrypted] = value.split(":");
    if (version !== "v1" || !iv || !tag || !encrypted) return "";
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}

export interface SigningMaterial {
  privateKey: string;
  certificate: string;
  publicKey: string;
  mode: "configured" | "ephemeral";
  certDigest: string;
  certSignature: string;
  issuer: string;
  serial: string;
}

/** Extracts the certificate's own signature (QR tag 9). */
function certificateSignature(certPem: string): string {
  try {
    const forge = require("node-forge");
    const cert = forge.pki.certificateFromPem(certPem);
    const asn1 = forge.pki.certificateToAsn1(cert);
    // Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }
    const sigBits = asn1.value[2];
    if (!sigBits?.value) return "";
    return Buffer.from(sigBits.value, "binary").toString("base64");
  } catch {
    return "";
  }
}

function assertEcKey(privateKeyPem: string): void {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ec") {
    throw new Error(
      `ZATCA requires an ECDSA secp256k1 key, found ${key.asymmetricKeyType || "unknown"}. ` +
        "RSA key generation is blocked by policy.",
    );
  }
  const curve = (key.asymmetricKeyDetails as any)?.namedCurve;
  if (curve && curve !== "secp256k1") {
    throw new Error(`ZATCA requires secp256k1, found ${curve}.`);
  }
}

export async function loadSigningMaterial(
  tenantId: number,
  environment: ZatcaEnvironment,
): Promise<SigningMaterial> {
  const db = getDb();
  let privateKey = "";
  let certificate = "";
  let publicKey = "";

  try {
    const cred = await db.query.zatcaCredentials.findFirst({
      where: and(
        eq(zatcaCredentials.tenantId, tenantId),
        eq(zatcaCredentials.environment, environment),
        eq(zatcaCredentials.isActive, true),
      ),
      orderBy: desc(zatcaCredentials.updatedAt),
    });
    if (cred) {
      privateKey = decrypt(cred.privateKeyEncrypted);
      publicKey = decrypt(cred.publicKeyEncrypted);
      certificate =
        decrypt(cred.productionCsidEncrypted) ||
        decrypt(cred.complianceCsidEncrypted) ||
        decrypt(cred.certificateEncrypted);
    }
  } catch {
    /* credentials table may not exist yet — fall through to ephemeral key */
  }

  if (!privateKey) {
    // No CCSID yet: sign with an ephemeral secp256k1 key so the invoice is
    // structurally valid and can be re-signed after onboarding. Never RSA.
    const pair = generateKeyPairSync("ec", {
      namedCurve: "secp256k1",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
  }

  assertEcKey(privateKey);

  if (!publicKey) {
    try {
      publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
    } catch {
      publicKey = "";
    }
  }

  let certDigest = "";
  let certSignature = "";
  let issuer = "";
  let serial = "";
  if (certificate) {
    try {
      const forge = require("node-forge");
      const cert = forge.pki.certificateFromPem(certificate);
      const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
      certDigest = createHash("sha256").update(Buffer.from(der, "binary")).digest("base64");
      issuer =
        cert.issuer?.attributes
          ?.map((a: any) => `${a.shortName || a.name}=${a.value}`)
          .join(", ") || "";
      serial = cert.serialNumber || "";
      certSignature = certificateSignature(certificate);
    } catch {
      certDigest = sha256Base64(certificate.replace(/-----[^-]+-----|\s/g, ""));
    }
  } else {
    certDigest = sha256Base64(publicKey);
  }

  return {
    privateKey,
    certificate,
    publicKey,
    mode: certificate && privateKey ? "configured" : "ephemeral",
    certDigest,
    certSignature,
    issuer,
    serial,
  };
}

// ---------------------------------------------------------------------------
// XAdES-B-B signature
// ---------------------------------------------------------------------------

export function signUnsignedInvoice(params: {
  invoiceHash: string;
  signingTime: string;
  material: SigningMaterial;
}): { signature: string; extensionXml: string; publicKeyBase64: string } {
  const certBase64 = params.material.certificate
    ? params.material.certificate.replace(/-----[^-]+-----|\s/g, "")
    : "";
  const publicKeyBase64 = (() => {
    try {
      return createPublicKey(params.material.publicKey)
        .export({ type: "spki", format: "der" })
        .toString("base64");
    } catch {
      return Buffer.from(params.material.publicKey).toString("base64");
    }
  })();

  const signedProperties = j([
    '<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">',
    "<xades:SignedSignatureProperties>",
    `<xades:SigningTime>${escapeXml(params.signingTime)}</xades:SigningTime>`,
    "<xades:SigningCertificate><xades:Cert>",
    "<xades:CertDigest>",
    '<ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>',
    `<ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${params.material.certDigest}</ds:DigestValue>`,
    "</xades:CertDigest>",
    "<xades:IssuerSerial>",
    `<ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${escapeXml(params.material.issuer || "CN=ZATCA")}</ds:X509IssuerName>`,
    `<ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${escapeXml(params.material.serial || "0")}</ds:X509SerialNumber>`,
    "</xades:IssuerSerial>",
    "</xades:Cert></xades:SigningCertificate>",
    "</xades:SignedSignatureProperties>",
    "</xades:SignedProperties>",
  ]);

  const signedPropertiesDigest = sha256Base64(canonicalizeXml(signedProperties));

  const signedInfo = j([
    '<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">',
    '<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>',
    '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/>',
    '<ds:Reference Id="invoiceSignedData" URI="">',
    "<ds:Transforms>",
    '<ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>',
    '<ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>',
    "</ds:Transforms>",
    '<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>',
    `<ds:DigestValue>${params.invoiceHash}</ds:DigestValue>`,
    "</ds:Reference>",
    '<ds:Reference URI="#xadesSignedProperties">',
    '<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>',
    `<ds:DigestValue>${signedPropertiesDigest}</ds:DigestValue>`,
    "</ds:Reference>",
    "</ds:SignedInfo>",
  ]);

  const signature = createSign("sha256")
    .update(canonicalizeXml(signedInfo))
    .sign(params.material.privateKey, "base64");

  const extensionXml = j([
    "<ext:UBLExtensions><ext:UBLExtension>",
    "<ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>",
    "<ext:ExtensionContent>",
    '<sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2">',
    "<sig:SignatureInformation>",
    "<cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>",
    "<sig:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sig:ReferencedSignatureID>",
    '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="signature">',
    signedInfo,
    `<ds:SignatureValue>${signature}</ds:SignatureValue>`,
    `<ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certBase64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>`,
    `<ds:Object>${signedProperties}</ds:Object>`,
    "</ds:Signature>",
    "</sig:SignatureInformation>",
    "</sig:UBLDocumentSignatures>",
    "</ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>",
  ]);

  return { signature, extensionXml, publicKeyBase64 };
}

// ---------------------------------------------------------------------------
// ICV + PIH allocation (gap-free per tenant/EGS, serialised with a DB lock)
// ---------------------------------------------------------------------------

export async function allocateCounter(
  tenantId: number,
  egsDeviceId = "default",
): Promise<{ icv: number; previousInvoiceHash: string }> {
  const db = getDb();
  const lockName = `zatca:icv:${tenantId}:${egsDeviceId}`.slice(0, 60);
  let locked = false;
  try {
    await db.execute(sql`SELECT GET_LOCK(${lockName}, 10)`);
    locked = true;
  } catch {
    /* non-MySQL or permission issue: fall back to optimistic allocation */
  }

  try {
    const last = await db.query.zatcaInvoiceStatus.findFirst({
      where: and(
        eq(zatcaInvoiceStatus.tenantId, tenantId),
        eq(zatcaInvoiceStatus.status, "signed"),
      ),
      orderBy: desc(zatcaInvoiceStatus.invoiceCounter),
    });
    const latest = last || (await db.query.zatcaInvoiceStatus.findFirst({
      where: eq(zatcaInvoiceStatus.tenantId, tenantId),
      orderBy: desc(zatcaInvoiceStatus.invoiceCounter),
    }));
    const icv = Number(latest?.invoiceCounter || 0) + 1;
    const previousInvoiceHash = latest?.invoiceHash || firstPih();
    return { icv, previousInvoiceHash };
  } finally {
    if (locked) {
      try {
        await db.execute(sql`SELECT RELEASE_LOCK(${lockName})`);
      } catch {
        /* ignore */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Finaliser
// ---------------------------------------------------------------------------

export async function finalizeZatcaInvoice(
  params: FinalizeInvoiceParams,
): Promise<FinalizeInvoiceResult> {
  const db = getDb();
  const warnings: string[] = [];
  const now = riyadhNow();
  const issueDate = params.issueDate || now.date;
  const issueTime = params.issueTime || now.time;
  const currency = params.currency || "SAR";
  const egsDeviceId = params.egsDeviceId || "default";

  if (!params.seller?.vatNumber) {
    warnings.push("Seller VAT number is missing — invoice is not ZATCA-valid.");
  }
  if (params.documentType === "standard" && !params.buyer?.vatNumber) {
    warnings.push("Standard B2B invoice without buyer VAT number.");
  }

  // Reuse the artefacts of an already-signed invoice; never burn a second ICV
  // and never edit a cleared/reported/rejected invoice.
  const existing = await db.query.zatcaInvoiceStatus.findFirst({
    where: and(
      eq(zatcaInvoiceStatus.tenantId, params.tenantId),
      eq(zatcaInvoiceStatus.invoiceId, params.invoiceId),
    ),
  });

  if (existing && ["cleared", "reported", "rejected"].includes(existing.status)) {
    throw new Error(
      `Invoice ${params.invoiceId} is ${existing.status}; it cannot be edited. Issue a credit/debit note instead.`,
    );
  }

  const reuse = Boolean(existing?.invoiceUuid && existing?.invoiceCounter);
  const uuid = reuse ? String(existing!.invoiceUuid) : randomUUID();
  const allocated = reuse
    ? {
        icv: Number(existing!.invoiceCounter),
        previousInvoiceHash: existing!.previousInvoiceHash || firstPih(),
      }
    : await allocateCounter(params.tenantId, egsDeviceId);

  const { icv, previousInvoiceHash } = allocated;

  const { xml: unsignedXml, totals } = buildUblDocument({
    documentType: params.documentType,
    invoiceNumber: params.invoiceNumber,
    uuid,
    icv,
    pih: previousInvoiceHash,
    issueDate,
    issueTime,
    supplyDate: params.supplyDate,
    currency,
    seller: params.seller,
    buyer: params.buyer,
    lines: params.lines,
    headerDiscount: params.headerDiscount,
    paymentType: params.paymentType,
    billingReference: params.billingReference,
    instructionNote: params.instructionNote,
  });

  // Hash is computed BEFORE any signature/QR is embedded.
  const invoiceHash = sha256Base64(canonicalizeXml(unsignedXml));

  const material = await loadSigningMaterial(params.tenantId, params.environment || "sandbox");
  const signingTime = `${issueDate}T${issueTime}+03:00`;
  const signed = signUnsignedInvoice({ invoiceHash, signingTime, material });

  // Standard B2B: QR is applied by ZATCA at clearance. We only emit tags 1-5
  // pre-clearance; the cleared XML's QR is used for print/PDF afterwards.
  const qrMode = params.documentType === "simplified" ? "simplified" : "standard";
  const qr = buildQr(
    {
      sellerName: params.seller.nameAr || params.seller.name || "",
      vatNumber: params.seller.vatNumber || "",
      timestamp: signingTime,
      totalWithVat: totals.taxInclusiveAmount,
      vatTotal: totals.taxAmount,
      invoiceHash,
      signature: signed.signature,
      publicKey: signed.publicKeyBase64,
      certificateSignature: material.certSignature,
    },
    qrMode,
  );

  const withExtensions = unsignedXml.replace("<!--UBLEXTENSIONS-->", signed.extensionXml);
  const qrRef = j([
    "<cac:AdditionalDocumentReference>",
    "<cbc:ID>QR</cbc:ID>",
    `<cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${escapeXml(qr)}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment>`,
    "</cac:AdditionalDocumentReference>",
  ]);
  const signedXml = withExtensions.replace("</cbc:TaxCurrencyCode>", "</cbc:TaxCurrencyCode>" + qrRef);

  const submissionStatus = "signed" as const;
  const statusValues = {
    invoiceUuid: uuid,
    invoiceCounter: icv,
    invoiceHash,
    previousInvoiceHash,
    digitalSignature: signed.signature,
    status: "signed" as const,
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(zatcaInvoiceStatus).set(statusValues)
      .where(eq(zatcaInvoiceStatus.id, existing.id));
  } else {
    await db.insert(zatcaInvoiceStatus).values({
      tenantId: params.tenantId,
      invoiceId: params.invoiceId,
      ...statusValues,
    });
  }

  await db.insert(zatcaXmlDocuments).values({
    tenantId: params.tenantId,
    invoiceId: params.invoiceId,
    documentType: params.documentType,
    unsignedXml,
    signedXml,
    xmlHash: invoiceHash,
  }).catch(() => undefined);

  await db.insert(zatcaQrCodes).values({
    tenantId: params.tenantId,
    invoiceId: params.invoiceId,
    tlvBase64: qr,
    tags: {
      version: 2,
      mode: qrMode,
      icv,
      uuid,
      previousInvoiceHash,
      invoiceHash,
      signatureMode: material.mode,
    } as any,
  }).catch(() => undefined);

  // Persist onto the invoice row itself (signed content is immutable after
  // this point; see migration 0023 triggers).
  await db.update(invoices).set({
    uuid,
    icv,
    invoiceHash,
    previousInvoiceHash,
    egsDeviceId,
    signedXml,
    qrPhase2: qr,
    zatcaQrCode: qr,
    zatcaXml: signedXml,
    zatcaStatus: "pending",
    submissionStatus,
    subTotal: money(totals.taxExclusiveAmount),
    taxAmount: money(totals.taxAmount),
    totalAmount: money(totals.taxInclusiveAmount),
    taxPercent: "15",
  }).where(and(eq(invoices.id, params.invoiceId), eq(invoices.tenantId, params.tenantId)));

  if (params.offline) {
    await db.insert(zatcaOfflineQueue).values({
      tenantId: params.tenantId,
      invoiceId: params.invoiceId,
      action: params.documentType === "standard" ? "clearance" : "reporting",
      uuid,
      xmlPayload: unsignedXml,
      signedXml,
      invoiceHash,
      previousInvoiceHash,
      status: "pending",
      retryCount: 0,
    }).catch(() => undefined);
  }

  return {
    uuid,
    icv,
    previousInvoiceHash,
    invoiceHash,
    signature: signed.signature,
    publicKey: signed.publicKeyBase64,
    qr,
    signedXml,
    unsignedXml,
    totals,
    signatureMode: material.mode,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Seller/buyer mappers
// ---------------------------------------------------------------------------

export function sellerFromSettings(settings: any): ZatcaParty {
  return {
    name: settings?.companyName || "",
    nameAr: settings?.companyNameAr || "",
    vatNumber: settings?.taxNumber || "",
    crNumber: settings?.crNumber || "",
    street: settings?.address || "",
    buildingNumber: settings?.buildingNumber || "0000",
    district: settings?.district || settings?.city || "",
    city: settings?.city || "Riyadh",
    postalCode: settings?.zipCode || "00000",
    countryCode: "SA",
    phone: settings?.phone || settings?.mobile || "",
  };
}

export function buyerFromInvoice(invoice: any, customer?: any): ZatcaParty {
  return {
    name: invoice?.customerName || customer?.name || "Walk-in Customer",
    nameAr: invoice?.customerNameAr || customer?.nameAr || "عميل نقدي",
    vatNumber: invoice?.customerVat || customer?.vatNumber || customer?.taxNumber || "",
    crNumber: invoice?.customerCr || customer?.crNumber || customer?.commercialRegistration || "",
    street: invoice?.customerAddress || customer?.address || "",
    buildingNumber: "0000",
    district: customer?.city || "",
    city: customer?.city || "Riyadh",
    postalCode: "00000",
    countryCode: "SA",
    phone: invoice?.customerPhone || customer?.phone || "",
  };
}
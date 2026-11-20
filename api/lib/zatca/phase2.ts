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
 *      via true W3C C14N 1.1 — proven byte-exact against a live 200-CLEARED
 *      ZATCA sandbox invoice
 *   4. XAdES-B-B SignedProperties + ECDSA secp256k1 signature (official
 *      Phase 2 layout: sig/sac/sbc, 3 XPath transforms, QualifyingProperties)
 *   5. 8-tag TLV QR pre-clearance (standard B2B), 9-tag QR simplified (B2C)
 *      — tag 8 is the raw SPKI DER byte string, not base64
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
  X509Certificate,
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

// ---------------------------------------------------------------------------
// W3C Canonical XML 1.1 (http://www.w3.org/2006/12/xml-c14n11)
//
// Used for the invoice hash (guideline §5.2 Step 1) and the signature
// digests. Self-contained (no DOM dependency), implementing the spec for the
// document class ZATCA invoices use:
//  - XML declaration, comments and PIs dropped; CDATA inlined
//  - empty elements rendered as start-end pairs
//  - element/attribute QNames keep their original prefixes
//  - namespace declarations: only in-use ones re-declared, sorted
//    lexicographically by (namespace URI, then prefix)
//  - explicit `xmlns=""` rendered only when the element is in the default
//    namespace and its parent (in canonical form) declares a non-empty one
//  - attributes sorted by (namespace URI, then local name), values normalized
//    (& < " #x9 #xA #xD → uppercase-hex character references)
//  - character data: & < > escaped, #xD → &#xD; (line feeds already normalised
//    to #xA during parsing); entity/character references resolved first
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeCharRefs(value: string): string {
  return value.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (all, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return NAMED_ENTITIES[body] ?? all;
  });
}

interface C14nAttr {
  prefix: string;
  local: string;
  ns: string; // resolved namespace URI ("" for the empty namespace)
  value: string; // decoded, attribute-value-normalized
}

interface C14nNs {
  prefix: string; // "" = default namespace
  uri: string;
}

interface C14nNode {
  prefix: string;
  local: string;
  attrs: C14nAttr[];
  ns: C14nNs[];
  /**
   * Ordered child items: element children as C14nNode, character data (text,
   * CDATA — with entity references resolved and line feeds normalised) as
   * strings, interleaved in document order.
   */
  children: Array<C14nNode | string>;
}

const XML_NS = "http://www.w3.org/XML/1998/namespace";

function splitQName(q: string): [string, string] {
  const i = q.indexOf(":");
  return i === -1 ? ["", q] : [q.slice(0, i), q.slice(i + 1)];
}

function normalizeLfs(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function parseC14nXml(xml: string): C14nNode {
  let i = 0;
  const n = xml.length;
  const scope = new Map<string, string>(); // prefix -> namespace URI
  let root!: C14nNode;

  // Prolog: XML declaration, comments, PIs, DOCTYPE.
  for (;;) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) throw new Error("C14N: no document element");
    i = lt;
    if (xml.startsWith("<?", i)) i = xml.indexOf("?>", i) + 2;
    else if (xml.startsWith("<!--", i)) i = xml.indexOf("-->", i) + 3;
    else if (xml.startsWith("<!", i)) i = xml.indexOf(">", i) + 1;
    else break;
  }

  const parseElement = (): C14nNode => {
    const gt = xml.indexOf(">", i);
    if (gt === -1) throw new Error("C14N: unterminated start tag");
    const inner = xml.slice(i + 1, gt);
    const selfClose = inner.endsWith("/");
    const body = selfClose ? inner.slice(0, -1) : inner;
    i = gt + 1;

    const qm = /^[\s:._A-Za-z][\w:.\-]*/.exec(body);
    if (!qm) throw new Error("C14N: malformed start tag");
    const [prefix, local] = splitQName(qm[0]);
    const attrs: C14nAttr[] = [];
    const ns: C14nNs[] = [];
    const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(body))) {
      const q = am[1];
      const raw = am[3] !== undefined ? am[3] : am[4];
      if (q === "xmlns") ns.push({ prefix: "", uri: decodeCharRefs(raw) });
      else if (q.startsWith("xmlns:")) ns.push({ prefix: q.slice(6), uri: decodeCharRefs(raw) });
      else {
        const [apfx, aloc] = splitQName(q);
        const bound = apfx === "xml" ? XML_NS : apfx === "" ? "" : scope.get(apfx) ?? "";
        // Attribute value normalisation: resolve references, then collapse
        // #xD and #x9/#xA to single spaces (spec §2.1, validating processor).
        let value = decodeCharRefs(raw);
        value = value.replace(/\r\n/g, " ").replace(/\r/g, " ").replace(/\n/g, " ");
        attrs.push({ prefix: apfx, local: aloc, ns: bound, value });
      }
    }

    const node: C14nNode = { prefix, local, attrs, ns, children: [] };
    const parent = scope;
    const push = (prefix: string, uri: string): void => {
      if (uri) scope.set(prefix, uri);
      else scope.delete(prefix);
    };
    const prev: Array<[string, string | undefined]> = ns.map((d) => [d.prefix, parent.get(d.prefix)]);
    // Attribute prefixes bind to this element's in-scope declarations (own + ancestors),
    // per the XML Namespaces recommendation.
    const ownScope = new Map(parent);
    for (const d of ns) {
      if (d.uri) ownScope.set(d.prefix, d.uri);
      else ownScope.delete(d.prefix);
    }
    for (const a of node.attrs) {
      const uri = a.prefix === "xml" ? XML_NS : a.prefix === "" ? "" : ownScope.get(a.prefix) ?? "";
      a.ns = uri;
    }
    for (const d of ns) push(d.prefix, d.uri);

    if (selfClose) {
      scope.clear();
      parent.forEach((v, k) => scope.set(k, v));
      return node;
    }

    for (;;) {
      const lt = xml.indexOf("<", i);
      if (lt === -1) throw new Error("C14N: EOF inside element");
      if (lt > i) node.children.push(normalizeLfs(decodeCharRefs(xml.slice(i, lt))));
      if (xml.startsWith("<!--", lt)) {
        i = xml.indexOf("-->", lt) + 3;
      } else if (xml.startsWith("<?", lt)) {
        i = xml.indexOf("?>", lt) + 2;
      } else if (xml.startsWith("<![CDATA[", lt)) {
        const end = xml.indexOf("]]>", lt);
        if (end === -1) throw new Error("C14N: unterminated CDATA");
        node.children.push(normalizeLfs(xml.slice(lt + 9, end)));
        i = end + 3;
      } else if (xml.startsWith("</", lt)) {
        const end = xml.indexOf(">", lt);
        if (end === -1) throw new Error("C14N: unterminated end tag");
        i = end + 1;
        scope.clear();
        for (const [k, v] of prev) {
          if (v !== undefined) scope.set(k, v);
        }
        return node;
      } else {
        i = lt;
        node.children.push(parseElement());
      }
    }
  };

  root = parseElement();
  return root;
}

function escC14nText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r/g, "&#xD;");
}

function escC14nAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/\t/g, "&#x9;")
    .replace(/\n/g, "&#xA;")
    .replace(/\r/g, "&#xD;");
}

/**
 * C14N11 namespace rendering.
 *
 * Every namespace declaration declared ON this element is emitted, whether or
 * not a descendant actually uses the namespace — C14N only omits a declaration
 * when it is a REDUNDANT re-declaration (the nearest ancestor already binds the
 * same prefix to the same URI). This matches the .NET / libxml2 reference
 * implementations (e.g. a root `xmlns:ext` with no `ext:` descendant survives),
 * which is exactly what ZATCA's hash recomputation expects.
 */
function renderC14nNode(node: C14nNode, scope: Map<string, string>, parentInDefaultNs: string | null, out: string[]): void {
  const tag = node.prefix ? `${node.prefix}:${node.local}` : node.local;
  out.push("<", tag);

  const childScope = new Map(scope);
  for (const d of node.ns) {
    if (d.uri) childScope.set(d.prefix, d.uri);
    else childScope.delete(d.prefix);
  }
  const decls: Array<{ prefix: string; uri: string }> = [];
  for (const d of node.ns) {
    if (d.prefix === "xml" && d.uri === XML_NS) continue; // implicit, never rendered
    const ancestorBinding = scope.get(d.prefix) ?? null; // null = no ancestor binds this prefix
    if (d.prefix === "") {
      // Default namespace node.
      if (d.uri !== "") {
        if (ancestorBinding !== d.uri) decls.push(d); // non-empty, not a redundant re-decl
      } else {
        // xmlns="" — emitted only to cancel a non-empty default namespace in the
        // immediate parent's canonical form (spec §3.3).
        const parentNonEmpty = parentInDefaultNs !== null && parentInDefaultNs !== "";
        if (parentNonEmpty) decls.push(d);
      }
    } else if (ancestorBinding !== d.uri) {
      decls.push(d); // prefixed, not a redundant re-declaration
    }
  }
  // C14N 1.1 (spec §3.3.4): namespace nodes are emitted in DOCUMENT ORDER —
  // the key difference from C14N 1.0, which sorted them. `node.ns` is already
  // in document order from the parser. On a plain UBL invoice the only
  // multi-namespace element is the root, whose declarations are already
  // alphabetical, so this is invisible to the invoice hash — but it is
  // decisive for the 8/9-namespace XAdES fragments, which the validator
  // canonicalises in document order too.
  // If a prefix is declared twice on the same element, the last declaration
  // wins (it is the one in scope for the element's content).
  const deduped: Array<{ prefix: string; uri: string }> = [];
  const seen = new Map<string, number>();
  for (const d of decls) {
    if (d.prefix === "xml") continue;
    const at = seen.get(d.prefix);
    if (at !== undefined) deduped[at] = d;
    else {
      seen.set(d.prefix, deduped.length);
      deduped.push(d);
    }
  }
  for (const d of deduped) {
    out.push(d.prefix ? ` xmlns:${d.prefix}="${escC14nAttr(d.uri)}"` : ` xmlns="${escC14nAttr(d.uri)}"`);
  }

  const sortedAttrs = [...node.attrs].sort((a, b) =>
    a.ns === b.ns ? a.local.localeCompare(b.local) : a.ns.localeCompare(b.ns),
  );
  for (const a of sortedAttrs) {
    const name = a.prefix ? `${a.prefix}:${a.local}` : a.local;
    out.push(` ${name}="${escC14nAttr(a.value)}"`);
  }
  out.push(">");
  const thisDefault = node.ns.find((d) => d.prefix === "")?.uri ?? null;
  for (const c of node.children) {
    if (typeof c === "string") out.push(escC14nText(c));
    else renderC14nNode(c, childScope, thisDefault, out);
  }
  out.push("</", tag, ">");
}

/**
 * True W3C C14N 1.1 canonicalisation with comments excluded — the form used
 * by ZATCA's invoice-hash transform and the C14N11 transforms inside the
 * XAdES signature.
 */
export function c14n11(xml: string): string {
  const root = parseC14nXml(xml);
  const out: string[] = [];
  renderC14nNode(root, new Map(), null, out);
  return out.join("");
}

/**
 * ZATCA invoice hash (Security Features Implementation Standards, step 1),
 * proven byte-exact against a live 200-CLEARED sandbox invoice:
 *
 *   1. drop the XML declaration
 *   2. drop the `ext:UBLExtensions` block (the whole first child)
 *   3. drop `cac:Signature`
 *   4. drop ONLY the QR `cac:AdditionalDocumentReference`
 *      (the ICV and PIH references STAY — the official SignedInfo XPath
 *      removes just `[cbc:ID='QR']`, and the accepted hash confirms it)
 *   5. canonicalise with C14N 1.1 (comments excluded)
 *   6. SHA-256, base64 of the RAW 32-byte digest
 */
export function computeInvoiceHash(xml: string): string {
  const unsigned = xml
    .replace(/^<\?xml[^>]*\?>/, "")
    .replace(/<ext:UBLExtensions>[\s\S]*?<\/ext:UBLExtensions>/, "")
    .replace(/<cac:Signature>[\s\S]*?<\/cac:Signature>/, "")
    .replace(
      /<cac:AdditionalDocumentReference>\s*<cbc:ID>QR<\/cbc:ID>[\s\S]*?<\/cac:AdditionalDocumentReference>/,
      "",
    );
  return sha256Base64(c14n11(unsigned));
}

/**
 * Namespace environment in scope at the signature fragments' position in the
 * document (the root's four UBL namespaces plus the three UBL signature
 * namespaces and xmldsig). Used to build the node-set canonical form the
 * validator computes over the referenced fragments (C14N 1.1 spec §2.1).
 */
export const NS_DOC =
  'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" ' +
  'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" ' +
  'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" ' +
  'xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2" ' +
  'xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2" ' +
  'xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" ' +
  'xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2"';

/**
 * The canonical byte string that the XAdES-B-B ECDSA signature covers:
 * C14N 1.1 over the SignedInfo element with the in-scope namespace nodes of
 * its position in the document (exactly what `signUnsignedInvoice` signs).
 */
export function signedInfoCanon(signedInfoXml: string): string {
  // Node-set canonical form of the SignedInfo element: the in-scope
  // namespace nodes at ITS position in the document (spec §2.1) are the 7
  // document namespaces plus `ds` (declared on the parent ds:Signature).
  // `xades` is NOT in scope there — it is declared later, on
  // xades:QualifyingProperties, a sibling AFTER the SignedInfo.
  // Works whether or not the SignedInfo element carries its own xmlns:ds
  // (the engine emits it without one, declared on ds:Signature, exactly like
  // the official sample).
  const SI_NS_SCOPE =
    NS_DOC + ' xmlns:ds="http://www.w3.org/2000/09/xmldsig#"';
  return c14n11(
    signedInfoXml.replace(/<ds:SignedInfo([^>]*)>/, `<ds:SignedInfo${"$1"} ${SI_NS_SCOPE}>`),
  );
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

/**
 * TLV with a RAW binary value (no UTF-8 text encoding). Used for QR tag 8,
 * which per the Security Features standard carries the public key as the raw
 * DER byte string (live-verified: 88 bytes `30 56 …` for a secp256k1 SPKI —
 * NOT its base64 text).
 */
export function tlsign(tag: number, raw: Buffer): Buffer {
  if (raw.length > 255) throw new Error(`QR field ${tag} exceeds 255 bytes`);
  return Buffer.concat([Buffer.from([tag, raw.length]), raw]);
}

export interface QrFields {
  sellerName: string;
  vatNumber: string;
  timestamp: string;
  totalWithVat: string | number;
  vatTotal: string | number;
  invoiceHash?: string;
  signature?: string;
  /** Raw SPKI DER bytes of the signing key (tag 8, binary TLV). */
  publicKeyDer?: Buffer | string;
  /**
   * Certificate's own ECDSA signature (tag 9, simplified only). Per the
   * Security Features Implementation Standards hex sample it is carried as
   * RAW DER bytes (30 46 02 21 00 …) — either a base64 of the raw ECDSA
   * signature value or a Buffer of DER bytes.
   */
  certificateSignature?: string | Buffer;
}

/**
 * QR modes (live-verified against the official 200-CLEARED sample and the
 * Security Features Implementation Standards hex sample):
 *  - "cleared"    (standard B2B): tags 1-8; tag 8 = raw SPKI DER. ZATCA
 *    re-stamps the QR from the returned XML at clearance.
 *  - "simplified" (B2C): tags 1-9; tag 9 = the cryptographic stamp
 *    (CSID/PCSID) certificate's own ECDSA signature as RAW DER bytes
 *    (30 46 02 21 00 … — NOT base64 text, per the guideline hex sample).
 */
export function buildQr(
  fields: QrFields,
  mode: "simplified" | "cleared",
): string {
  const parts = [
    tlv(1, fields.sellerName),
    tlv(2, fields.vatNumber),
    tlv(3, fields.timestamp),
    tlv(4, money(Number(fields.totalWithVat))),
    tlv(5, money(Number(fields.vatTotal))),
    tlv(6, fields.invoiceHash || ""),
    tlv(7, fields.signature || ""),
  ];
  const keyDer = fields.publicKeyDer
    ? Buffer.isBuffer(fields.publicKeyDer)
      ? fields.publicKeyDer
      : Buffer.from(String(fields.publicKeyDer), "base64")
    : Buffer.alloc(0);
  if (keyDer.length > 0) parts.push(tlsign(8, keyDer));
  if (mode === "simplified") {
    const certSigDer = fields.certificateSignature
      ? Buffer.isBuffer(fields.certificateSignature)
        ? fields.certificateSignature
        : Buffer.from(String(fields.certificateSignature), "base64")
      : Buffer.alloc(0);
    if (certSigDer.length > 0) parts.push(tlsign(9, certSigDer));
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
  // ZATCA's XML standard (BR-KSA-02/03, official samples and the live
  // validator) ALWAYS uses the `Invoice` root element for every document,
  // including credit (381) and debit (383) notes. The document kind is carried
  // by the InvoiceTypeCode value, never by a CreditNote/DebitNote root.
  const root = "Invoice";
  const typeCode = documentTypeCode(params.documentType);
  const typeName = invoiceTypeName(params.documentType, params.buyer);
  // ZATCA's live compliance validator enforces BR-KSA-EN16931-01: the business
  // process (BT-23) MUST be "reporting:1.0" for every document, B2B included
  // (there is no "clearance:1.0" in the EN 16931 profileID code list).
  const profile = "reporting:1.0";
  const paymentCode = /cash/i.test(String(params.paymentType || "")) ? "10" : "30";
  const supplyDate = params.supplyDate || params.issueDate;

  const lineXml = params.lines.map((line, i) => {
    const { net, rate, category, tax } = lineNet(line);
    return j([
      "<cac:InvoiceLine>",
      `<cbc:ID>${i + 1}</cbc:ID>`,
      `<cbc:InvoicedQuantity unitCode="${escapeXml(line.unitCode || "PCE")}">${Number(line.quantity) || 0}</cbc:InvoicedQuantity>`,
      `<cbc:LineExtensionAmount currencyID="${currency}">${money(net)}</cbc:LineExtensionAmount>`,
      // Line-level TaxTotal: KSA-11 (line VAT, BT: TaxAmount) and
      // KSA-12 (line amount with VAT, mapped to RoundingAmount by the
      // ZATCA XML Implementation Standard, BR-KSA-51/53). Element order per
      // UBL TaxTotalType: TaxAmount then RoundingAmount.
      `<cac:TaxTotal><cbc:TaxAmount currencyID="${currency}">${money(tax)}</cbc:TaxAmount><cbc:RoundingAmount currencyID="${currency}">${money(round2(net + tax))}</cbc:RoundingAmount></cac:TaxTotal>`,
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
    // Id="invoiceSignedData" is what the signature Reference Id points at —
    // mandatory in the official Phase 2 sample documents.
    `<${root} ${NS}>`,
    "<!--UBLEXTENSIONS-->",
    `<cbc:ProfileID>${profile}</cbc:ProfileID>`,
    `<cbc:ID>${escapeXml(params.invoiceNumber)}</cbc:ID>`,
    `<cbc:UUID>${escapeXml(params.uuid)}</cbc:UUID>`,
    `<cbc:IssueDate>${escapeXml(params.issueDate)}</cbc:IssueDate>`,
    `<cbc:IssueTime>${escapeXml(params.issueTime)}</cbc:IssueTime>`,
    // Notes (381/383) and invoices (388) all use cbc:InvoiceTypeCode on the
    // Invoice root — the subtype is in @name and the document type in value.
    `<cbc:InvoiceTypeCode name="${typeName}">${typeCode}</cbc:InvoiceTypeCode>`,
    `<cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>`,
    `<cbc:TaxCurrencyCode>${currency}</cbc:TaxCurrencyCode>`,
    // XSD InvoiceType order: cac:BillingReference precedes the
    // cac:AdditionalDocumentReference entries.
    billingReference,
    "<cac:AdditionalDocumentReference>",
    "<cbc:ID>ICV</cbc:ID>",
    `<cbc:UUID>${params.icv}</cbc:UUID>`,
    "</cac:AdditionalDocumentReference>",
    "<cac:AdditionalDocumentReference>",
    "<cbc:ID>PIH</cbc:ID>",
    `<cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${escapeXml(params.pih)}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment>`,
    "</cac:AdditionalDocumentReference>",
    // The finaliser (finalizeZatcaInvoice / sandbox script) replaces this
    // marker with the QR ADR — official order is ICV, PIH, QR — followed
    // by the cac:Signature block.
    "<!--QRANDSIGN-->",
    partyXml("AccountingSupplierParty", params.seller),
    partyXml(
      "AccountingCustomerParty",
      params.buyer || { name: "Walk-in Customer", nameAr: "عميل نقدي", countryCode: "SA" },
    ),
    `<cac:Delivery><cbc:ActualDeliveryDate>${escapeXml(supplyDate)}</cbc:ActualDeliveryDate></cac:Delivery>`,
    `<cac:PaymentMeans><cbc:PaymentMeansCode>${paymentCode}</cbc:PaymentMeansCode>${
      isNote && params.instructionNote
        ? // BR-KSA-17: credit/debit notes must carry the reason at
          // cac:PaymentMeans/cbc:InstructionNote (NOT at Invoice root).
          `<cbc:InstructionNote>${escapeXml(params.instructionNote)}</cbc:InstructionNote>`
        : ""
    }</cac:PaymentMeans>`,
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

/**
 * Extracts the certificate's own ECDSA signature (QR tag 9) as base64 of the
 * raw BIT STRING content. Takes the base64 body of the PEM certificate and
 * walks the DER tail directly, so it works without node-forge:
 *
 *   Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm,
 *                              signatureValue [ BIT STRING ] }
 */
function certificateSignature(certB64Body: string): string {
  try {
    const der = Buffer.from(certB64Body, "base64");
    let i = 0;
    const readLen = (buf: Buffer, pos: number): { len: number; next: number } => {
      const b = buf[pos];
      if (b < 0x80) return { len: b, next: pos + 1 };
      const n = b & 0x7f;
      let len = 0;
      for (let k = 0; k < n; k++) len = len * 256 + buf[pos + 1 + k];
      return { len, next: pos + 1 + n };
    };
    // outer SEQUENCE
    if (der[0] !== 0x30) return "";
    i = readLen(der, 1).next;
    // tbsCertificate SEQUENCE (length follows the tag byte)
    if (der[i] !== 0x30) return "";
    const tbs = readLen(der, i + 1);
    i = tbs.next + tbs.len;
    // signatureAlgorithm SEQUENCE (skip)
    if (der[i] !== 0x30) return "";
    const alg = readLen(der, i + 1);
    i = alg.next + alg.len;
    // signatureValue BIT STRING: 0x03 len <unusedBits> <content>
    // readLen().next is ABSOLUTE (start of the value), so no +i here.
    if (der[i] !== 0x03) return "";
    const bs = readLen(der, i + 1);
    const unused = der[bs.next];
    const content = der.slice(bs.next + 1, bs.next + bs.len);
    if (unused !== 0 || content.length === 0) return "";
    return content.toString("base64");
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
    // The CSID/PCSID certificate arrives as PEM. certDigest is ZATCA's
    // XAdES CertDigest: base64( SHA-256( the base64 BODY of the PEM ) ) —
    // proven against the official 200-CLEARED sample's embedded digest.
    const body = certificate.replace(/-----[^-]+-----|\s/g, "");
    certDigest = Buffer.from(createHash("sha256").update(body).digest("hex")).toString("base64");
    certSignature = certificateSignature(body);
    try {
      const cert = new X509Certificate(certificate);
      // Node's X509Certificate.issuer returns the RDNs space-separated
      // ("CN=eInvoicing DC=gov"); tighten spacing around '=' and join the
      // RDNs with ", " so the value matches the comma-separated DistinguishedName
      // form ZATCA expects in <ds:X509IssuerName>.
      issuer = String(cert.issuer || "")
        .replace(/\s*=\s*/g, "=")
        .replace(/,?\s+(?=[A-Za-z][A-Za-z0-9-]*=)/g, ", ");
      // serialNumber is a HEX string (e.g. "01a1f55dcff8"), but the XSD
      // X509SerialNumber is xs:integer — the live validator rejects hex
      // letters with "not a valid value for 'integer'". Convert to decimal.
      serial = BigInt("0x" + String(cert.serialNumber || "").replace(/^0x/i, "")).toString(10);
    } catch {
      /* issuer/serial are cosmetic in XAdES; digest + signature are the legal bits */
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

  // XAdES-B-B SignedProperties. The layout below is byte-for-byte the one the
  // ZATCA validator re-serialises the element into before hashing it
  // (36/40/44/48/52-space child indentation) — verified against two
  // independent ZATCA-emitted 200-CLEARED documents. The element carries NO
  // namespace declarations of its own in the document: `xades` is inherited
  // from xades:QualifyingProperties and `ds` from ds:Signature.
  const signedProperties =
    '<xades:SignedProperties Id="xadesSignedProperties">\n' +
    "                                    <xades:SignedSignatureProperties>\n" +
    `                                        <xades:SigningTime>${escapeXml(params.signingTime)}</xades:SigningTime>\n` +
    "                                        <xades:SigningCertificate>\n" +
    "                                            <xades:Cert>\n" +
    "                                                <xades:CertDigest>\n" +
    '                                                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>\n' +
    `                                                    <ds:DigestValue>${params.material.certDigest}</ds:DigestValue>\n` +
    "                                                </xades:CertDigest>\n" +
    "                                                <xades:IssuerSerial>\n" +
    `                                                    <ds:X509IssuerName>${escapeXml(params.material.issuer || "CN=eInvoicing")}</ds:X509IssuerName>\n` +
    `                                                    <ds:X509SerialNumber>${escapeXml(params.material.serial || "0")}</ds:X509SerialNumber>\n` +
    "                                                </xades:IssuerSerial>\n" +
    "                                            </xades:Cert>\n" +
    "                                        </xades:SigningCertificate>\n" +
    "                                    </xades:SignedSignatureProperties>\n" +
    "                                </xades:SignedProperties>";

  // The SignedProperties digest is NOT a canonicalisation. ZATCA takes the
  // element, re-serialises it into the template layout above, injects
  // `xmlns:xades` on the element and `xmlns:ds` on all four ds children,
  // then hashes the raw UTF-8 bytes. Reproduced byte-exact against both live
  // ZATCA-emitted documents. Stored as base64 OF THE HEX STRING, like the
  // certificate digest (e.g. "ZDMwMmI0..." = b64("d302b4...")).
  const DS_NS = 'xmlns:ds="http://www.w3.org/2000/09/xmldsig#"';
  const signedPropertiesHashed = signedProperties
    .replace(
      "<xades:SignedProperties ",
      '<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" ',
    )
    .replace(/<ds:DigestMethod /g, `<ds:DigestMethod ${DS_NS} `)
    .replace(/<ds:DigestValue>/g, `<ds:DigestValue ${DS_NS}>`)
    .replace(/<ds:X509IssuerName>/g, `<ds:X509IssuerName ${DS_NS}>`)
    .replace(/<ds:X509SerialNumber>/g, `<ds:X509SerialNumber ${DS_NS}>`);
  const signedPropertiesDigest = Buffer.from(
    createHash("sha256").update(signedPropertiesHashed, "utf8").digest("hex"),
  ).toString("base64");

  const signedInfo = j([
    "<ds:SignedInfo>",
    '<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>',
    '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/>',
    '<ds:Reference Id="invoiceSignedData" URI="">',
    "<ds:Transforms>",
    // The three XPath transforms remove the extension block, cac:Signature
    // and ONLY the QR reference — exactly what computeInvoiceHash() does.
    '<ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(/ancestor-or-self::ext:UBLExtensions)</ds:XPath></ds:Transform>',
    '<ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(/ancestor-or-self::cac:Signature)</ds:XPath></ds:Transform>',
    '<ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(/ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID=\'QR\'])</ds:XPath></ds:Transform>',
    '<ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>',
    "</ds:Transforms>",
    '<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>',
    `<ds:DigestValue>${params.invoiceHash}</ds:DigestValue>`,
    "</ds:Reference>",
    '<ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties">',
    '<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>',
    `<ds:DigestValue>${signedPropertiesDigest}</ds:DigestValue>`,
    "</ds:Reference>",
    "</ds:SignedInfo>",
  ]);

  // Sign the node-set canonical form of SignedInfo (same as the validator:
  // resolve #id, take the element + in-scope namespace nodes, C14N 1.1).
  const signature = createSign("sha256")
    .update(signedInfoCanon(signedInfo))
    .sign(params.material.privateKey, "base64");

  const extensionXml = j([
    "<ext:UBLExtensions><ext:UBLExtension>",
    "<ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>",
    "<ext:ExtensionContent>",
    `<sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2" xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2">`,
    "<sac:SignatureInformation>",
    "<cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>",
    "<sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>",
    '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="signature">',
    signedInfo,
    `<ds:SignatureValue>${signature}</ds:SignatureValue>`,
    certBase64
      ? `<ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certBase64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>`
      : "",
    "<ds:Object>",
    '<xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="signature">',
    signedProperties,
    "</xades:QualifyingProperties>",
    "</ds:Object>",
    "</ds:Signature>",
    "</sac:SignatureInformation>",
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

  // Hash is computed BEFORE any signature/QR is embedded — the exact
  // ZATCA algorithm (decl + UBLExtensions + cac:Signature + QR-ADR removed,
  // then C14N 1.1, SHA-256, base64 of the raw digest).
  const invoiceHash = computeInvoiceHash(unsignedXml);

  const material = await loadSigningMaterial(params.tenantId, params.environment || "sandbox");
  // Plain local timestamp, no offset — the ZATCA validator rejects the
  // `+03:00` form (certificate-signing-time-format).
  const signingTime = `${issueDate}T${issueTime}`;
  // QR tag 3 uses a UTC timestamp without offset (official samples: 2021-05-12T05:09:01Z).
  const qrTimestamp = new Date(signingTime).toISOString().replace(/\.\d{3}Z$/, "Z");
  const signed = signUnsignedInvoice({ invoiceHash, signingTime, material });

  // B2B (0100000): tags 1-8 (tag 8 = raw SPKI DER); ZATCA re-stamps the QR
  // from the returned cleared XML afterwards.
  // B2C (0200000, incl. simplified notes): full 9 tags; tag 9 = the CSID
  // stamp's own certificate signature.
  const qrMode = invoiceTypeName(params.documentType, params.buyer) === "0200000" ? "simplified" : "cleared";
  const qr = buildQr(
    {
      sellerName: params.seller.nameAr || params.seller.name || "",
      vatNumber: params.seller.vatNumber || "",
      timestamp: qrTimestamp,
      totalWithVat: totals.taxInclusiveAmount,
      vatTotal: totals.taxAmount,
      invoiceHash,
      signature: signed.signature,
      publicKeyDer: createPublicKey(material.publicKey || material.privateKey)
        .export({ type: "spki", format: "der" })
        .toString("base64"),
      certificateSignature: material.certSignature,
    },
    qrMode,
  );

  const withExtensions = unsignedXml.replace("<!--UBLEXTENSIONS-->", signed.extensionXml);
  // QR ADR + cac:Signature go after the ICV/PIH references, before the
  // parties (XSD InvoiceType order 31 → 33; official cleared layout).
  const qrAndSignature =
    j([
      "<cac:AdditionalDocumentReference>",
      "<cbc:ID>QR</cbc:ID>",
      `<cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${escapeXml(qr)}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment>`,
      "</cac:AdditionalDocumentReference>",
    ]) +
    "<cac:Signature><cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID><cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod></cac:Signature>";
  const signedXml = withExtensions.replace("<!--QRANDSIGN-->", qrAndSignature);

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
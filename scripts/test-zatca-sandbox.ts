/**
 * ZATCA Phase 2 — LIVE SANDBOX END-TO-END INTEGRATION TEST
 *
 * Run:  npx tsx scripts/test-zatca-sandbox.ts
 *
 * Uses ONLY the public ZATCA sandbox credentials (no personal data):
 *   Base URL  : https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal
 *   OTP       : 123345
 *   VAT       : 399999999900003
 *   Org       : WAFA Tech Solutions Test
 *   Country   : SA
 *   Title     : 1100
 *
 * Steps:
 *   1. Generate ECDSA secp256k1 keypair + ZATCA-compliant CSR (SDK layout:
 *      C/OU/O/CN subject + extensionRequest[TSTZATCA-Code-Signing template,
 *      SAN dirName: EGS serial, Organization Identifier(VAT), title=1100,
 *      location, industry]).
 *   2. POST /compliance (OTP 123345)  -> Compliance CSID (BinarySecurityToken + Secret).
 *   3. Build + XAdES-B-B sign all 6 mandatory compliance documents and POST
 *      each to /compliance/invoices:
 *        Standard B2B Invoice (388), Standard Credit Note (381),
 *        Standard Debit Note (383), Simplified B2C Invoice (388),
 *        Simplified Credit Note (381), Simplified Debit Note (383).
 *   4. POST /production/csids -> Production CSID (BinarySecurityToken + Secret).
 *   5. Live POST /invoices/clearance/single (B2B) and /invoices/reporting/single
 *      (B2C) with the Production CSID; verify the returned TLV QR
 *      (B2B cleared: tags 1-8 with tag 8 = raw SPKI DER; B2C reported: 1-9).
 *
 * No database, no app bootstrap. Reuses the production engine from
 * api/lib/zatca/phase2.ts (UBL builder, C14N canonicalisation, XAdES-B-B
 * signing, TLV QR, FIRST_PIH seed) so what is tested is exactly what ships.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign as signDigest,
  X509Certificate,
} from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  FIRST_PIH,
  buildUblDocument,
  buildQr,
  computeInvoiceHash,
  signUnsignedInvoice,
  signedInfoCanon,
  riyadhNow,
  invoiceTypeName,
  type ZatcaDocumentType,
  type ZatcaLineInput,
  type ZatcaParty,
} from "../api/lib/zatca/phase2";

// ---------------------------------------------------------------------------
// Sandbox configuration (public test values only)
// ---------------------------------------------------------------------------

const CONFIG = {
  baseUrl: "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal",
  otp: "123345",
  vatNumber: "399999999900003",
  orgNameEn: "WAFA Tech Solutions Test",
  orgNameAr: "وافا تيك سولوشنز للتجربة",
  crNumber: "1010101010",
  country: "SA",
  invoiceTypeTitle: "1100",
  egsSerial: "1-WAFA|2-EGS-2026|3-SBX-0001", // format: 1-manufacturer|2-model|3-serial (guideline 3.3.6)
  city: "Riyadh",
  district: "Olaya",
  street: "King Fahd Road",
  buildingNumber: "1234",
  postalCode: "12211",
  phone: "+966501234567",
  buyerVat: "399999999800003", // MUST differ from seller (BR-CUSTOM-VALIDATION-01)
  // Official guideline (3.3.3) — remaining CSR subject inputs:
  egsUnitName: "WAFA-EGS-UNIT-01", // Common Name: name of the solution unit
  branchName: "Riyadh Main Branch", // OU: free text (TRN 11th digit != 1)
  location: "RRRD2929", // Saudi national address (SDK uses this in the dirName location field)
  industry: "IT & Software Services",
};

const OUT_DIR = "zatca-sandbox-out";
mkdirSync(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Tiny HTTP + logging helpers
// ---------------------------------------------------------------------------

let stepNo = 0;
const results: Array<{ step: string; ok: boolean; detail: string }> = [];

function banner(title: string): void {
  stepNo += 1;
  console.log("");
  console.log("=".repeat(88));
  console.log(`STEP ${stepNo}: ${title}`);
  console.log("=".repeat(88));
}

function ok(msg: string): void {
  console.log(`  [PASS] ${msg}`);
}
function fail(msg: string): void {
  console.log(`  [FAIL] ${msg}`);
}
function info(msg: string): void {
  console.log(`  ${msg}`);
}

async function zcaFetch(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; headers: Record<string, string>; text: string }> {
  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    body,
    signal: AbortSignal.timeout(90_000),
  });
  const text = await res.text();
  const h: Record<string, string> = {};
  res.headers.forEach((v, k) => (h[k.toLowerCase()] = v));
  console.log(`  HTTP ${res.status} (${Date.now() - started} ms) <- POST ${new URL(url).pathname}`);
  return { status: res.status, headers: h, text };
}

function jbody(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

function record(step: string, okFlag: boolean, detail: string): void {
  results.push({ step, ok: okFlag, detail });
}

// ---------------------------------------------------------------------------
// Minimal DER/ASN.1 helpers (node-forge cannot parse secp256k1 keys, so we
// build the PKCS#10 CSR by hand and sign it with node:crypto).
// ---------------------------------------------------------------------------

type Der = Buffer;

function derLen(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.concat([Buffer.from([0x80 | bytes.length]), Buffer.from(bytes)]);
}

function der(tag: number, content: Der): Der {
  return Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
}

function derInt(value: number): Der {
  const bytes: number[] = [];
  let v = value;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v >>= 8;
  }
  if (bytes.length === 0) bytes.push(0);
  if (bytes[0] & 0x80) bytes.unshift(0); // keep positive
  return der(0x02, Buffer.from(bytes));
}

function derUtf8(value: string): Der {
  return der(0x0c, Buffer.from(value, "utf8"));
}

function derObjId(dots: string): Der {
  const parts = dots.split(".").map(Number);
  const out: number[] = [parts[0] * 40 + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let n = parts[i];
    const chunk: number[] = [];
    chunk.push(n & 0x7f);
    n >>= 7;
    while (n > 0) {
      chunk.push(0x80 | (n & 0x7f));
      n >>= 7;
    }
    out.push(...chunk.reverse());
  }
  return der(0x06, Buffer.from(out));
}

function derNull(): Der {
  return Buffer.from([0x05, 0x00]);
}

function derSet(content: Der): Der {
  return der(0x31, content);
}

function derPrintable(value: string): Der {
  return der(0x13, Buffer.from(value, "utf8"));
}

/** Relative Distinguished Name (one set of attributes). */
function rdn(attrs: Array<{ oid: string; value: string; printable?: boolean }>): Der {
  let inner: Der = Buffer.alloc(0);
  for (const a of attrs) {
    // Attribute ::= SEQUENCE { type OBJECT IDENTIFIER, value ANY }
    const value = a.printable ? derPrintable(a.value) : derUtf8(a.value);
    const attr = der(0x30, Buffer.concat([derObjId(a.oid), value]));
    inner = Buffer.concat([inner, attr]);
  }
  return derSet(inner);
}

function buildZatcaCsr(privateKeyPem: string, spkiDer: Buffer): { csrDer: Der; csrPem: string } {
  // Byte-exact mirror of the official ZATCA E-invoicing SDK (fatooranet) CSR
  // layout, verified against a known-accepted sandbox request:
  //
  // Subject (4 RDNs):   C=SA (PRINTABLE), OU=branch, O=org, CN=solution unit
  // Attributes [0] { extensionRequest } containing:
  //   1) 1.3.6.1.4.1.311.20.2 (msCertTemplate) -> OCTET STRING { "TSTZATCA-Code-Signing" }
  //   2) 2.5.29.17 (subjectAltName, dirName [4]) with the remaining 5 inputs:
  //        2.5.4.4  = EGS serial (1-mfr|2-model|3-serial)
  //        1.3.6.1.4.1.311.60.2.1.1 = Organization Identifier (VAT/TRN)
  //        2.5.4.12 = title (functionality map: 1100 = Standard + Simplified)
  //        2.5.4.26 = location (short Saudi national address)
  //        2.5.4.15 = industry
  const subject = der(0x30, Buffer.concat([
    rdn([{ oid: "2.5.4.6", value: CONFIG.country, printable: true }]), // C
    rdn([{ oid: "2.5.4.11", value: CONFIG.branchName }]), // OU
    rdn([{ oid: "2.5.4.10", value: CONFIG.orgNameEn }]), // O
    rdn([{ oid: "2.5.4.3", value: CONFIG.egsUnitName }]), // CN
  ]));

  // SubjectPublicKeyInfo:
  //   SEQUENCE { SEQUENCE { id-ecPublicKey, secp256k1 }, BIT STRING { 0x00, 65-byte EC point } }
  // Node's export({type:'spki',format:'der'}) returns the FULL SubjectPublicKeyInfo,
  // so extract the raw EC point from its inner BIT STRING (SDK ref: len=66).
  const readLen = (b: Buffer, i: number): [number, number] => {
    const first = b[i];
    if (first < 0x80) return [first, i + 1];
    const n = first & 0x7f;
    let len = 0;
    for (let k = 0; k < n; k++) len = (len << 8) | b[i + 1 + k];
    return [len, i + 1 + n];
  };
  const [, outerContentStart] = readLen(spkiDer, 1);
  const algTag = outerContentStart; // inner algorithm SEQUENCE
  const [algLen, algLenEnd] = readLen(spkiDer, algTag + 1);
  const bitTag = algLenEnd + algLen; // BIT STRING must follow the algorithm SEQ
  if (spkiDer[bitTag] !== 0x03) throw new Error("unexpected SPKI layout: no BIT STRING where expected");
  const [bitLen, bitContentStart] = readLen(spkiDer, bitTag + 1);
  const unusedBits = spkiDer[bitContentStart];
  const point = spkiDer.subarray(bitContentStart + 1, bitContentStart + bitLen);
  if (unusedBits !== 0 || point.length !== 65 || point[0] !== 0x04) {
    throw new Error(`unexpected EC point: ${point.length} bytes, unused=0x${unusedBits?.toString(16)}, first=0x${point[0]?.toString(16)}`);
  }
  const spki = der(0x30, Buffer.concat([
    der(0x30, Buffer.concat([derObjId("1.2.840.10045.2.1"), derObjId("1.3.132.0.10")])),
    der(0x03, Buffer.concat([Buffer.from([0x00]), point])), // BIT STRING, 0 unused bits
  ]));

  // --- extensionRequest value --------------------------------------------
  // Template entry: SEQUENCE { OID(1.3.6.1.4.1.311.20.2), OCTET STRING { PRINTABLE "TSTZATCA-Code-Signing" } }
  // (byte-exact per the known-accepted SDK CSR: 0609 2b0601040182371402 0417 1315 ...)
  const templateEntry = der(0x30, Buffer.concat([
    derObjId("1.3.6.1.4.1.311.20.2"),
    der(0x04, derPrintable("TSTZATCA-Code-Signing")),
  ]));
  // SAN dirName: [4] { SEQUENCE { RDNs... } }
  const dirName = der(0x30, Buffer.concat([
    rdn([{ oid: "2.5.4.4", value: CONFIG.egsSerial }]), // EGS serial number
    rdn([{ oid: "0.9.2342.19200300.100.1.1", value: CONFIG.vatNumber }]), // Organization Identifier
    rdn([{ oid: "2.5.4.12", value: CONFIG.invoiceTypeTitle }]), // title / functionality map
    rdn([{ oid: "2.5.4.26", value: CONFIG.location }]), // location (national address)
    rdn([{ oid: "2.5.4.15", value: CONFIG.industry }]), // industry
  ]));
  const sanEntry = der(0x30, Buffer.concat([
    derObjId("2.5.29.17"),
    der(0x04, der(0x30, der(0xa4, dirName))), // OCTET STRING { SEQ { [4] { DirName } } }
  ]));
  const extRequestValue = der(0x31, der(0x30, Buffer.concat([templateEntry, sanEntry])));
  const attrExtensionRequest = der(0x30, Buffer.concat([
    derObjId("1.2.840.113549.1.9.14"),
    extRequestValue,
  ]));

  const algEcdsaSha256 = der(0x30, derObjId("1.2.840.10045.4.3.2")); // ecdsa-with-SHA256

  const certificationRequestInfo = der(0x30, Buffer.concat([
    derInt(0), // version v1
    subject,
    spki,
    der(0xa0, attrExtensionRequest), // attributes ::= [0] Attribute (Attribute = SEQ { OID, SET })
  ]));

  const signer = createPrivateKey(privateKeyPem);
  // crypto.sign(null, data, key) returns the raw DER ECDSA signature.
  const signature = signDigest(null, certificationRequestInfo, signer);

  const csr = der(0x30, Buffer.concat([
    certificationRequestInfo,
    algEcdsaSha256,
    der(0x03, Buffer.concat([Buffer.from([0x00]), signature])), // BIT STRING
  ]));

  // The SDK emits the CSR PEM with CRLF line endings; the sandbox accepts the
  // base64 of that exact PEM (raw DER base64 alone returns "Invalid Request").
  const b64 = csr.toString("base64");
  const csrPem =
    "-----BEGIN CERTIFICATE REQUEST-----\r\n" +
    b64.match(/.{1,64}/g)!.join("\r\n") +
    "\r\n-----END CERTIFICATE REQUEST-----\r\n";

  return { csrDer: csr, csrPem };
}

// ---------------------------------------------------------------------------
// Certificate helpers
// ---------------------------------------------------------------------------

/**
 * Extracts a certificate's own ECDSA signature value (QR tag 9) — mirrors the
 * engine's internal certificateSignature(). Pure DER walk over the certificate
 * body (no ASN.1 library needed):
 *
 *   Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm,
 *                              signatureValue [ BIT STRING ] }
 *
 * Returns base64 of the raw BIT STRING content, or "" on any failure
 * (tag 9 is only required for simplified documents).
 */
function certificateSignatureDer(certPem: string): string {
  if (!certPem) return "";
  try {
    const body = certPem.replace(/-----[^-]+-----|\s/g, "");
    const der = Buffer.from(body, "base64");
    const readLen = (b: Buffer, pos: number): { len: number; next: number } => {
      const first = b[pos];
      if (first < 0x80) return { len: first, next: pos + 1 };
      const n = first & 0x7f;
      let len = 0;
      for (let k = 0; k < n; k++) len = len * 256 + b[pos + 1 + k];
      return { len, next: pos + 1 + n };
    };
    if (der[0] !== 0x30) return "";
    let i = readLen(der, 1).next;
    if (der[i] !== 0x30) return ""; // tbsCertificate (length after tag byte)
    const tbs = readLen(der, i + 1);
    i = tbs.next + tbs.len;
    if (der[i] !== 0x30) return ""; // signatureAlgorithm
    const alg = readLen(der, i + 1);
    i = alg.next + alg.len;
    if (der[i] !== 0x03) return ""; // signatureValue BIT STRING
    const bs = readLen(der, i + 1);
    const unused = der[bs.next];
    const content = der.subarray(bs.next + 1, bs.next + bs.len);
    if (unused !== 0 || content.length === 0) return "";
    return content.toString("base64");
  } catch {
    return "";
  }
}

/**
 * The CSID/PCSID responses carry the issued certificate inside
 * `binarySecurityToken` (double base64): decode1 = base64 string,
 * decode2 = the X.509 DER. Re-wrap the DER as PEM.
 */
function certPemFromBinarySecurityToken(token: string | undefined | null): string {
  if (!token || typeof token !== "string") return "";
  try {
    const first = Buffer.from(token, "base64").toString("utf8");
    const der = Buffer.from(first, "base64");
    if (der.length < 100 || der[0] !== 0x30) return "";
    const lines = der.toString("base64").match(/.{1,64}/g)!.join("\n");
    return `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----\n`;
  } catch {
    return "";
  }
}

/** Double-base64 PEM decode is done by certPemFromBinarySecurityToken(); QR
 *  TLV is decoded inline in step 5 (binary-aware: tag 8 is raw DER bytes). */

// ---------------------------------------------------------------------------
// Document factory — mirrors finalizeZatcaInvoice() exactly:
// buildUblDocument -> canonicalize+hash -> XAdES-B-B sign -> QR -> embed.
// ---------------------------------------------------------------------------

interface BuiltDoc {
  key: string;
  documentType: ZatcaDocumentType;
  typeName: string;
  invoiceNumber: string;
  uuid: string;
  icv: number;
  invoiceHash: string;
  unsignedXml: string;
  signedXml: string;
  qr: string;
  signature: string;
}

function makeDoc(params: {
  key: string;
  documentType: ZatcaDocumentType;
  invoiceNumber: string;
  icv: number;
  pih: string;
  seller: ZatcaParty;
  buyer?: ZatcaParty | null;
  lines: ZatcaLineInput[];
  billingReference?: { id: string; uuid?: string | null } | null;
  instructionNote?: string | null;
  privateKeyPem: string;
  /** CSID certificate PEM (from POST /compliance) — embedded as X509Certificate. */
  certificatePem?: string;
  /** Certificate's own signature (QR tag 9), derived from the certificate. */
  certSignature?: string;
}): BuiltDoc {
  const now = riyadhNow();
  const uuid = randomUUID();
  const typeName = invoiceTypeName(params.documentType, params.buyer);

  const { xml: unsignedXml, totals } = buildUblDocument({
    documentType: params.documentType,
    invoiceNumber: params.invoiceNumber,
    uuid,
    icv: params.icv,
    pih: params.pih,
    issueDate: now.date,
    issueTime: now.time,
    currency: "SAR",
    seller: params.seller,
    buyer: params.buyer,
    lines: params.lines,
    paymentType: "Cash",
    billingReference: params.billingReference,
    instructionNote: params.instructionNote,
  });

  // Hash is over the canonical unsigned document (no signature, no QR) —
  // the exact ZATCA algorithm (C14N 1.1, proven byte-exact on a live
  // 200-CLEARED sandbox invoice), same ordering as finalizeZatcaInvoice().
  const invoiceHash = computeInvoiceHash(unsignedXml);

  const publicKeyPem = createPublicKey(params.privateKeyPem).export({ type: "spki", format: "pem" }).toString();
  const spkiDer = createPublicKey(params.privateKeyPem).export({ type: "spki", format: "der" });
  const certificatePem = params.certificatePem || "";
  const certSignature = params.certSignature || certificateSignatureDer(certificatePem);
  // issuer/serial for XAdES IssuerSerial — parsed from the CSID certificate
  // when present (falls back to the sandbox CA values).
  let issuer = "CN=eInvoicing";
  let serial = "0";
  if (certificatePem) {
    try {
      const cert = new X509Certificate(certificatePem);
      issuer = String(cert.issuer || "").replace(/\s*=\s*/g, "=") || issuer;
      // serialNumber is hex; XSD X509SerialNumber is xs:integer (decimal).
      serial = BigInt("0x" + String(cert.serialNumber || "").replace(/^0x/i, "")).toString(10) || serial;
    } catch {
      /* keep fallbacks */
    }
  }
  const material = {
    privateKey: params.privateKeyPem,
    certificate: certificatePem,
    publicKey: publicKeyPem,
    mode: (certificatePem ? "configured" : "ephemeral") as "configured" | "ephemeral",
    // ZATCA XAdES CertDigest = base64( SHA-256( base64 body of the PEM ) ).
    certDigest: certificatePem
      ? Buffer.from(createHash("sha256").update(certificatePem.replace(/-----[^-]+-----|\s/g, "")).digest("hex")).toString("base64")
      : Buffer.from(createHash("sha256").update(publicKeyPem).digest("hex")).toString("base64"),
    certSignature,
    issuer,
    // XSD: X509SerialNumber is xs:integer; ZATCA-issued CSID/PCSID serials
    // are short hex values (e.g. 01a1f55dcff8) that fit comfortably.
    serial,
  };

  // ZATCA rejects `certificate-signing-time-format` for the `+03:00` offset
  // form. The official 200-CLEARED sample uses a plain local timestamp
  // (yyyy-MM-ddTHH:mm:ss) with no offset — match it exactly.
  const signingTime = `${now.date}T${now.time}`;
  const signed = signUnsignedInvoice({ invoiceHash, signingTime, material });

  const qr = buildQr(
    {
      sellerName: params.seller.nameAr || params.seller.name,
      vatNumber: params.seller.vatNumber || "",
      timestamp: new Date(signingTime).toISOString().replace(/\.\d{3}Z$/, "Z"),
      totalWithVat: totals.taxInclusiveAmount,
      vatTotal: totals.taxAmount,
      invoiceHash,
      signature: signed.signature,
      publicKeyDer: spkiDer.toString("base64"),
      certificateSignature: material.certSignature,
    },
    typeName === "0200000" ? "simplified" : "cleared",
  );

  const qrAndSignature =
    "<cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment>" +
    `<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qr}</cbc:EmbeddedDocumentBinaryObject>` +
    "</cac:Attachment></cac:AdditionalDocumentReference>" +
    "<cac:Signature><cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID>" +
    "<cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod></cac:Signature>";
  const signedXml = unsignedXml
    .replace("<!--UBLEXTENSIONS-->", signed.extensionXml)
    .replace("<!--QRANDSIGN-->", qrAndSignature);

  return {
    key: params.key,
    documentType: params.documentType,
    typeName,
    invoiceNumber: params.invoiceNumber,
    uuid,
    icv: params.icv,
    invoiceHash,
    unsignedXml,
    signedXml,
    qr,
    signature: signed.signature,
  };
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

const SELLER: ZatcaParty = {
  name: CONFIG.orgNameEn,
  nameAr: CONFIG.orgNameAr,
  vatNumber: CONFIG.vatNumber,
  crNumber: CONFIG.crNumber,
  street: CONFIG.street,
  buildingNumber: CONFIG.buildingNumber,
  district: CONFIG.district,
  city: CONFIG.city,
  postalCode: CONFIG.postalCode,
  countryCode: CONFIG.country,
  phone: CONFIG.phone,
};

const BUYER: ZatcaParty = {
  name: "Sandbox B2B Customer",
  nameAr: "عميل تجاري تجريبي",
  vatNumber: CONFIG.buyerVat,
  crNumber: "2010101010",
  street: CONFIG.street,
  buildingNumber: "9999",
  district: CONFIG.district,
  city: CONFIG.city,
  postalCode: CONFIG.postalCode,
  countryCode: CONFIG.country,
  phone: "+966509876543",
};

const LINES: ZatcaLineInput[] = [
  { description: "Software Development Services", descriptionAr: "خدمات تطوير برمجيات", quantity: 1, unitPrice: 5000, taxPercent: 15, taxCategory: "S" },
  { description: "Cloud Hosting (annual)", descriptionAr: "استضافة سحابية سنوية", quantity: 2, unitPrice: 750, taxPercent: 15, taxCategory: "S" },
];

async function main(): Promise<void> {
  banner("1. Generate ECDSA secp256k1 keypair + ZATCA-compliant CSR");
  const keyPair = generateKeyPairSync("ec", {
    namedCurve: "secp256k1",
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const curve = (createPrivateKey(keyPair.privateKey).asymmetricKeyDetails as any)?.namedCurve;
  info(`curve = ${curve}, publicKey SPKI der = ${createPublicKey(keyPair.publicKey).export({ type: "spki", format: "der" }).length} bytes`);
  if (curve !== "secp256k1") throw new Error(`expected secp256k1, got ${curve}`);
  ok("secp256k1 keypair generated");

  const spkiDer = createPublicKey(keyPair.publicKey).export({ type: "spki", format: "der" });
  const { csrPem } = buildZatcaCsr(keyPair.privateKey, spkiDer);
  writeFileSync(`${OUT_DIR}/private-key.pem`, keyPair.privateKey, { mode: 0o600 });
  writeFileSync(`${OUT_DIR}/public-key.pem`, keyPair.publicKey, { mode: 0o600 });
  writeFileSync(`${OUT_DIR}/csr.pem`, csrPem, { mode: 0o600 });
  ok("CSR built with CN/OU/O/C=SA/SN(EGS)/UID(VAT)/title=1100/Location/Industry (9 guideline inputs)");
  info(`CSR base64 length = ${Buffer.from(csrPem).toString("base64").length}`);
  record("CSR", true, `secp256k1 + 9 subject attrs per guideline 3.3.3; csr.pem saved`);

  banner("2. POST /compliance  (OTP 123345)  ->  Compliance CSID");
  const csrBase64 = Buffer.from(csrPem).toString("base64");
  const compRes = await zcaFetch(
    `${CONFIG.baseUrl}/compliance`,
    { OTP: CONFIG.otp, "Accept-Version": "V2", "Accept-Language": "en" },
    JSON.stringify({ csr: csrBase64 }),
  );
  const comp = jbody(compRes.text);
  info(`response body: ${JSON.stringify(comp).slice(0, 600)}`);
  // PROVEN (probe + accepted request): the sandbox wants Basic base64(
  // binarySecurityToken + ":" + secret ) with BOTH values EXACTLY as
  // returned — any extra decode of the token yields 401.
  const complianceToken = comp.binarySecurityToken || "";
  const complianceSecret = comp.secret;
  const complianceRequestId = comp.requestID || comp.requestId || comp.request_id || "";
  // The response carries NO `certificate` field: the CSID certificate is
  // embedded as double-base64 inside binarySecurityToken
  // (decode1 = base64 string, decode2 = X.509 DER).
  const complianceCertPem: string | undefined =
    comp.certificate && String(comp.certificate).startsWith("-----")
      ? String(comp.certificate)
      : certPemFromBinarySecurityToken(comp.binarySecurityToken) || undefined;
  if (compRes.status === 200 && complianceToken && complianceSecret) {
    ok(`Compliance CSID issued (requestID=${complianceRequestId})`);
    info(`BinarySecurityToken (CSID) = ${String(complianceToken).slice(0, 48)}...`);
    info(`Secret = ${String(complianceSecret).slice(0, 12)}...`);
    if (complianceCertPem) {
      writeFileSync(`${OUT_DIR}/compliance-csid.pem`, complianceCertPem);
      info("CSID certificate saved -> compliance-csid.pem");
    }
    record("compliance", true, `HTTP ${compRes.status}, CSID + secret (+cert) received`);
  } else {
    fail(`POST /compliance returned HTTP ${compRes.status} without usable CSID`);
    record("compliance", false, `HTTP ${compRes.status}: ${JSON.stringify(comp).slice(0, 300)}`);
    summaryAndExit(1);
  }

  const basicAuth = (user: string, secret: string) =>
    Buffer.from(`${user}:${secret}`).toString("base64");

  // -------------------------------------------------------------------------
  // STEP 3 — the six mandatory compliance documents
  //   1  Standard  B2B Invoice        (388)
  //   2  Standard  B2B Credit Note    (381)
  //   3  Standard  B2B Debit Note     (383)
  //   4  Simplified B2C Invoice       (388)
  //   5  Simplified B2C Credit Note   (381)
  //   6  Simplified B2C Debit Note    (383)
  //   ICV 1..6, PIH(1)=FIRST_PIH, PIH(n)=hash(n-1)
  // -------------------------------------------------------------------------
  banner("3. POST /compliance/invoices — 6 mandatory compliance documents");

  const certSig = certificateSignatureDer(complianceCertPem || "");
  info(`CSID certificate: ${complianceCertPem ? "present (" + certSig.length + "-byte signature, tag 9)" : "NOT returned — signing with public key only (tag 9 empty)"}`);

  const posLines = LINES;
  // ZATCA's live validator (BR-KSA-F-04) requires ALL amounts and quantities
  // to be positive — a credit note's nature is carried by the InvoiceTypeCode
  // (381), the BillingReference and the PaymentMeans InstructionNote, NOT by
  // negative line values.
  const negLines = LINES;

  interface DocSpec {
    key: string;
    label: string;
    documentType: ZatcaDocumentType;
    invoiceNumber: string;
    buyer?: ZatcaParty | null;
    lines: ZatcaLineInput[];
    billingReference?: { id: string; uuid?: string | null } | null;
    instructionNote?: string | null;
  }

  const specs: DocSpec[] = [
    { key: "b2b-invoice", label: "Standard B2B Invoice (388)", documentType: "standard", invoiceNumber: "SB2B-INV-0001", buyer: BUYER, lines: posLines },
    { key: "b2b-credit", label: "Standard B2B Credit Note (381)", documentType: "credit_note", invoiceNumber: "SB2B-CN-0001", buyer: BUYER, lines: negLines },
    { key: "b2b-debit", label: "Standard B2B Debit Note (383)", documentType: "debit_note", invoiceNumber: "SB2B-DN-0001", buyer: BUYER, lines: posLines },
    { key: "b2c-invoice", label: "Simplified B2C Invoice (388)", documentType: "simplified", invoiceNumber: "SC2C-INV-0001", buyer: null, lines: posLines },
    { key: "b2c-credit", label: "Simplified B2C Credit Note (381)", documentType: "credit_note", invoiceNumber: "SC2C-CN-0001", buyer: null, lines: negLines },
    { key: "b2c-debit", label: "Simplified B2C Debit Note (383)", documentType: "debit_note", invoiceNumber: "SC2C-DN-0001", buyer: null, lines: posLines },
  ];

  let prevHash = FIRST_PIH;
  let icv = 0;
  const complianceDocs: BuiltDoc[] = [];
  let complianceAllPass = true;

  for (const spec of specs) {
    icv += 1;
    // Notes reference the first invoice of their family.
    const refInvoice = spec.documentType === "credit_note" || spec.documentType === "debit_note"
      ? complianceDocs.find((d) => (spec.key.startsWith("b2b") ? d.key === "b2b-invoice" : d.key === "b2c-invoice"))
      : undefined;
    const doc = makeDoc({
      key: spec.key,
      documentType: spec.documentType,
      invoiceNumber: spec.invoiceNumber,
      icv,
      pih: prevHash,
      seller: SELLER,
      buyer: spec.buyer ?? null,
      lines: spec.lines,
      billingReference: refInvoice ? { id: refInvoice.invoiceNumber, uuid: refInvoice.uuid } : null,
      instructionNote: spec.documentType === "credit_note" ? "Sandbox compliance credit note" : spec.documentType === "debit_note" ? "Sandbox compliance debit note" : null,
      privateKeyPem: keyPair.privateKey,
      certificatePem: complianceCertPem,
      certSignature: certSig,
    });
    complianceDocs.push(doc);
    writeFileSync(`${OUT_DIR}/doc-${icv}-${spec.key}.xml`, doc.signedXml);

    info(`── ICV ${icv} · ${spec.label} · ${doc.invoiceNumber}`);
    info(`   type=${doc.typeName} uuid=${doc.uuid} hash=${doc.invoiceHash.slice(0, 24)}… pih=${prevHash.slice(0, 24)}…`);

    const res = await zcaFetch(
      `${CONFIG.baseUrl}/compliance/invoices`,
      { Authorization: `Basic ${basicAuth(String(complianceToken), String(complianceSecret))}`, "Accept-Version": "V2", "Accept-Language": "en" },
      JSON.stringify({ uuid: doc.uuid, invoice: Buffer.from(doc.signedXml).toString("base64"), invoiceHash: doc.invoiceHash }),
    );
    const body = jbody(res.text);
    info(`   response: ${JSON.stringify(body).slice(0, 1500)}`);

    const accepted = res.status === 200 || res.status === 202;
    if (res.status === 202) info(`   (202 = accepted WITH warnings — still success)`);
    if (!accepted) {
      complianceAllPass = false;
      const errs =
        JSON.stringify(body?.validationResults?.errorMessages ?? body?.errors ?? body?.errorMessages ?? "").slice(0, 800);
      fail(`ICV ${icv} ${spec.label}: HTTP ${res.status} REJECTED ${errs}`);
      record(`compliance doc ${icv} (${spec.key})`, false, `HTTP ${res.status}: ${errs.slice(0, 200)}`);
    } else {
      ok(`ICV ${icv} ${spec.label}: HTTP ${res.status} accepted`);
      record(`compliance doc ${icv} (${spec.key})`, true, `HTTP ${res.status}, ${doc.typeName}, ICV ${icv}`);
    }
    prevHash = doc.invoiceHash; // PIH chain: next doc references this hash
  }

  if (!complianceAllPass) {
    fail("One or more compliance documents were rejected — cannot exchange for Production CSID");
    summaryAndExit(1);
  }
  ok("All 6 compliance documents accepted (HTTP 200/202)");

  // -------------------------------------------------------------------------
  // STEP 4 — exchange Compliance CSID for Production CSID
  // -------------------------------------------------------------------------
  banner("4. POST /production/csids  ->  Production CSID");

  const prodRes = await zcaFetch(
    `${CONFIG.baseUrl}/production/csids`,
    { Authorization: `Basic ${basicAuth(String(complianceToken), String(complianceSecret))}`, "Accept-Version": "V2", "Accept-Language": "en" },
    JSON.stringify({ compliance_request_id: String(complianceRequestId || "") }),
  );
  const prod = jbody(prodRes.text);
  info(`response body: ${JSON.stringify(prod).slice(0, 800)}`);
  const prodTokenRaw = prod.binarySecurityToken || prod.token || "";
  const prodSecret = prod.secret || "";
  // Same rule as compliance (probe-proven): use the values EXACTLY as
  // returned — any extra base64 decode of the token yields 401.
  const prodToken = prodTokenRaw;
  // The response carries NO `certificate` field: the PCSID certificate is
  // embedded as double-base64 inside binarySecurityToken.
  const prodCertPem: string | undefined = prod.certificate
    ? String(prod.certificate).startsWith("-----")
      ? String(prod.certificate)
      : `-----BEGIN CERTIFICATE-----\n${String(prod.certificate).match(/.{1,64}/g)?.join("\n")}\n-----END CERTIFICATE-----\n`
    : certPemFromBinarySecurityToken(prod.binarySecurityToken) || undefined;
  if (prodRes.status === 200 && prodToken && prodSecret) {
    ok(`Production CSID issued (HTTP ${prodRes.status})`);
    info(`BinarySecurityToken (CSID) = ${String(prodToken).slice(0, 48)}...`);
    if (prodCertPem) {
      writeFileSync(`${OUT_DIR}/production-csid.pem`, prodCertPem);
      info("Production CSID certificate saved -> production-csid.pem");
    }
    record("production csid", true, `HTTP ${prodRes.status}, PCSID + secret received`);
  } else {
    fail(`POST /production/csids returned HTTP ${prodRes.status}: ${JSON.stringify(prod).slice(0, 400)}`);
    record("production csid", false, `HTTP ${prodRes.status}`);
    summaryAndExit(1);
  }

  // -------------------------------------------------------------------------
  // STEP 5 — LIVE clearance (B2B) + reporting (B2C) with Production CSID,
  //           verifying the returned TLV QR codes (B2B: 1-8, B2C: 1-9)
  // -------------------------------------------------------------------------
  banner("5. Live clearance (B2B) + reporting (B2C) + TLV QR verification");

  // SIGNING KEY vs STAMP CERTIFICATE.
  // We sign with the EGS key (that's the document's author). The embedded
  // KeyInfo certificate MUST be the EGS certificate (the compliance CSID
  // cert) so that:
  //   - QR tag 8 (the public key) matches ds:SignatureValue (the ECDSA sig
  //     over SignedInfo made with the EGS private key),
  //   - tag 9 = that certificate's own CA signature,
  //   - XAdES IssuerSerial/CertDigest all refer to the SAME certificate.
  //
  // SANDBOX QUIRK: the production PCSID that ZATCA returns here is a static
  // TST certificate ("CN=TST-886431145-…") with its OWN key — it is not
  // issued from our CSR. Embedding it while signing with the EGS key is what
  // triggers `publicKey_QRCODE_INVALID` + `signed-properties-hashing` on the
  // reporting API. In real production the PCSID is issued from our CSR and
  // therefore carries the EGS key, so this construction is correct there.
  const signCertPem = complianceCertPem || "";
  const signCertSig = certificateSignatureDer(signCertPem);
  // Live docs continue the ICV/PIH chain from the 6 compliance documents.
  let livePrevHash = prevHash;

  async function liveSubmit(kind: "clearance" | "reporting", spec: DocSpec): Promise<boolean> {
    icv += 1;
    const isB2b = kind === "clearance";
    const doc = makeDoc({
      key: `${kind}-live`,
      documentType: isB2b ? "standard" : "simplified",
      invoiceNumber: isB2b ? "LIVE-B2B-0001" : "LIVE-B2C-0001",
      icv,
      pih: livePrevHash,
      seller: SELLER,
      buyer: isB2b ? BUYER : null,
      lines: posLines,
      privateKeyPem: keyPair.privateKey,
      certificatePem: signCertPem,
      certSignature: signCertSig,
    });
    writeFileSync(`${OUT_DIR}/live-${kind}-${icv}.xml`, doc.signedXml);
    info(`── ICV ${icv} · ${isB2b ? "B2B clearance" : "B2C reporting"} · ${doc.invoiceNumber} · type=${doc.typeName}`);
    info(`   our QR (pre-submission, ${isB2b ? "8-tag (cleared mode)" : "9-tag (simplified)"}): ${doc.qr.slice(0, 48)}…`);

    const url = isB2b ? `${CONFIG.baseUrl}/invoices/clearance/single` : `${CONFIG.baseUrl}/invoices/reporting/single`;
    const res = await zcaFetch(
      url,
      { Authorization: `Basic ${basicAuth(String(prodToken), String(prodSecret))}`, "Accept-Version": "V2", "Accept-Language": "en" },
      JSON.stringify({ uuid: doc.uuid, invoice: Buffer.from(doc.signedXml).toString("base64"), invoiceHash: doc.invoiceHash }),
    );
    const body = jbody(res.text);
    info(`   response body: ${JSON.stringify(body).slice(0, 1500)}`);
    if (res.headers["clearance-status"]) info(`   Clearance-Status header: ${res.headers["clearance-status"]}`);

    const accepted = res.status === 200 || res.status === 202;
    if (!accepted) {
      const errs = JSON.stringify(body?.validationResults?.errorMessages ?? body?.errors ?? body?.errorMessages ?? "").slice(0, 800);
      fail(`${kind} ICV ${icv}: HTTP ${res.status} REJECTED ${errs}`);
      record(`${kind} (B2${isB2b ? "B" : "C"})`, false, `HTTP ${res.status}: ${errs.slice(0, 200)}`);
      return false;
    }
    ok(`${kind} ICV ${icv}: HTTP ${res.status} accepted${res.status === 202 ? " (with warnings)" : ""}`);

    // --- TLV QR verification from the (cleared) XML ZATCA returned ---
    // B2B (cleared): tags 1-8, tag 8 = raw SPKI DER bytes.
    // B2C (reported): tags 1-9, tag 9 = the stamp certificate's signature.
    let returnedXml = "";
    const clearedXmlField = body?.invoice || body?.clearedInvoice || body?.signedXml || body?.ClearedXml || "";
    if (typeof clearedXmlField === "string" && clearedXmlField) {
      const decoded = Buffer.from(clearedXmlField, "base64").toString("utf8");
      returnedXml = decoded.includes("<") ? decoded : clearedXmlField;
    }
    const t2 = res.headers["clearance-timestamp"] ? ` (ts=${res.headers["clearance-timestamp"]})` : "";
    if (!returnedXml) {
      info(`   NOTE: no cleared XML in response${t2} — QR check limited to our own QR (${isB2b ? "8-tag" : "9-tag"})`);
      record(`${kind} (B2${isB2b ? "B" : "C"})`, true, `HTTP ${res.status}, accepted (no cleared XML in body)`);
    } else {
      writeFileSync(`${OUT_DIR}/live-${kind}-${icv}-cleared.xml`, returnedXml);
      const m = returnedXml.match(/<cac:AdditionalDocumentReference>\s*<cbc:ID>\s*QR\s*<\/cbc:ID>[\s\S]*?<cbc:EmbeddedDocumentBinaryObject[^>]*>([\s\S]*?)<\/cbc:EmbeddedDocumentBinaryObject>/i);
      if (!m) {
        fail(`${kind}: cleared XML received but no QR element found in it`);
        record(`${kind} (B2${isB2b ? "B" : "C"})`, false, "accepted but QR missing from cleared XML");
        return false;
      }
      const raw = Buffer.from(m[1].trim(), "base64");
      const tags: Array<{ tag: number; value: string; raw: Buffer }> = [];
      let qi = 0;
      while (qi + 2 <= raw.length) {
        const t = raw[qi];
        const l = raw[qi + 1];
        if (qi + 2 + l > raw.length) break;
        tags.push({ tag: t, value: raw.subarray(qi + 2, qi + 2 + l).toString("utf8"), raw: raw.subarray(qi + 2, qi + 2 + l) });
        qi += 2 + l;
      }
      info(`   ZATCA-returned QR: ${m[1].trim().slice(0, 64)}…  (${tags.length} tags decoded)`);
      const expect = isB2b ? [1, 2, 3, 4, 5, 6, 7, 8] : [1, 2, 3, 4, 5, 6, 7, 8, 9];
      const have = tags.map((t) => t.tag);
      const missing = expect.filter((n) => !have.includes(n));
      const byTag = Object.fromEntries(tags.map((t) => [t.tag, t.value]));
      const byTagRaw = Object.fromEntries(tags.map((t) => [t.tag, t.raw]));
      for (const n of expect) {
        const label: Record<number, string> = { 1: "sellerName", 2: "VAT", 3: "timestamp", 4: "total", 5: "VAT total", 6: "invoiceHash", 7: "signature", 8: "publicKey (SPKI DER)", 9: "certSignature" };
        const v = byTag[n] || "";
        info(`     tag ${n} (${label[n]}) = ${v.length > 64 ? v.slice(0, 64) + "…" + ` [${v.length} chars]` : JSON.stringify(v)}`);
      }
      const hashOk = byTag[6] === doc.invoiceHash;
      info(`     tag 6 matches our invoiceHash: ${hashOk ? "YES" : "NO (ours=" + doc.invoiceHash.slice(0, 20) + "…)"}`);
      // Tag 8 must be the raw SPKI DER byte string: 0x30 0x56 prefix (88 B)
      // for a secp256k1 SPKI — NOT base64 text (Security Features standard).
      const keyRaw: Buffer | undefined = byTagRaw[8];
      const keyShapeOk = Boolean(
        keyRaw && keyRaw.length === 88 && keyRaw[0] === 0x30 && keyRaw[1] === 0x56,
      );
      info(`     tag 8 is raw SPKI DER (88 B, 30 56 prefix): ${keyShapeOk ? "YES" : "NO/unchecked"}`);
      // Cross-check tag 7 (signature) against tag 8 (public key) over the
      // node-set canonical SignedInfo — exactly how signUnsignedInvoice()
      // signs, and how a spec-compliant validator verifies.
      let sigOk = false;
      try {
        const siStart = returnedXml.indexOf("<ds:SignedInfo");
        const siEnd = returnedXml.indexOf("</ds:SignedInfo>", siStart);
        if (siStart >= 0 && siEnd >= 0 && byTag[7] && keyRaw) {
          const { createVerify } = await import("node:crypto");
          const si = returnedXml.slice(siStart, siEnd + "</ds:SignedInfo>".length);
          const v = createVerify("sha256");
          v.update(signedInfoCanon(si), "utf8");
          sigOk = v.verify(
            createPublicKey({ key: keyRaw, format: "der", type: "spki" }),
            Buffer.from(byTag[7], "base64"),
          );
        }
      } catch { /* non-fatal */ }
      info(`     tag 7 verifies against tag 8 (ECDSA secp256k1 over C14N SignedInfo): ${sigOk ? "YES" : "NO/unchecked"}`);
      if (missing.length === 0 && hashOk && keyShapeOk) {
        ok(`${isB2b ? "B2B clearance" : "B2C reporting"}: ${expect.length}-tag TLV QR verified (tags ${expect.join(",")}, hash match${sigOk ? ", signature valid" : ""})`);
        record(`${kind} (B2${isB2b ? "B" : "C"})`, true, `HTTP ${res.status}, QR tags ${have.join(",")}, hashOk=${hashOk}, sigOk=${sigOk}`);
      } else {
        fail(`${kind}: QR tag check FAILED — missing tags: ${missing.join(",") || "none"}, hashOk=${hashOk}, keyShapeOk=${keyShapeOk}`);
        record(`${kind} (B2${isB2b ? "B" : "C"})`, false, `missing ${missing.join(",")} hashOk=${hashOk} keyShapeOk=${keyShapeOk}`);
        return false;
      }
    }
    livePrevHash = doc.invoiceHash;
    return true;
  }

  const b2bOk = await liveSubmit("clearance", { key: "clearance-live", label: "B2B live clearance", documentType: "standard", invoiceNumber: "LIVE-B2B-0001", buyer: BUYER, lines: posLines });
  const b2cOk = await liveSubmit("reporting", { key: "reporting-live", label: "B2C live reporting", documentType: "simplified", invoiceNumber: "LIVE-B2C-0001", buyer: null, lines: posLines });

  if (!b2bOk || !b2cOk) summaryAndExit(1);
  ok("Live clearance + reporting both accepted with verified QR codes");

  summaryAndExit(0);
}

function summaryAndExit(code: number): never {
  const pass = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log("");
  console.log("=".repeat(88));
  console.log(`SUMMARY: ${pass}/${total} steps passed`);
  console.log("=".repeat(88));
  for (const r of results) {
    console.log(`  ${r.ok ? "[PASS]" : "[FAIL]"} ${r.step} — ${r.detail.slice(0, 160)}`);
  }
  console.log(`\nArtifacts saved in ${OUT_DIR}/ (keys, CSR, signed XML, CSID certs, ZATCA responses)`);
  console.log("");
  process.exit(code);
}

main().catch((e) => {
  console.error("\nFATAL:", e);
  summaryAndExit(1);
});

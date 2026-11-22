/**
 * Travel & Tours — ZATCA TLV QR VERIFICATION
 *
 * Decodes a ZATCA simplified-invoice TLV Base64 QR (the one embedded in a
 * travel ticket) and asserts all 5 mandatory tags match the invoice figures.
 *
 * Run:
 *   # 1) Self-test (no DB, no env): proves the shipped QR generator + decoder
 *   npx tsx scripts/verify-travel-tlv-qr.ts
 *
 *   # 2) Verify an ad-hoc payload against expected numbers
 *   npx tsx scripts/verify-travel-tlv-qr.ts --qr <base64> \
 *       --seller "Dazzling Travel & Tours" --seller-vat 399999999900003 \
 *       --total 1550.00 --vat 6.52
 *
 *   # 3) Verify the QR actually stored for a travel invoice (needs DATABASE_URL)
 *   npx tsx scripts/verify-travel-tlv-qr.ts --travel 12
 *   npx tsx scripts/verify-travel-tlv-qr.ts --latest --tenant 1
 *
 * Exit code 0 = all checks passed, 1 = mismatch/failure.
 *
 * Tag layout (ZATCA e-invoicing, simplified B2C):
 *   1 seller name · 2 VAT reg. no (15) · 3 ISO-8601 timestamp
 *   4 invoice total incl. VAT · 5 VAT total
 */

import { travelZatcaQr } from "../src/lib/travelCalc";

interface TlvTag { tag: number; value: string; raw: Buffer }

/** Decode a Base64 TLV QR into ordered tags (binary-safe). */
export function decodeTlv(base64: string): TlvTag[] {
  const buf = Buffer.from(base64, "base64");
  const out: TlvTag[] = [];
  let i = 0;
  while (i + 2 <= buf.length) {
    const tag = buf[i];
    const len = buf[i + 1];
    if (i + 2 + len > buf.length) break;
    const raw = buf.subarray(i + 2, i + 2 + len);
    out.push({ tag, value: raw.toString("utf8"), raw });
    i += 2 + len;
  }
  return out;
}

export interface TlvExpectation {
  seller?: string;
  sellerVat: string;
  total: number | string;
  vat: number | string;
}

export interface TlvReport {
  ok: boolean;
  tags: Array<{ tag: number; label: string; value: string }>;
  problems: string[];
}

const LABELS: Record<number, string> = {
  1: "sellerName", 2: "VAT registration", 3: "timestamp",
  4: "invoice total", 5: "VAT total",
};

const money = (v: unknown) => (Number(v) || 0).toFixed(2);

/** Verify decoded tags 1–5 against the expected invoice figures. */
export function verifyTlv(base64: string, exp: TlvExpectation): TlvReport {
  const problems: string[] = [];
  const decoded = decodeTlv(base64);
  const byTag = new Map(decoded.map((t) => [t.tag, t]));

  for (const n of [1, 2, 3, 4, 5]) {
    if (!byTag.has(n)) problems.push(`missing mandatory tag ${n} (${LABELS[n]})`);
  }

  const t2 = byTag.get(2)?.value ?? "";
  if (t2 && !/^\d{15}$/.test(t2)) problems.push(`tag 2 (VAT) is not 15 digits: "${t2}"`);
  if (t2 && exp.sellerVat && t2 !== exp.sellerVat) problems.push(`tag 2 (VAT) ${t2} != expected ${exp.sellerVat}`);

  const t3 = byTag.get(3)?.value ?? "";
  if (t3 && Number.isNaN(Date.parse(t3))) problems.push(`tag 3 (timestamp) is not a valid ISO-8601 date: "${t3}"`);

  const t1 = byTag.get(1)?.value ?? "";
  if (t1 && exp.seller && t1 !== exp.seller) problems.push(`tag 1 (seller) "${t1}" != expected "${exp.seller}"`);

  const t4 = byTag.get(4)?.value ?? "";
  if (t4 && money(t4) !== money(exp.total)) problems.push(`tag 4 (total) ${t4} != expected ${money(exp.total)}`);

  const t5 = byTag.get(5)?.value ?? "";
  if (t5 && money(t5) !== money(exp.vat)) problems.push(`tag 5 (VAT) ${t5} != expected ${money(exp.vat)}`);

  return {
    ok: problems.length === 0,
    tags: decoded.map((t) => ({ tag: t.tag, label: LABELS[t.tag] ?? "?", value: t.value })),
    problems,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function has(name: string) { return process.argv.includes(`--${name}`); }

function printReport(title: string, rep: TlvReport) {
  console.log(`\n── ${title} ──`);
  for (const t of rep.tags) console.log(`   tag ${t.tag} (${t.label}) = ${t.value}`);
  if (rep.ok) console.log("   ✅ PASS — all 5 TLV tags present and matching");
  else { console.log("   ❌ FAIL"); for (const p of rep.problems) console.log(`      • ${p}`); }
}

async function dbMode() {
  const { getDb } = await import("../api/queries/connection");
  const { travelInvoices, invoices, companySettings } = await import("@db/schema");
  const { eq, and, desc } = await import("drizzle-orm");
  const db = getDb();

  let tenantId: number;
  let doc: any;
  if (has("latest")) {
    tenantId = Number(arg("tenant") ?? 1);
    [doc] = await db.select().from(travelInvoices)
      .where(eq(travelInvoices.tenantId, tenantId))
      .orderBy(desc(travelInvoices.createdAt)).limit(1);
  } else {
    const id = Number(arg("travel"));
    [doc] = await db.select().from(travelInvoices).where(eq(travelInvoices.id, id)).limit(1);
    tenantId = doc?.tenantId ?? 0;
  }
  if (!doc) throw new Error("travel invoice not found");

  const [company] = await db.select().from(companySettings).where(eq(companySettings.tenantId, tenantId)).limit(1);
  const [inv] = doc.invoiceId
    ? await db.select().from(invoices).where(and(eq(invoices.id, doc.invoiceId), eq(invoices.tenantId, tenantId))).limit(1)
    : [];

  const qr = inv?.zatcaQrCode || inv?.qrPhase2 || "";
  console.log(`Travel invoice ${doc.invoiceNumber} (id ${doc.id}) — mode=${doc.mode}`);
  console.log(`  DB total=${doc.totalAmount}  VAT=${doc.taxAmount}  sellerVat=${company?.taxNumber ?? "—"}`);
  if (doc.mode !== "zatca") { console.log("  (non-tax invoice — no ZATCA QR expected) ✅"); return 0; }
  if (!qr) {
    // The print path falls back to a locally built TLV QR when the signed QR
    // is not yet available; verify that fallback against the same figures.
    const fallback = travelZatcaQr({
      seller: company?.companyName || "Travel Agency",
      vat: company?.taxNumber || "",
      iso: `${doc.date}T00:00:00Z`,
      total: doc.totalAmount, vatAmt: doc.taxAmount,
    });
    console.log("  (no signed QR stored yet — verifying the local TLV fallback used on the ticket)");
    const rep = verifyTlv(fallback, { sellerVat: String(company?.taxNumber ?? ""), total: doc.totalAmount, vat: doc.taxAmount });
    printReport("local TLV fallback QR", rep);
    return rep.ok ? 0 : 1;
  }
  const rep = verifyTlv(qr, { sellerVat: String(company?.taxNumber ?? ""), total: doc.totalAmount, vat: doc.taxAmount });
  printReport("stored ZATCA QR", rep);
  return rep.ok ? 0 : 1;
}

function adhocMode() {
  const qr = arg("qr")!;
  const exp: TlvExpectation = {
    seller: arg("seller"),
    sellerVat: arg("seller-vat") ?? "",
    total: arg("total") ?? NaN,
    vat: arg("vat") ?? NaN,
  };
  if (Number.isNaN(Number(exp.total)) || Number.isNaN(Number(exp.vat))) {
    console.error("--qr requires --total and --vat (and optionally --seller / --seller-vat)");
    return 2;
  }
  const rep = verifyTlv(qr, exp);
  printReport("adhoc QR", rep);
  return rep.ok ? 0 : 1;
}

function selfTest() {
  console.log("Travel & Tours — ZATCA TLV QR self-test (shipped generator → decoder)");
  let failures = 0;
  const cases: Array<{ name: string; seller: string; vat: string; iso: string; total: number; vatAmt: number }> = [
    // Margin 15% inclusive: base 1500 + gross fee 50 → taxable 43.48 + VAT 6.52 = 1550.00
    { name: "margin inclusive (1500 base + 50 gross fee)", seller: "Dazzling Travel & Tours", vat: "399999999900003", iso: "2026-11-21T10:30:00Z", total: 1550.00, vatAmt: 6.52 },
    // Margin 15% exclusive: base 1500 + fee 50 + VAT 7.50 = 1557.50
    { name: "margin exclusive (base 1500 + fee 50)", seller: "Dazzling Travel & Tours", vat: "399999999900003", iso: "2026-11-21T11:00:00Z", total: 1557.50, vatAmt: 7.50 },
    // Standard 15% on 1000 → VAT 150, total 1150
    { name: "standard 15% (1000)", seller: "WAFA Travel", vat: "310123456700003", iso: "2026-11-21T12:00:00Z", total: 1150.00, vatAmt: 150.00 },
  ];
  for (const c of cases) {
    const qr = travelZatcaQr({ seller: c.seller, vat: c.vat, iso: c.iso, total: c.total, vatAmt: c.vatAmt });
    const rep = verifyTlv(qr, { seller: c.seller, sellerVat: c.vat, total: c.total, vat: c.vatAmt });
    printReport(c.name, rep);
    // extra: timestamp must round-trip exactly
    const tag3 = decodeTlv(qr).find((t) => t.tag === 3)?.value;
    if (tag3 !== c.iso) { console.log(`      • tag 3 timestamp mismatch: ${tag3} != ${c.iso}`); failures++; }
    if (!rep.ok) failures++;
  }

  // Negative control: a tampered VAT must be caught.
  const good = travelZatcaQr({ seller: "X", vat: "399999999900003", iso: "2026-11-21T10:30:00Z", total: 1550, vatAmt: 6.52 });
  const bad = verifyTlv(good, { sellerVat: "300000000000003", total: 1550, vat: 6.52 });
  console.log(`\n── negative control (wrong expected VAT) ──\n   ${bad.ok ? "❌ FAIL — tampered expectation NOT caught" : "✅ PASS — mismatch correctly detected"}`);
  if (bad.ok) failures++;

  console.log(`\n${failures === 0 ? "✅ ALL SELF-TESTS PASSED" : `❌ ${failures} SELF-TEST(S) FAILED`}`);
  return failures === 0 ? 0 : 1;
}

(async () => {
  try {
    let code = 0;
    if (arg("qr")) code = adhocMode();
    else if (has("travel") || has("latest")) code = await dbMode();
    else code = selfTest();
    process.exit(code);
  } catch (e: any) {
    console.error("verify-travel-tlv-qr failed:", e?.message || e);
    process.exit(1);
  }
})();

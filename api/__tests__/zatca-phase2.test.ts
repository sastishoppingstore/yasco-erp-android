/**
 * ZATCA Phase 2 — pure-logic regression tests.
 *
 * These tests deliberately avoid the database and the network: they cover the
 * money maths, the hash chain, the QR TLV encoding and the UBL document
 * structure, which are the parts that must never regress silently.
 */
import { describe, expect, it } from "vitest";
import {
  FIRST_PIH,
  buildQr,
  buildUblDocument,
  computeTotals,
  assertTotalsReconcile,
  c14n11,
  round2,
  money,
  invoiceTypeName,
  type ZatcaLineInput,
} from "../lib/zatca/phase2";
import { EMPTY_HASH, computePih, computeInvoiceXmlHash } from "../lib/zatca/hashChain";

const line = (over: Partial<ZatcaLineInput> = {}): ZatcaLineInput => ({
  description: "Widget",
  quantity: 1,
  unitPrice: 100,
  taxPercent: 15,
  taxCategory: "S",
  ...over,
});

/** Minimal TLV decoder used only by the tests. */
function decodeTlv(base64: string): Array<{ tag: number; value: string }> {
  const buf = Buffer.from(base64, "base64");
  const out: Array<{ tag: number; value: string }> = [];
  let i = 0;
  while (i < buf.length) {
    const tag = buf[i];
    const len = buf[i + 1];
    const value = buf.subarray(i + 2, i + 2 + len).toString("utf8");
    out.push({ tag, value });
    i += 2 + len;
  }
  return out;
}

describe("money maths", () => {
  it("rounds half-up at the halala boundary", () => {
    expect(round2(0.005)).toBe(0.01);
    expect(round2(0.004)).toBe(0);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(money(15)).toBe("15.00");
    expect(money(0.1 + 0.2)).toBe("0.30");
  });
});

describe("computeTotals", () => {
  it("computes VAT and the payable total for a single standard line", () => {
    const t = computeTotals([line()]);
    expect(t.lineExtensionAmount).toBe(100);
    expect(t.taxAmount).toBe(15);
    expect(t.taxExclusiveAmount).toBe(100);
    expect(t.taxInclusiveAmount).toBe(115);
    expect(t.payableAmount).toBe(115);
  });

  it("applies a header discount proportionally and keeps VAT consistent", () => {
    // 100 @ S15 + 50 @ Z0 = 150 taxable; 30 discount => ratio 0.8.
    const t = computeTotals(
      [line({ unitPrice: 100, taxPercent: 15, taxCategory: "S" }), line({ unitPrice: 50, taxPercent: 0, taxCategory: "Z" })],
      30,
    );
    expect(t.taxExclusiveAmount).toBe(120);
    expect(t.taxAmount).toBe(12); // (100*0.8) * 15% = 12
    expect(t.taxInclusiveAmount).toBe(132);
    const s = t.perCategory.find((b) => b.category === "S")!;
    const z = t.perCategory.find((b) => b.category === "Z")!;
    expect(s.taxable).toBe(80);
    expect(z.taxable).toBe(40);
    expect(z.tax).toBe(0);
  });

  it("never lets a discount exceed the taxable base", () => {
    const t = computeTotals([line({ unitPrice: 10 })], 9999);
    expect(t.allowanceTotal).toBe(10);
    expect(t.taxExclusiveAmount).toBe(0);
    expect(t.taxAmount).toBe(0);
  });

  it("keeps header VAT equal to the sum of line VAT after rounding", () => {
    // Three awkward lines that would drift by 0.01 with naive per-line maths.
    const lines = [
      line({ unitPrice: 33.33, quantity: 3 }),
      line({ unitPrice: 0.01, quantity: 1 }),
      line({ unitPrice: 19.99, quantity: 7 }),
    ];
    const t = computeTotals(lines, 5.55);
    const summedTax = t.perCategory.reduce((s, b) => s + b.tax, 0);
    expect(round2(summedTax)).toBe(t.taxAmount);
    expect(t.taxInclusiveAmount).toBe(round2(t.taxExclusiveAmount + t.taxAmount));
  });
});

describe("assertTotalsReconcile", () => {
  it("accepts a matching header within one halala", () => {
    const t = computeTotals([line()]);
    expect(() => assertTotalsReconcile(t, { subTotal: "100.00", taxAmount: 15, totalAmount: "115" })).not.toThrow();
  });

  it("throws when the header disagrees by more than one halala", () => {
    const t = computeTotals([line()]);
    expect(() =>
      assertTotalsReconcile(t, { subTotal: "100.00", taxAmount: 14, totalAmount: "115" }),
    ).toThrow(/mismatch/i);
  });

  it("ignores missing header fields", () => {
    const t = computeTotals([line()]);
    expect(() => assertTotalsReconcile(t, {})).not.toThrow();
    expect(() => assertTotalsReconcile(t)).not.toThrow();
  });
});

describe("hash chain", () => {
  it("uses the official first-invoice PIH constant", () => {
    expect(FIRST_PIH).toBe(EMPTY_HASH);
    // base64( hex( sha256("0") ) )
    const hex = require("node:crypto").createHash("sha256").update("0").digest("hex");
    expect(Buffer.from(FIRST_PIH, "base64").toString("utf8")).toBe(hex);
  });

  it("PIH(1) is the seed and PIH(n) is the previous invoice hash unchanged", () => {
    expect(computePih(null)).toBe(FIRST_PIH);
    expect(computePih("")).toBe(FIRST_PIH);
    const h1 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    expect(computePih(h1, "ignored")).toBe(h1);
    expect(computePih(computePih(h1), "again")).toBe(h1);
  });

  it("C14N is whitespace-significant (cosmetic changes DO change the hash)", () => {
    // Real C14N 1.1 preserves inter-element text nodes, so reformatting the
    // XML is a legal-content change, not a no-op.
    const a = computeInvoiceXmlHash("<x><y>1</y></x>");
    const b = computeInvoiceXmlHash("<x>\n  <y>1</y>\n</x>");
    expect(a).not.toBe(b);
  });

  it("c14n11 is idempotent on an already-canonical document", () => {
    const doc = '<Invoice xmlns="urn:inv" xmlns:cac="urn:cac"><cac:Foo a="1">x</cac:Foo></Invoice>';
    const once = c14n11(doc);
    expect(c14n11(once)).toBe(once);
  });
});

describe("C14N 1.1 canonicalisation", () => {
  it("drops the XML declaration and comments", () => {
    const out = c14n11('<?xml version="1.0" encoding="UTF-8"?><a><!-- c --><b>1</b></a>');
    expect(out).toBe("<a><b>1</b></a>");
  });

  it("renders empty elements as start-end pairs", () => {
    expect(c14n11("<a><b/></a>")).toBe("<a><b></b></a>");
  });

  it("keeps declared-but-unused namespace declarations on the element", () => {
    // Verified against ZATCA's own canonicalizer: a root xmlns:ext with no
    // ext: descendant SURVIVES (only redundant re-declarations are dropped).
    const out = c14n11('<a xmlns="urn:d" xmlns:unused="urn:x"><b>1</b></a>');
    expect(out).toBe('<a xmlns="urn:d" xmlns:unused="urn:x"><b>1</b></a>');
  });

  it("sorts attributes by namespace URI then local name", () => {
    // attribute `a` (default/empty ns) sorts before attribute `b` (urn:ns).
    const out = c14n11('<r b="2" a="1" xmlns:b="urn:ns">x</r>');
    expect(out).toBe('<r xmlns:b="urn:ns" a="1" b="2">x</r>');
  });
});

describe("QR TLV", () => {
  const keyDer = Buffer.concat([Buffer.from([0x30, 0x56]), Buffer.alloc(86, 7)]);
  // A fake 72-byte ECDSA signature DER (30 48 …) shaped like a real one.
  const certSigDer = Buffer.concat([Buffer.from([0x30, 0x48]), Buffer.alloc(70, 5)]);
  const fields = {
    sellerName: "YASCO",
    vatNumber: "300995897900003",
    timestamp: "2026-01-01T00:00:00Z",
    totalWithVat: 115,
    vatTotal: 15,
    invoiceHash: "HASH",
    signature: "SIG",
    publicKeyDer: keyDer.toString("base64"),
    certificateSignature: certSigDer.toString("base64"),
  };

  it("simplified invoices carry all 9 tags", () => {
    const tags = decodeTlv(buildQr(fields, "simplified")).map((t) => t.tag);
    expect(tags).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("tag 9 (certificate signature) is RAW DER bytes, not base64 text", () => {
    // Official Security Features hex sample: tag 9 = 30 46 02 21 00 …
    const raw = Buffer.from(buildQr(fields, "simplified"), "base64");
    const rawTag9 = raw.subarray(raw.length - certSigDer.length, raw.length);
    expect(rawTag9.equals(certSigDer)).toBe(true);
  });

  it("standard (cleared) invoices carry tags 1-8 with tag 8 as RAW SPKI DER", () => {
    const tags = decodeTlv(buildQr(fields, "cleared")).map((t) => t.tag);
    expect(tags).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // Tag 8 must be the raw DER byte string, not its base64 text.
    const raw = Buffer.from(buildQr(fields, "cleared"), "base64");
    const rawTag8 = raw.subarray(raw.length - keyDer.length, raw.length);
    expect(rawTag8.equals(keyDer)).toBe(true);
  });

  it("encodes the values verbatim", () => {
    const decoded = decodeTlv(buildQr(fields, "simplified"));
    expect(decoded[0].value).toBe("YASCO");
    expect(decoded[1].value).toBe("300995897900003");
    expect(decoded[3].value).toBe("115.00");
    expect(decoded[4].value).toBe("15.00");
  });
});

describe("UBL document", () => {
  const seller = { name: "YASCO", nameAr: "ياسكو", vatNumber: "300995897900003", crNumber: "4700012896" };

  it("builds a standard (B2B) invoice with the 0100000 subtype", () => {
    const { xml } = buildUblDocument({
      documentType: "standard",
      invoiceNumber: "INV-1",
      uuid: "00000000-0000-0000-0000-000000000000",
      icv: 1,
      pih: FIRST_PIH,
      issueDate: "2026-01-01",
      issueTime: "12:00:00",
      currency: "SAR",
      seller,
      buyer: { name: "Buyer", vatNumber: "311111111111113" },
      lines: [line()],
    });
    expect(xml).toContain('<cbc:InvoiceTypeCode name="0100000">388</cbc:InvoiceTypeCode>');
    expect(xml).toContain("</Invoice>");
    expect(xml).not.toContain("0300000");
    expect(xml).toContain(`<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${FIRST_PIH}`);
  });

  it("builds a simplified (B2C) invoice with the 0200000 subtype", () => {
    const { xml } = buildUblDocument({
      documentType: "simplified",
      invoiceNumber: "INV-2",
      uuid: "00000000-0000-0000-0000-000000000001",
      icv: 2,
      pih: FIRST_PIH,
      issueDate: "2026-01-02",
      issueTime: "09:00:00",
      currency: "SAR",
      seller,
      lines: [line()],
    });
    expect(xml).toContain('<cbc:InvoiceTypeCode name="0200000">388</cbc:InvoiceTypeCode>');
  });

  it("emits a credit note (381) with BillingReference and instruction note", () => {
    const { xml } = buildUblDocument({
      documentType: "credit_note",
      invoiceNumber: "CN-1",
      uuid: "00000000-0000-0000-0000-000000000002",
      icv: 3,
      pih: FIRST_PIH,
      issueDate: "2026-01-03",
      issueTime: "09:00:00",
      currency: "SAR",
      seller,
      buyer: { name: "Buyer", vatNumber: "311111111111113" },
      lines: [line()],
      paymentType: "Cash",
      billingReference: { id: "INV-1", uuid: "00000000-0000-0000-0000-000000000000" },
      instructionNote: "Full return",
    });
    // ZATCA always uses the Invoice root — the 381 code + 0100000 subtype
    // identify it as a standard credit note (official XML standard).
    expect(xml).toContain("</Invoice>");
    expect(xml).not.toContain("</CreditNote>");
    expect(xml).toContain('<cbc:InvoiceTypeCode name="0100000">381</cbc:InvoiceTypeCode>');
    expect(xml).toContain("<cac:BillingReference>");
    expect(xml).toContain("<cbc:ID>INV-1</cbc:ID>");
    // BR-KSA-17: the reason sits on PaymentMeans, not the Invoice root.
    expect(xml).toContain(
      "<cac:PaymentMeans><cbc:PaymentMeansCode>10</cbc:PaymentMeansCode><cbc:InstructionNote>Full return</cbc:InstructionNote></cac:PaymentMeans>",
    );
    // BillingReference precedes the ICV/PIH references (XSD sequence order).
    expect(xml.indexOf("<cac:BillingReference>")).toBeLessThan(xml.indexOf("<cbc:ID>ICV</cbc:ID>"));
  });

  it("escapes user content so the XML can never be broken by a name", () => {
    const { xml } = buildUblDocument({
      documentType: "simplified",
      invoiceNumber: "INV<&>",
      uuid: "00000000-0000-0000-0000-000000000003",
      icv: 4,
      pih: FIRST_PIH,
      issueDate: "2026-01-04",
      issueTime: "09:00:00",
      currency: "SAR",
      seller: { name: "A & B <Co>" },
      lines: [line({ description: 'Widget "X" <large>' })],
    });
    expect(xml).toContain("INV&lt;&amp;&gt;");
    expect(xml).toContain("A &amp; B &lt;Co&gt;");
    expect(xml).not.toMatch(/<cbc:ID>INV<&>/);
  });

  it("invoiceTypeName maps document types to ZATCA subtypes", () => {
    expect(invoiceTypeName("standard")).toBe("0100000");
    expect(invoiceTypeName("simplified")).toBe("0200000");
    expect(invoiceTypeName("credit_note", { name: "x", vatNumber: "3" })).toBe("0100000");
    expect(invoiceTypeName("credit_note", { name: "x" })).toBe("0200000");
  });
});

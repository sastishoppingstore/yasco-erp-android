// Travel ticket line math — mirror of `api/travelRouter.ts#calcTravelLine`.
//
// Two pricing schemes:
//   • "standard" — the whole unit price is taxable.
//   • "margin"   — the airline/supplier base fare is NON-taxable while only
//                  the agency service fee (profit) attracts VAT. The service
//                  fee can be entered VAT-exclusive or VAT-inclusive.

export type PricingMode = "standard" | "margin";
export type VatMode = "exclusive" | "inclusive";

export interface TravelLineInput {
  quantity: number;
  unitPrice?: number;
  /** margin pricing — non-taxable supplier/airline cost per unit */
  baseFare?: number;
  /**
   * margin pricing — customer-facing sale price per unit (base + profit).
   * When present the agency profit (and hence the taxable amount) is derived
   * as `salePrice - baseFare`. VAT is applied ONLY to that profit.
   */
  salePrice?: number;
  /** margin pricing — taxable agency service fee / profit per unit */
  serviceFee?: number;
}

export interface TravelLineCalc {
  quantity: number;
  /** Taxable amount (net of VAT). */
  taxable: number;
  /** Non-taxable base fare. */
  nonTaxable: number;
  vat: number;
  total: number;
  /** Agency gross margin (sale − base), i.e. the profit before VAT. */
  margin: number;
  /** Display unit price (non-taxable + taxable) per unit. */
  unitPrice: number;
}

export const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Format a money value for display: 2 decimals + thousands separators
 * (e.g. 1557.5 → "1,557.50"). `fmtNum` is an alias kept for the Create
 * Ticket screen which reads more naturally with that name.
 */
export const fmtMoney = (n: number | string | null | undefined): string =>
  (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtNum = fmtMoney;

export function calcTravelLine(
  item: TravelLineInput,
  pricingMode: PricingMode,
  vatMode: VatMode,
  vatPercent: number,
): TravelLineCalc {
  const qty = Math.max(0, Number(item.quantity) || 0);
  const pct = Math.max(0, Number(vatPercent) || 0);
  if (pricingMode === "standard") {
    const taxable = r2(qty * (Number(item.unitPrice) || 0));
    const vat = r2((taxable * pct) / 100);
    return { quantity: qty, taxable, nonTaxable: 0, vat, total: r2(taxable + vat), margin: taxable, unitPrice: r2(Number(item.unitPrice) || 0) };
  }
  const nonTaxable = r2(qty * (Number(item.baseFare) || 0));
  // Margin scheme profit: an explicit salePrice (sale − base) wins; otherwise
  // fall back to the raw serviceFee. VAT is charged ONLY on this profit.
  const basePerUnit = Number(item.baseFare) || 0;
  const feePerUnit = item.salePrice != null
    ? Math.max(0, (Number(item.salePrice) || 0) - basePerUnit)
    : (Number(item.serviceFee) || 0);
  const feeTotal = r2(qty * feePerUnit);
  let taxable: number, vat: number, total: number;
  if (vatMode === "inclusive") {
    taxable = r2(feeTotal / (1 + pct / 100));
    vat = r2(feeTotal - taxable);
    total = r2(nonTaxable + feeTotal);
  } else {
    taxable = feeTotal;
    vat = r2((taxable * pct) / 100);
    total = r2(nonTaxable + feeTotal + vat);
  }
  const unitPrice = qty > 0 ? r2((nonTaxable + taxable) / qty) : r2(nonTaxable + taxable);
  return { quantity: qty, taxable, nonTaxable, vat, total, margin: feeTotal, unitPrice };
}

export interface TravelTotals {
  nonTaxableAmount: number;
  taxableAmount: number;
  subTotal: number;
  taxAmount: number;
  totalAmount: number;
  /** Sum of agency gross margins (profit before VAT). */
  marginAmount: number;
}

export function computeTravelTotals(
  items: TravelLineInput[],
  pricingMode: PricingMode,
  vatMode: VatMode,
  vatPercent: number,
): TravelTotals {
  let nonTaxableAmount = 0, taxableAmount = 0, taxAmount = 0, totalAmount = 0, marginAmount = 0;
  for (const it of items) {
    const c = calcTravelLine(it, pricingMode, vatMode, vatPercent);
    nonTaxableAmount = r2(nonTaxableAmount + c.nonTaxable);
    taxableAmount = r2(taxableAmount + c.taxable);
    taxAmount = r2(taxAmount + c.vat);
    totalAmount = r2(totalAmount + c.total);
    marginAmount = r2(marginAmount + c.margin);
  }
  return { nonTaxableAmount, taxableAmount, subTotal: r2(nonTaxableAmount + taxableAmount), taxAmount, totalAmount, marginAmount };
}

/** ZATCA simplified QR (TLV tags 1-5, base64) for offline preview/printing. */
export function travelZatcaQr(o: { seller: string; vat: string; iso: string; total: string | number; vatAmt: string | number }): string {
  const enc = (s: string) => {
    const b = new TextEncoder().encode(s);
    let out = "";
    for (let i = 0; i < b.length; i++) out += String.fromCharCode(b[i]);
    return out;
  };
  const f = (tag: number, val: string) => {
    const v = enc(val);
    return String.fromCharCode(tag, v.length) + v;
  };
  const tlv = f(1, o.seller) + f(2, o.vat) + f(3, o.iso) +
    f(4, Number(o.total || 0).toFixed(2)) + f(5, Number(o.vatAmt || 0).toFixed(2));
  return btoa(tlv);
}

import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  travelBookings,
  travelSuppliers,
  itineraries,
  supplierReconciliation,
  travelInvoices,
  travelInvoiceItems,
  travelSettings,
  travelPassengers,
  travelPackages,
  travelVisas,
  travelHotels,
  invoices,
  invoiceItems,
  customers,
  companySettings,
  zatcaInvoiceStatus,
  auditLogs,
} from "@db/schema";
import { eq, and, desc, sql, like, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { buildAndPersistInvoice } from "./lib/zatca/invoicePipeline";

// ── money helpers ───────────────────────────────────────────────────────────

export const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Travel line calculation.
 *
 * Two pricing schemes are supported on every ticket line:
 *   • "standard" — the whole `unitPrice` is a single taxable amount.
 *   • "margin"   — the airline/supplier `baseFare` is NON-taxable while only
 *                  the agency `serviceFee` (markup / profit) attracts VAT.
 *
 * When the margin scheme runs in "inclusive" mode the entered serviceFee is
 * treated as the gross (VAT-inclusive) charge and the VAT is backed out of it;
 * in "exclusive" mode VAT is added on top.
 */
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
  /** Taxable amount (net of VAT) for this line. */
  taxable: number;
  /** Non-taxable amount (base fare) for this line. */
  nonTaxable: number;
  /** VAT for this line. */
  vat: number;
  /** Line grand total (non-taxable + taxable + VAT). */
  total: number;
  /** Display unit price (non-taxable + taxable) per unit. */
  unitPrice: number;
}

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
    return { quantity: qty, taxable, nonTaxable: 0, vat, total: r2(taxable + vat), unitPrice: r2(Number(item.unitPrice) || 0) };
  }
  const nonTaxable = r2(qty * (Number(item.baseFare) || 0));
  // Margin scheme profit: an explicit salePrice (sale − base) wins; otherwise
  // fall back to the raw serviceFee. VAT is charged ONLY on this profit.
  const basePerUnit = Number(item.baseFare) || 0;
  const feePerUnit = item.salePrice != null
    ? Math.max(0, (Number(item.salePrice) || 0) - basePerUnit)
    : (Number(item.serviceFee) || 0);
  const feeTotal = r2(qty * feePerUnit);
  let taxable: number;
  let vat: number;
  let total: number;
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
  return { quantity: qty, taxable, nonTaxable, vat, total, unitPrice };
}

const r2n = r2;

// ── shared input pieces ─────────────────────────────────────────────────────

const travelItemInput = z.object({
  description: z.string().min(1),
  descriptionAr: z.string().optional(),
  sku: z.string().optional(),
  /** PNR / ticket number printed under the description on the ticket. */
  ticketRef: z.string().optional(),
  /** e.g. "JED-MCT-BOM" */
  route: z.string().optional(),
  quantity: z.number().int().positive(),
  /** standard pricing */
  unitPrice: z.number().min(0).optional(),
  /** margin pricing — non-taxable airline/supplier cost (per unit) */
  baseFare: z.number().min(0).optional(),
  /** margin pricing — customer-facing sale price (per unit); profit = sale − base */
  salePrice: z.number().min(0).optional(),
  /** margin pricing — taxable agency service fee / profit (per unit) */
  serviceFee: z.number().min(0).optional(),
});

/** Next sequential ticket number for the tenant (prefix + zero-padded seq). */
async function nextInvoiceNumber(
  db: ReturnType<typeof getDb>,
  tenantId: number,
  prefix: string,
): Promise<string> {
  const rows = await db
    .select({ n: travelInvoices.invoiceNumber })
    .from(travelInvoices)
    .where(and(eq(travelInvoices.tenantId, tenantId), like(travelInvoices.invoiceNumber, `${prefix}%`)));
  let max = 0;
  for (const r of rows) {
    const m = String(r.n || "").match(/\d+/g);
    if (m) max = Math.max(max, Number(m.join("")) || 0);
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

export const travelRouter = createRouter({
  // ── Bookings (existing) ──────────────────────────────────────────────────
  bookingList: authedQuery
    .input(z.object({ status: z.string().optional(), bookingType: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const conditions = [eq(travelBookings.tenantId, ctx.user.tenantId!)];
      if (input?.status) conditions.push(eq(travelBookings.status, input.status as any));
      if (input?.bookingType) conditions.push(eq(travelBookings.bookingType, input.bookingType as any));
      return db.select().from(travelBookings).where(and(...conditions)).orderBy(desc(travelBookings.createdAt));
    }),

  bookingCreate: authedQuery
    .input(z.object({
      bookingNumber: z.string(),
      customerId: z.number(),
      bookingType: z.enum(["flight", "hotel", "package", "car_rental", "insurance", "visa"]),
      supplierId: z.number().optional(),
      bookingDate: z.string(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      grossAmount: z.string().optional(),
      commissionAmount: z.string().optional(),
      netAmount: z.string().optional(),
      paidAmount: z.string().optional(),
      currency: z.string().optional(),
      source: z.enum(["direct", "online", "partner", "corporate"]).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [{ id }] = await db.insert(travelBookings).values({ ...input, tenantId: ctx.user.tenantId!, createdBy: ctx.user.id }).$returningId();
      return { id, success: true };
    }),

  // ── Suppliers ────────────────────────────────────────────────────────────
  supplierList: authedQuery
    .input(z.object({ supplierType: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const conditions = [eq(travelSuppliers.tenantId, ctx.user.tenantId!)];
      if (input?.supplierType) conditions.push(eq(travelSuppliers.supplierType, input.supplierType as any));
      return db.select().from(travelSuppliers).where(and(...conditions));
    }),

  supplierCreate: authedQuery
    .input(z.object({
      code: z.string().optional(),
      name: z.string().min(1),
      supplierType: z.enum(["airline", "hotel", "car_rental", "insurance", "tour_operator", "visa", "other"]),
      contactPerson: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      commissionPercent: z.number().min(0).max(100).optional(),
      paymentTerms: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [{ id }] = await db.insert(travelSuppliers).values({
        ...input,
        tenantId: ctx.user.tenantId!,
        commissionPercent: input.commissionPercent != null ? String(input.commissionPercent) : undefined,
      }).$returningId();
      return { id, success: true };
    }),

  supplierUpdate: authedQuery
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      supplierType: z.enum(["airline", "hotel", "car_rental", "insurance", "tour_operator", "visa", "other"]).optional(),
      contactPerson: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      commissionPercent: z.number().optional(),
      paymentTerms: z.string().optional(),
      isActive: z.boolean().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const { id, commissionPercent, ...rest } = input;
      await db.update(travelSuppliers)
        .set({ ...rest, commissionPercent: commissionPercent != null ? String(commissionPercent) : undefined })
        .where(and(eq(travelSuppliers.id, id), eq(travelSuppliers.tenantId, ctx.user.tenantId!)));
      return { success: true };
    }),

  // ── Itineraries (existing) ───────────────────────────────────────────────
  itineraryList: authedQuery
    .input(z.object({ bookingId: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      return db.select().from(itineraries)
        .where(and(eq(itineraries.tenantId, ctx.user.tenantId!), eq(itineraries.bookingId, input.bookingId)))
        .orderBy(itineraries.day);
    }),

  // ── Reconciliation (existing) ────────────────────────────────────────────
  reconciliationList: authedQuery
    .input(z.object({ supplierId: z.number().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const conditions = [eq(supplierReconciliation.tenantId, ctx.user.tenantId!)];
      if (input?.supplierId) conditions.push(eq(supplierReconciliation.supplierId, input.supplierId));
      return db.select().from(supplierReconciliation).where(and(...conditions)).orderBy(desc(supplierReconciliation.createdAt));
    }),

  // ── Passengers directory ─────────────────────────────────────────────────
  passengerList: authedQuery
    .input(z.object({ search: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const conditions = [eq(travelPassengers.tenantId, ctx.user.tenantId!)];
      if (input?.search) {
        const q = `%${input.search}%`;
        conditions.push(or(like(travelPassengers.fullName, q), like(travelPassengers.passportNo, q), like(travelPassengers.phone, q))!);
      }
      return db.select().from(travelPassengers).where(and(...conditions)).orderBy(desc(travelPassengers.createdAt));
    }),

  passengerCreate: authedQuery
    .input(z.object({
      customerId: z.number().optional(),
      fullName: z.string().min(1),
      fullNameAr: z.string().optional(),
      passportNo: z.string().optional(),
      nationality: z.string().optional(),
      dateOfBirth: z.string().optional(),
      passportExpiry: z.string().optional(),
      gender: z.enum(["male", "female"]).optional(),
      phone: z.string().optional(),
      whatsapp: z.string().optional(),
      email: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [{ id }] = await db.insert(travelPassengers).values({ ...input, tenantId: ctx.user.tenantId! }).$returningId();
      return { id, success: true };
    }),

  passengerUpdate: authedQuery
    .input(z.object({
      id: z.number(),
      fullName: z.string().optional(),
      fullNameAr: z.string().optional(),
      passportNo: z.string().optional(),
      nationality: z.string().optional(),
      dateOfBirth: z.string().optional(),
      passportExpiry: z.string().optional(),
      gender: z.enum(["male", "female"]).optional(),
      phone: z.string().optional(),
      whatsapp: z.string().optional(),
      email: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const { id, ...rest } = input;
      await db.update(travelPassengers).set(rest)
        .where(and(eq(travelPassengers.id, id), eq(travelPassengers.tenantId, ctx.user.tenantId!)));
      return { success: true };
    }),

  // ── Umrah / Tour packages ────────────────────────────────────────────────
  packageList: authedQuery
    .input(z.object({ packageType: z.string().optional(), activeOnly: z.boolean().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const conditions = [eq(travelPackages.tenantId, ctx.user.tenantId!)];
      if (input?.packageType) conditions.push(eq(travelPackages.packageType, input.packageType as any));
      if (input?.activeOnly) conditions.push(eq(travelPackages.isActive, true));
      return db.select().from(travelPackages).where(and(...conditions)).orderBy(desc(travelPackages.createdAt));
    }),

  packageCreate: authedQuery
    .input(z.object({
      code: z.string().optional(),
      name: z.string().min(1),
      nameAr: z.string().optional(),
      packageType: z.enum(["umrah", "hajj", "tour", "holiday", "corporate"]).optional(),
      supplierId: z.number().optional(),
      durationDays: z.number().optional(),
      nightsMakkah: z.number().optional(),
      nightsMadinah: z.number().optional(),
      costPrice: z.number().min(0).optional(),
      sellingPrice: z.number().min(0).optional(),
      currency: z.string().optional(),
      includes: z.string().optional(),
      excludes: z.string().optional(),
      itineraryNotes: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const { costPrice, sellingPrice, ...rest } = input;
      const [{ id }] = await db.insert(travelPackages).values({
        ...rest,
        tenantId: ctx.user.tenantId!,
        costPrice: costPrice != null ? String(costPrice) : undefined,
        sellingPrice: sellingPrice != null ? String(sellingPrice) : undefined,
        createdBy: ctx.user.id,
      }).$returningId();
      return { id, success: true };
    }),

  packageUpdate: authedQuery
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      nameAr: z.string().optional(),
      packageType: z.enum(["umrah", "hajj", "tour", "holiday", "corporate"]).optional(),
      durationDays: z.number().optional(),
      nightsMakkah: z.number().optional(),
      nightsMadinah: z.number().optional(),
      costPrice: z.number().optional(),
      sellingPrice: z.number().optional(),
      includes: z.string().optional(),
      excludes: z.string().optional(),
      isActive: z.boolean().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const { id, costPrice, sellingPrice, ...rest } = input;
      await db.update(travelPackages)
        .set({ ...rest, costPrice: costPrice != null ? String(costPrice) : undefined, sellingPrice: sellingPrice != null ? String(sellingPrice) : undefined })
        .where(and(eq(travelPackages.id, id), eq(travelPackages.tenantId, ctx.user.tenantId!)));
      return { success: true };
    }),

  // ── Visa processing ──────────────────────────────────────────────────────
  visaList: authedQuery
    .input(z.object({ status: z.string().optional(), visaType: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const conditions = [eq(travelVisas.tenantId, ctx.user.tenantId!)];
      if (input?.status) conditions.push(eq(travelVisas.status, input.status as any));
      if (input?.visaType) conditions.push(eq(travelVisas.visaType, input.visaType as any));
      return db.select().from(travelVisas).where(and(...conditions)).orderBy(desc(travelVisas.createdAt));
    }),

  visaCreate: authedQuery
    .input(z.object({
      referenceNumber: z.string().optional(),
      passengerId: z.number().optional(),
      customerId: z.number().optional(),
      passengerName: z.string().min(1),
      passportNo: z.string().optional(),
      nationality: z.string().optional(),
      visaType: z.enum(["umrah", "visit", "work", "business", "transit", "hajj", "other"]).optional(),
      visaCountry: z.string().optional(),
      supplierId: z.number().optional(),
      applicationDate: z.string().optional(),
      issueDate: z.string().optional(),
      expiryDate: z.string().optional(),
      costAmount: z.number().min(0).optional(),
      feeAmount: z.number().min(0).optional(),
      currency: z.string().optional(),
      status: z.enum(["draft", "submitted", "processing", "approved", "rejected", "issued", "cancelled"]).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const { costAmount, feeAmount, ...rest } = input;
      const [{ id }] = await db.insert(travelVisas).values({
        ...rest,
        tenantId: ctx.user.tenantId!,
        costAmount: costAmount != null ? String(costAmount) : undefined,
        feeAmount: feeAmount != null ? String(feeAmount) : undefined,
        createdBy: ctx.user.id,
      }).$returningId();
      return { id, success: true };
    }),

  visaUpdate: authedQuery
    .input(z.object({
      id: z.number(),
      visaType: z.enum(["umrah", "visit", "work", "business", "transit", "hajj", "other"]).optional(),
      issueDate: z.string().optional(),
      expiryDate: z.string().optional(),
      costAmount: z.number().optional(),
      feeAmount: z.number().optional(),
      status: z.enum(["draft", "submitted", "processing", "approved", "rejected", "issued", "cancelled"]).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const { id, costAmount, feeAmount, ...rest } = input;
      await db.update(travelVisas)
        .set({ ...rest, costAmount: costAmount != null ? String(costAmount) : undefined, feeAmount: feeAmount != null ? String(feeAmount) : undefined })
        .where(and(eq(travelVisas.id, id), eq(travelVisas.tenantId, ctx.user.tenantId!)));
      return { success: true };
    }),

  // ── Hotel bookings ───────────────────────────────────────────────────────
  hotelList: authedQuery
    .input(z.object({ status: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const conditions = [eq(travelHotels.tenantId, ctx.user.tenantId!)];
      if (input?.status) conditions.push(eq(travelHotels.status, input.status as any));
      return db.select().from(travelHotels).where(and(...conditions)).orderBy(desc(travelHotels.createdAt));
    }),

  hotelCreate: authedQuery
    .input(z.object({
      bookingRef: z.string().optional(),
      customerId: z.number().optional(),
      passengerName: z.string().min(1),
      hotelName: z.string().min(1),
      hotelCity: z.string().optional(),
      roomType: z.string().optional(),
      rooms: z.number().optional(),
      guests: z.number().optional(),
      checkIn: z.string().optional(),
      checkOut: z.string().optional(),
      nights: z.number().optional(),
      supplierId: z.number().optional(),
      costAmount: z.number().min(0).optional(),
      sellingAmount: z.number().min(0).optional(),
      currency: z.string().optional(),
      status: z.enum(["draft", "confirmed", "cancelled", "completed"]).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const { costAmount, sellingAmount, ...rest } = input;
      const [{ id }] = await db.insert(travelHotels).values({
        ...rest,
        tenantId: ctx.user.tenantId!,
        costAmount: costAmount != null ? String(costAmount) : undefined,
        sellingAmount: sellingAmount != null ? String(sellingAmount) : undefined,
        createdBy: ctx.user.id,
      }).$returningId();
      return { id, success: true };
    }),

  hotelUpdate: authedQuery
    .input(z.object({
      id: z.number(),
      status: z.enum(["draft", "confirmed", "cancelled", "completed"]).optional(),
      costAmount: z.number().optional(),
      sellingAmount: z.number().optional(),
      checkIn: z.string().optional(),
      checkOut: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const { id, costAmount, sellingAmount, ...rest } = input;
      await db.update(travelHotels)
        .set({ ...rest, costAmount: costAmount != null ? String(costAmount) : undefined, sellingAmount: sellingAmount != null ? String(sellingAmount) : undefined })
        .where(and(eq(travelHotels.id, id), eq(travelHotels.tenantId, ctx.user.tenantId!)));
      return { success: true };
    }),

  // ── Dashboard ────────────────────────────────────────────────────────────
  travelDashboard: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const tenantId = ctx.user.tenantId!;
    const [bookings] = await db.select({ count: sql<number>`count(*)` }).from(travelBookings).where(eq(travelBookings.tenantId, tenantId));
    const [confirmed] = await db.select({ count: sql<number>`count(*)` }).from(travelBookings).where(and(eq(travelBookings.tenantId, tenantId), eq(travelBookings.status, "confirmed")));
    const [sup] = await db.select({ count: sql<number>`count(*)` }).from(travelSuppliers).where(eq(travelSuppliers.tenantId, tenantId));
    const [tickets] = await db.select({ count: sql<number>`count(*)` }).from(travelInvoices).where(eq(travelInvoices.tenantId, tenantId));
    const [pax] = await db.select({ count: sql<number>`count(*)` }).from(travelPassengers).where(eq(travelPassengers.tenantId, tenantId));
    const [visas] = await db.select({ count: sql<number>`count(*)` }).from(travelVisas).where(eq(travelVisas.tenantId, tenantId));
    const [pkgs] = await db.select({ count: sql<number>`count(*)` }).from(travelPackages).where(eq(travelPackages.tenantId, tenantId));
    const [zatcaCnt] = await db.select({ count: sql<number>`count(*)` }).from(travelInvoices)
      .where(and(eq(travelInvoices.tenantId, tenantId), eq(travelInvoices.mode, "zatca")));
    const [nonTaxCnt] = await db.select({ count: sql<number>`count(*)` }).from(travelInvoices)
      .where(and(eq(travelInvoices.tenantId, tenantId), eq(travelInvoices.mode, "non_tax")));
    const pkgSales = await db.select({
      total: sql<number>`COALESCE(SUM(CAST(${travelPackages.sellingPrice} AS DECIMAL(18,2))),0)`,
    }).from(travelPackages).where(eq(travelPackages.tenantId, tenantId));
    const supPay = await db.select({
      total: sql<number>`COALESCE(SUM(CAST(${supplierReconciliation.balanceDue} AS DECIMAL(18,2))),0)`,
    }).from(supplierReconciliation)
      .where(and(eq(supplierReconciliation.tenantId, tenantId), sql`${supplierReconciliation.status} <> 'paid'`));
    const rev = await db.select({
      total: sql<number>`COALESCE(SUM(CAST(${travelInvoices.totalAmount} AS DECIMAL(18,2))),0)`,
      tax: sql<number>`COALESCE(SUM(CAST(${travelInvoices.taxAmount} AS DECIMAL(18,2))),0)`,
      profit: sql<number>`COALESCE(SUM(CAST(${travelInvoices.taxableAmount} AS DECIMAL(18,2))),0)`,
      due: sql<number>`COALESCE(SUM(CAST(${travelInvoices.balanceDue} AS DECIMAL(18,2))),0)`,
    }).from(travelInvoices).where(and(eq(travelInvoices.tenantId, tenantId), sql`${travelInvoices.status} NOT IN ('cancelled','refunded')`));
    const upcoming = await db.select().from(travelInvoices)
      .where(and(eq(travelInvoices.tenantId, tenantId), sql`${travelInvoices.departDate} >= CURDATE()`))
      .orderBy(travelInvoices.departDate).limit(8);
    const recent = await db.select().from(travelInvoices).where(eq(travelInvoices.tenantId, tenantId)).orderBy(desc(travelInvoices.createdAt)).limit(8);
    return {
      totalBookings: Number(bookings?.count || 0),
      confirmedBookings: Number(confirmed?.count || 0),
      totalSuppliers: Number(sup?.count || 0),
      totalTickets: Number(tickets?.count || 0),
      totalPassengers: Number(pax?.count || 0),
      totalVisas: Number(visas?.count || 0),
      totalPackages: Number(pkgs?.count || 0),
      zatcaCount: Number(zatcaCnt?.count || 0),
      nonTaxCount: Number(nonTaxCnt?.count || 0),
      packageSales: Number(pkgSales[0]?.total || 0),
      supplierPayables: Number(supPay[0]?.total || 0),
      revenue: Number(rev[0]?.total || 0),
      taxCollected: Number(rev[0]?.tax || 0),
      profit: Number(rev[0]?.profit || 0),
      outstanding: Number(rev[0]?.due || 0),
      upcoming,
      recent,
    };
  }),

  travelStats: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const tenantId = ctx.user.tenantId!;
    const [totalBookings] = await db.select({ count: sql<number>`count(*)` }).from(travelBookings).where(eq(travelBookings.tenantId, tenantId));
    const [confirmedBookings] = await db.select({ count: sql<number>`count(*)` }).from(travelBookings).where(and(eq(travelBookings.tenantId, tenantId), eq(travelBookings.status, "confirmed")));
    const [totalSuppliers] = await db.select({ count: sql<number>`count(*)` }).from(travelSuppliers).where(eq(travelSuppliers.tenantId, tenantId));
    const [totalTickets] = await db.select({ count: sql<number>`count(*)` }).from(travelInvoices).where(eq(travelInvoices.tenantId, tenantId));
    const ticketsRevenue = await db.select({ total: sql<number>`COALESCE(SUM(CAST(${travelInvoices.totalAmount} AS DECIMAL(18,2))),0)` })
      .from(travelInvoices).where(eq(travelInvoices.tenantId, tenantId));
    return {
      totalBookings: Number(totalBookings?.count || 0),
      confirmedBookings: Number(confirmedBookings?.count || 0),
      totalSuppliers: Number(totalSuppliers?.count || 0),
      totalTickets: Number(totalTickets?.count || 0),
      ticketsRevenue: Number(ticketsRevenue[0]?.total || 0),
    };
  }),

  // ── Travel tenant settings (Ministry of Tourism license, branding) ───────
  settingsGet: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const [settings] = await db.select().from(travelSettings).where(eq(travelSettings.tenantId, ctx.user.tenantId!)).limit(1);
    const [company] = await db.select().from(companySettings).where(eq(companySettings.tenantId, ctx.user.tenantId!)).limit(1);
    return { settings: settings ?? null, company: company ?? null };
  }),

  settingsUpdate: authedQuery
    .input(z.object({
      tourismLicenseNo: z.string().optional(),
      tourismLicenseTypeAr: z.string().optional(),
      tourismLicenseTypeEn: z.string().optional(),
      tagline: z.string().optional(),
      taglineAr: z.string().optional(),
      defaultCurrency: z.string().optional(),
      defaultVatPercent: z.number().min(0).max(100).optional(),
      invoicePrefix: z.string().optional(),
      notes: z.string().optional(),
      // company-profile fields used on the ticket letterhead
      companyName: z.string().optional(),
      companyNameAr: z.string().optional(),
      phone: z.string().optional(),
      taxNumber: z.string().optional(),
      logo: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.user.tenantId!;
      const { defaultVatPercent, companyName, companyNameAr, phone, taxNumber, logo, ...rest } = input;
      const patch: Record<string, any> = { ...rest };
      if (defaultVatPercent != null) patch.defaultVatPercent = String(defaultVatPercent);
      const existing = await db.query.travelSettings.findFirst({ where: eq(travelSettings.tenantId, tenantId) });
      if (existing) await db.update(travelSettings).set(patch).where(eq(travelSettings.id, existing.id));
      else await db.insert(travelSettings).values({ tenantId, ...patch });

      const companyPatch: Record<string, any> = {};
      if (companyName !== undefined) companyPatch.companyName = companyName;
      if (companyNameAr !== undefined) companyPatch.companyNameAr = companyNameAr;
      if (phone !== undefined) companyPatch.phone = phone;
      if (taxNumber !== undefined) companyPatch.taxNumber = taxNumber;
      if (logo !== undefined) companyPatch.logo = logo;
      if (Object.keys(companyPatch).length) {
        const [company] = await db.select().from(companySettings).where(eq(companySettings.tenantId, tenantId)).limit(1);
        if (company) await db.update(companySettings).set(companyPatch).where(eq(companySettings.id, company.id));
        else await db.insert(companySettings).values({ tenantId, ...companyPatch });
      }
      return { success: true };
    }),

  // ── Create Ticket / Invoice (dual-mode + margin scheme) ──────────────────
  //
  // mode "zatca"   → parent invoices row = "simplified"; the shared ZATCA
  //                  Phase-2 pipeline signs it (UUID/ICV/hash chain/XAdES/QR).
  // mode "non_tax" → parent invoices row = "standard" (no ZATCA XML/QR); the
  //                  caller picks the VAT rate manually (0 = non-tax invoice).
  //
  // pricingMode "margin"   → only the agency service fee is taxable (the base
  //                          airline/supplier fare stays non-taxable).
  // pricingMode "standard"  → the whole unit price is taxable.
  ticketCreate: authedQuery
    .input(z.object({
      mode: z.enum(["zatca", "non_tax"]),
      pricingMode: z.enum(["standard", "margin"]).optional(),
      vatMode: z.enum(["exclusive", "inclusive"]).optional(),
      /** manual VAT % for non_tax mode (0 = non-tax invoice). */
      vatPercent: z.number().min(0).max(100).optional(),
      customerId: z.number().optional(),
      customerName: z.string().optional(),
      customerNameAr: z.string().optional(),
      customerPhone: z.string().optional(),
      customerVat: z.string().optional(),
      bookingId: z.number().optional(),
      bookingNumber: z.string().optional(),
      travelType: z.enum(["flight", "hotel", "package", "car_rental", "insurance", "visa", "other"]).optional(),
      serviceRef: z.string().optional(),
      pnr: z.string().optional(),
      ticketNumber: z.string().optional(),
      origin: z.string().optional(),
      destination: z.string().optional(),
      departDate: z.string().optional(),
      arriveDate: z.string().optional(),
      passengerName: z.string().optional(),
      passengerNameAr: z.string().optional(),
      date: z.string(),
      dueDate: z.string().optional(),
      paidAmount: z.number().min(0).optional(),
      paymentMethod: z.string().optional(),
      notes: z.string().optional(),
      notesAr: z.string().optional(),
      items: z.array(travelItemInput).min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.user.tenantId!;
      const [tSettings] = await db.select().from(travelSettings).where(eq(travelSettings.tenantId, tenantId)).limit(1);
      const [company] = await db.select().from(companySettings).where(eq(companySettings.tenantId, tenantId)).limit(1);

      if (input.mode === "zatca" && !/^\d{15}$/.test(String(company?.taxNumber || ""))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "ZATCA mode needs a valid 15-digit VAT number in Settings → Company Profile.",
        });
      }

      const pricingMode: PricingMode = input.pricingMode || "margin";
      const vatMode: VatMode = input.vatMode || "exclusive";
      const vatPercent = input.mode === "zatca" ? 15 : Number(input.vatPercent ?? tSettings?.defaultVatPercent ?? 15);
      const prefix = tSettings?.invoicePrefix || "TICK-";
      const currency = tSettings?.defaultCurrency || company?.defaultCurrency || "SAR";
      const invoiceNumber = await nextInvoiceNumber(db, tenantId, prefix);

      const computed = input.items.map((it) => ({ it, c: calcTravelLine(it, pricingMode, vatMode, vatPercent) }));
      let nonTaxableAmount = 0, taxableAmount = 0, taxAmount = 0, totalAmount = 0;
      for (const { c } of computed) {
        nonTaxableAmount = r2n(nonTaxableAmount + c.nonTaxable);
        taxableAmount = r2n(taxableAmount + c.taxable);
        taxAmount = r2n(taxAmount + c.vat);
        totalAmount = r2n(totalAmount + c.total);
      }
      const subTotal = r2n(nonTaxableAmount + taxableAmount);
      const paidAmount = r2n(input.paidAmount || 0);
      const balanceDue = r2n(totalAmount - paidAmount);

      // Resolve / auto-create the customer (walk-in supported)
      let customerId = input.customerId || null;
      if (!customerId && (input.customerName || input.customerNameAr || input.customerPhone)) {
        const [{ id: wid }] = await db.insert(customers).values({
          tenantId,
          name: input.customerName || input.customerNameAr || "Walk-in Customer",
          nameAr: input.customerNameAr || undefined,
          phone: input.customerPhone || undefined,
          vatNumber: input.customerVat || undefined,
        }).$returningId();
        customerId = wid;
      }

      // 1) travel_invoices document row
      const [{ id: travelId }] = await db.insert(travelInvoices).values({
        tenantId,
        invoiceNumber,
        mode: input.mode,
        pricingMode,
        vatMode,
        vatPercent: String(vatPercent),
        customerId,
        customerName: input.customerName,
        customerNameAr: input.customerNameAr,
        customerPhone: input.customerPhone,
        customerVat: input.customerVat,
        bookingId: input.bookingId,
        bookingNumber: input.bookingNumber,
        travelType: input.travelType || "other",
        serviceRef: input.serviceRef,
        pnr: input.pnr,
        ticketNumber: input.ticketNumber,
        origin: input.origin,
        destination: input.destination,
        departDate: input.departDate || undefined,
        arriveDate: input.arriveDate || undefined,
        passengerName: input.passengerName,
        passengerNameAr: input.passengerNameAr,
        date: input.date,
        dueDate: input.dueDate || undefined,
        currency,
        subTotal: String(subTotal),
        nonTaxableAmount: String(nonTaxableAmount),
        taxableAmount: String(taxableAmount),
        taxAmount: String(taxAmount),
        totalAmount: String(totalAmount),
        paidAmount: String(paidAmount),
        balanceDue: String(balanceDue),
        paymentMethod: input.paymentMethod,
        notes: input.notes,
        notesAr: input.notesAr,
        status: "issued",
        createdBy: ctx.user.id,
      }).$returningId();

      // 2) shared invoices row (finance record + ZATCA anchor)
      const invoiceType = input.mode === "zatca" ? "simplified" : "standard";
      const now = new Date();
      const [{ id: invoiceId }] = await db.insert(invoices).values({
        tenantId,
        invoiceNumber,
        invoiceType,
        customerId: customerId || 0,
        date: input.date,
        dueDate: input.dueDate || undefined,
        time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:00`,
        subTotal: String(subTotal),
        discountAmount: "0",
        taxAmount: String(taxAmount),
        taxPercent: String(vatPercent),
        totalAmount: String(totalAmount),
        paidAmount: String(paidAmount),
        balanceDue: String(balanceDue),
        customerName: input.customerName,
        customerNameAr: input.customerNameAr,
        customerPhone: input.customerPhone,
        customerVat: input.customerVat,
        paymentMethod: input.paymentMethod,
        notes: input.notes,
        notesAr: input.notesAr,
        status: "sent",
        createdBy: ctx.user.id,
      }).$returningId();

      // 3) invoice_items rows — the ZATCA pipeline signs exactly these lines.
      //    Margin scheme emits a zero-rated base-fare line + a standard fee
      //    line so the signed totals reconcile with the printed ticket.
      const itemIdsByLine: number[][] = [];
      for (let i = 0; i < computed.length; i++) {
        const { it, c } = computed[i];
        const ids: number[] = [];
        if (pricingMode === "margin" && c.nonTaxable > 0) {
          const [{ id }] = await db.insert(invoiceItems).values({
            invoiceId,
            description: `${it.description} — base fare (non-taxable)`,
            descriptionAr: it.descriptionAr ? `${it.descriptionAr} — أجرة أساسية` : undefined,
            sku: it.sku,
            quantity: 1,
            unitPrice: String(c.nonTaxable),
            discountPercent: "0",
            taxPercent: "0",
            taxCategory: "Z",
            exemptionReason: "Non-taxable airline/Supplier cost (disbursement)",
            totalAmount: String(c.nonTaxable),
            travelInvoiceId: travelId,
            ticketRef: it.ticketRef,
          }).$returningId();
          ids.push(id);
        }
        const [{ id }] = await db.insert(invoiceItems).values({
          invoiceId,
          description: it.description,
          descriptionAr: it.descriptionAr,
          sku: it.sku,
          quantity: 1,
          unitPrice: String(c.taxable),
          discountPercent: "0",
          taxPercent: String(vatPercent),
          taxCategory: vatPercent === 0 ? "Z" : "S",
          exemptionReason: vatPercent === 0 ? "Non-tax invoice (manual 0% VAT rate)" : undefined,
          totalAmount: String(r2n(c.taxable + c.vat)),
          travelInvoiceId: travelId,
          ticketRef: it.ticketRef,
        }).$returningId();
        ids.push(id);
        itemIdsByLine.push(ids);
      }

      // 4) travel_invoice_items rows (ticket layout keeps ticketRef/route)
      for (let i = 0; i < computed.length; i++) {
        const { it, c } = computed[i];
        const baseUnit = Number(it.baseFare) || 0;
        const feeUnit = it.salePrice != null ? Math.max(0, (Number(it.salePrice) || 0) - baseUnit) : (Number(it.serviceFee) || 0);
        await db.insert(travelInvoiceItems).values({
          tenantId,
          travelInvoiceId: travelId,
          invoiceItemId: itemIdsByLine[i][itemIdsByLine[i].length - 1],
          sku: it.sku,
          description: it.description,
          descriptionAr: it.descriptionAr,
          ticketRef: it.ticketRef,
          route: it.route,
          quantity: c.quantity,
          unitPrice: String(c.unitPrice),
          baseFare: String(r2n(baseUnit)),
          serviceFee: String(r2n(feeUnit)),
          nonTaxableAmount: String(c.nonTaxable),
          taxPercent: String(vatPercent),
          taxableAmount: String(c.taxable),
          taxAmount: String(c.vat),
          totalAmount: String(c.total),
        });
      }

      // link back
      await db.update(travelInvoices).set({ invoiceId }).where(eq(travelInvoices.id, travelId));
      await db.update(invoices).set({ travelInvoiceId: travelId }).where(eq(invoices.id, invoiceId));

      // 5) ZATCA Phase-2 finalisation for zatca mode. Never blocks the sale.
      let zatca: { uuid?: string; icv?: number; invoiceHash?: string; signatureMode?: string; qr?: string; warnings?: string[] } | null = null;
      let zatcaError: string | null = null;
      if (input.mode === "zatca") {
        try {
          const res = await buildAndPersistInvoice({
            tenantId,
            invoiceId,
            documentType: "simplified",
            environment: company?.zatcaSandbox === false ? "production" : "sandbox",
          });
          zatca = { uuid: res.uuid, icv: res.icv, invoiceHash: res.invoiceHash, signatureMode: res.signatureMode, qr: res.qr, warnings: res.warnings };
        } catch (e: any) {
          zatcaError = String(e?.message || e);
          console.error("[travel] ZATCA signing failed for ticket", travelId, zatcaError);
        }
      }

      await db.insert(auditLogs).values({
        tenantId,
        userId: ctx.user.id,
        action: "travel_ticket_create",
        entityType: "travel_invoice",
        entityId: travelId,
        newValues: { invoiceNumber, mode: input.mode, pricingMode, vatPercent, totalAmount },
        createdAt: new Date(),
      });

      return { travelInvoiceId: travelId, invoiceId, invoiceNumber, totals: { nonTaxableAmount, taxableAmount, taxAmount, totalAmount }, zatca, zatcaError };
    }),

  // ── Ticket list / get / cancel ───────────────────────────────────────────
  ticketList: authedQuery
    .input(z.object({ status: z.string().optional(), mode: z.enum(["zatca", "non_tax"]).optional() }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const conditions = [eq(travelInvoices.tenantId, ctx.user.tenantId!)];
      if (input?.status) conditions.push(eq(travelInvoices.status, input.status as any));
      if (input?.mode) conditions.push(eq(travelInvoices.mode, input.mode));
      return db.select().from(travelInvoices).where(and(...conditions)).orderBy(desc(travelInvoices.createdAt));
    }),

  ticketGet: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.user.tenantId!;
      const doc = await db.query.travelInvoices.findFirst({
        where: and(eq(travelInvoices.id, input.id), eq(travelInvoices.tenantId, tenantId)),
      });
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Travel invoice not found" });

      const items = await db.query.travelInvoiceItems.findMany({
        where: eq(travelInvoiceItems.travelInvoiceId, doc.id),
      });

      let invoice: any = null;
      let zatcaStatus: any = null;
      if (doc.invoiceId) {
        invoice = await db.query.invoices.findFirst({
          where: and(eq(invoices.id, doc.invoiceId), eq(invoices.tenantId, tenantId)),
        });
        zatcaStatus = await db.query.zatcaInvoiceStatus.findFirst({
          where: and(eq(zatcaInvoiceStatus.tenantId, tenantId), eq(zatcaInvoiceStatus.invoiceId, doc.invoiceId)),
        });
      }

      const [company] = await db.select().from(companySettings).where(eq(companySettings.tenantId, tenantId)).limit(1);
      const [tSettings] = await db.select().from(travelSettings).where(eq(travelSettings.tenantId, tenantId)).limit(1);
      const customer = doc.customerId
        ? await db.query.customers.findFirst({ where: and(eq(customers.id, doc.customerId), eq(customers.tenantId, tenantId)) })
        : null;

      return { doc: doc!, items, invoice, zatcaStatus, company: company ?? null, travelSettings: tSettings ?? null, customer: customer ?? null };
    }),

  ticketCancel: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.user.tenantId!;
      const doc = await db.query.travelInvoices.findFirst({
        where: and(eq(travelInvoices.id, input.id), eq(travelInvoices.tenantId, tenantId)),
      });
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Travel invoice not found" });
      if (doc.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "Already cancelled" });
      await db.update(travelInvoices).set({ status: "cancelled" }).where(eq(travelInvoices.id, doc.id));
      if (doc.invoiceId) await db.update(invoices).set({ status: "cancelled" }).where(eq(invoices.id, doc.invoiceId));
      return { success: true };
    }),
});

import { createHash } from "node:crypto";
import { getDb } from "../../queries/connection";
import { and, desc, eq } from "drizzle-orm";
import { zatcaInvoiceStatus } from "@db/schema";

/**
 * ZATCA Phase 2 hash chain.
 *
 * Rules (Security Features Implementation Standards):
 *  - The first invoice's PIH is base64(SHA-256("0")).
 *  - Every following PIH is simply the previous invoice's hash
 *    (it is NOT re-hashed with the current invoice).
 *  - ICV is a strictly sequential counter per tenant/EGS device.
 *
 * The production path is `allocateCounter()` in ./phase2.ts (advisory lock +
 * MAX(icv)+1). These helpers exist for callers that need the same semantics.
 */

export const EMPTY_HASH = createHash("sha256").update("0").digest("base64");

function sha256Base64(value: string): string {
  return createHash("sha256").update(value, "utf-8").digest("base64");
}

function canonicalize(xml: string): string {
  return xml
    .replace(/<\?xml[^?]*\?>/gi, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/>\s+</g, "><")
    .trim();
}

export function computeInvoiceXmlHash(xml: string): string {
  return sha256Base64(canonicalize(xml));
}

/**
 * PIH(n) = invoiceHash(n-1). The `currentInvoiceHash` argument is kept for
 * backwards compatibility but intentionally ignored — mixing it in breaks
 * ZATCA chain verification.
 */
export function computePih(
  previousInvoiceHash: string | null,
  _currentInvoiceHash?: string,
): string {
  return previousInvoiceHash && previousInvoiceHash.length > 0
    ? previousInvoiceHash
    : EMPTY_HASH;
}

export async function getLastInvoiceHash(tenantId: number): Promise<string | null> {
  const db = getDb();
  const last = await db.query.zatcaInvoiceStatus.findFirst({
    where: and(eq(zatcaInvoiceStatus.tenantId, tenantId)),
    orderBy: desc(zatcaInvoiceStatus.invoiceCounter),
  });
  return last?.invoiceHash || null;
}

export async function getOrCreatePihChain(tenantId: number): Promise<{
  previousInvoiceHash: string;
  invoiceCounter: number;
}> {
  const db = getDb();
  const lastStatus = await db.query.zatcaInvoiceStatus.findFirst({
    where: and(eq(zatcaInvoiceStatus.tenantId, tenantId)),
    orderBy: desc(zatcaInvoiceStatus.invoiceCounter),
  });

  return {
    previousInvoiceHash: lastStatus?.invoiceHash || EMPTY_HASH,
    invoiceCounter: Number(lastStatus?.invoiceCounter || 0) + 1,
  };
}

export async function recordInvoiceHash(
  tenantId: number,
  invoiceId: number,
  invoiceHash: string,
  previousInvoiceHash: string,
  invoiceCounter: number,
  invoiceUuid: string,
): Promise<void> {
  const db = getDb();
  const existing = await db.query.zatcaInvoiceStatus.findFirst({
    where: and(
      eq(zatcaInvoiceStatus.tenantId, tenantId),
      eq(zatcaInvoiceStatus.invoiceId, invoiceId),
    ),
  });
  const values = {
    invoiceHash,
    previousInvoiceHash,
    invoiceCounter,
    invoiceUuid,
    status: "pending" as const,
    updatedAt: new Date(),
  };
  if (existing) {
    await db.update(zatcaInvoiceStatus).set(values).where(eq(zatcaInvoiceStatus.id, existing.id));
  } else {
    await db.insert(zatcaInvoiceStatus).values({ tenantId, invoiceId, ...values });
  }
}
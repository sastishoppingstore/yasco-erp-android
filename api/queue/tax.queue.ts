import { getDb } from "../queries/connection";
import * as schema from "@db/schema";
import { eq } from "drizzle-orm";
import { createQueue, createWorker, QUEUES } from "./config";
import { submitInvoice, retryFailedSubmission } from "../lib/zatca/clearance";

const queue = createQueue(QUEUES.taxCompliance.name, {
  attempts: 5,
  backoff: { type: "exponential", delay: 30000 },
});

export type TaxJobData = {
  type: "zatca-clearance" | "zatca-reporting" | "fbr-submit" | "uae-vat-return";
  tenantId: number;
  invoiceId?: number;
  submissionId?: number;
};

async function processSubmission(job: { data: TaxJobData }): Promise<{ status: string; zatcaRequestId?: string }> {
  const { type, tenantId, invoiceId } = job.data;
  const db = getDb();

  if (type === "zatca-clearance" || type === "zatca-reporting") {
    const credential = await db.query.zatcaCredentials.findFirst({
      where: eq(schema.zatcaCredentials.tenantId, tenantId),
    });

    if (!credential) throw new Error("ZATCA credentials not configured for tenant");
    if (type === "zatca-clearance" && !credential.productionCsidEncrypted) {
      throw new Error("Production CSID not available for clearance");
    }

    if (!invoiceId) throw new Error("Invoice ID required for ZATCA submission");

    const mode = type === "zatca-clearance" ? "clearance" : "reporting";
    const result = await submitInvoice({
      tenantId,
      invoiceId,
      mode,
      environment: credential.environment === "production" ? "production" : "sandbox",
    });

    if (result.status === "rejected" || result.status === "failed") {
      // Only retry transient failures; a 400 rejection is permanent.
      const error: any = new Error(result.errorMessage || `ZATCA ${mode} failed`);
      error.retryable = result.retryable === true;
      throw error;
    }

    return { status: result.status, zatcaRequestId: result.zatcaRequestId };
  }

  return { status: "submitted" };
}

const worker = createWorker<TaxJobData>(QUEUES.taxCompliance.name, processSubmission, {
  concurrency: QUEUES.taxCompliance.concurrency,
});

worker.on("completed", (job) => {
  console.log(`[tax] job ${job.id} completed (${job.data.type})`);
});

worker.on("failed", (job, err) => {
  console.error(`[tax] job ${job?.id} failed:`, err.message);
});

export async function submitTaxJob(data: TaxJobData): Promise<void> {
  await queue.add("zatca-submit", data, {
    priority: data.type === "zatca-clearance" ? 1 : 2,
  });
}

export { queue as taxQueue, worker as taxWorker };

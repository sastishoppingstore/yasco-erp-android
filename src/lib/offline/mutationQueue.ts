import Dexie, { type Table } from "dexie";

/**
 * Offline write queue for the Android app.
 *
 * Every tRPC *mutation* that cannot reach the server (no network, or the
 * loopback proxy answered 503 because the hosted ERP was unreachable) is
 * stored here with its exact request body.  When connectivity comes back the
 * queue is replayed in the original order, one request at a time.
 *
 * Ordering matters in an ERP: an invoice line must be created after its
 * invoice, a payment after the invoice it settles.  The first failing request
 * therefore stops the flush instead of letting later requests overtake it.
 */

export type QueueStatus = "pending" | "failed";

export interface QueuedMutation {
  id?: number;
  /** url + body, used to avoid queueing the same click twice */
  fingerprint: string;
  url: string;
  body: string;
  /** tRPC procedure names, e.g. ["sales.create"] */
  methods: string[];
  at: number;
  attempts: number;
  status: QueueStatus;
  lastError?: string;
}

export interface QueueState {
  pending: number;
  failed: number;
  flushing: boolean;
  lastFlushAt: number | null;
  lastError: string | null;
}

const MAX_QUEUE = 500;

class QueueDb extends Dexie {
  items!: Table<QueuedMutation, number>;

  constructor() {
    super("erp-offline-queue");
    this.version(1).stores({
      items: "++id, fingerprint, status, at",
    });
  }
}

let db: QueueDb | null = null;
let dbFailed = false;

function getDb(): QueueDb | null {
  if (dbFailed) return null;
  if (db) return db;
  try {
    if (typeof indexedDB === "undefined") {
      dbFailed = true;
      return null;
    }
    db = new QueueDb();
    return db;
  } catch {
    dbFailed = true;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Observable state
// ---------------------------------------------------------------------------

let state: QueueState = {
  pending: 0,
  failed: 0,
  flushing: false,
  lastFlushAt: null,
  lastError: null,
};

const listeners = new Set<(state: QueueState) => void>();

function emit(patch: Partial<QueueState> = {}) {
  state = { ...state, ...patch };
  for (const listener of listeners) {
    try {
      listener(state);
    } catch {
      /* a broken listener must not stop the queue */
    }
  }
}

export function subscribe(listener: (state: QueueState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function getState(): QueueState {
  return state;
}

async function refreshCounts() {
  const store = getDb();
  if (!store) return;
  try {
    const pending = await store.items.where("status").equals("pending").count();
    const failed = await store.items.where("status").equals("failed").count();
    emit({ pending, failed });
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

export interface EnqueueInput {
  url: string;
  body: string;
  methods: string[];
  reason: string;
}

export async function enqueue(input: EnqueueInput): Promise<boolean> {
  const store = getDb();
  if (!store) return false;

  const fingerprint = `${input.url}|${input.body}`;

  try {
    const already = await store.items.where("fingerprint").equals(fingerprint).count();
    if (already > 0) return true;

    const total = await store.items.count();
    if (total >= MAX_QUEUE) {
      emit({
        lastError:
          "Offline queue is full (500 changes). Reconnect and sync before adding more.",
      });
      return false;
    }

    await store.items.add({
      fingerprint,
      url: input.url,
      body: input.body,
      methods: input.methods,
      at: Date.now(),
      attempts: 0,
      status: "pending",
      lastError: input.reason,
    });

    await refreshCounts();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Flush
// ---------------------------------------------------------------------------

let flushing: Promise<number> | null = null;

async function postRaw(url: string, body: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    credentials: "include",
    cache: "no-store",
  });
}

async function runFlush(): Promise<number> {
  const store = getDb();
  if (!store) return 0;

  const rows = await store.items.orderBy("id").toArray();
  const pending = rows.filter((row) => row.status === "pending");
  if (!pending.length) {
    await refreshCounts();
    return 0;
  }

  emit({ flushing: true, lastError: null });
  let sent = 0;

  for (const row of pending) {
    try {
      const response = await postRaw(row.url, row.body);

      if (response.ok) {
        if (row.id != null) await store.items.delete(row.id);
        sent += 1;
        continue;
      }

      // 503 = our loopback proxy never reached the hosted ERP: still offline.
      if (response.status === 503) {
        emit({ lastError: "Offline — waiting for a connection." });
        break;
      }

      // Any other status means the server evaluated the request and refused
      // it (validation, permission, duplicate...). Keep it for the user to
      // review instead of silently discarding a financial document.
      let detail = `HTTP ${response.status}`;
      try {
        const text = await response.text();
        if (text) detail += ` — ${text.slice(0, 300)}`;
      } catch {
        /* ignore */
      }

      if (row.id != null) {
        await store.items.update(row.id, {
          status: "failed",
          attempts: row.attempts + 1,
          lastError: detail,
        });
      }
      emit({ lastError: detail });
      // Preserve ordering: do not let later mutations overtake this one.
      break;
    } catch (err: any) {
      // Network error: nothing was delivered, keep it pending and stop.
      if (row.id != null) {
        await store.items.update(row.id, { attempts: row.attempts + 1 });
      }
      emit({ lastError: err?.message || "Network error" });
      break;
    }
  }

  await refreshCounts();
  emit({ flushing: false, lastFlushAt: Date.now() });
  if (sent > 0 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("erp:offline-flushed", { detail: { sent } }));
  }
  return sent;
}

/** Replay queued mutations. Safe to call from anywhere; only one runs at a time. */
export function flush(): Promise<number> {
  if (flushing) return flushing;
  flushing = runFlush()
    .catch((err) => {
      emit({ lastError: err?.message || "Sync failed" });
      return 0;
    })
    .finally(() => {
      flushing = null;
    });
  return flushing;
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

export async function list(): Promise<QueuedMutation[]> {
  const store = getDb();
  if (!store) return [];
  try {
    return await store.items.orderBy("id").toArray();
  } catch {
    return [];
  }
}

export async function retry(id: number): Promise<void> {
  const store = getDb();
  if (!store) return;
  await store.items.update(id, { status: "pending", lastError: undefined });
  await refreshCounts();
  void flush();
}

export async function remove(id: number): Promise<void> {
  const store = getDb();
  if (!store) return;
  await store.items.delete(id);
  await refreshCounts();
}

/** Retry every failed entry (used by the "Sync now" button). */
export async function retryAllFailed(): Promise<void> {
  const store = getDb();
  if (!store) return;
  try {
    const failed = await store.items.where("status").equals("failed").toArray();
    for (const row of failed) {
      if (row.id != null) {
        await store.items.update(row.id, { status: "pending", lastError: undefined });
      }
    }
    await refreshCounts();
  } catch {
    /* ignore */
  }
  void flush();
}

export async function clearAll(): Promise<void> {
  const store = getDb();
  if (!store) return;
  try {
    await store.items.clear();
  } catch {
    /* ignore */
  }
  await refreshCounts();
}

// ---------------------------------------------------------------------------
// Automatic flushing
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    void flush();
  });

  // `online` is unreliable on Android (it can stay true on a captive portal
  // or after the app was suspended), so poll while something is queued.
  window.setInterval(() => {
    if (state.pending > 0 && !state.flushing) void flush();
  }, 20_000);

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && state.pending > 0) {
        void flush();
      }
    });
  }

  void refreshCounts();
}
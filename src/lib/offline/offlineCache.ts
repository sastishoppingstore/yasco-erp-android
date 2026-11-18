import Dexie, { type Table } from "dexie";

/**
 * Offline query cache.
 *
 * Only tRPC *queries* are cached (mutations are never replayed blindly, that
 * could duplicate invoices/payments).  A query is written to IndexedDB after
 * every successful online response and served back when the device is offline
 * or the hosted ERP is unreachable.
 */

interface CachedResponse {
  key: string;
  body: string;
  at: number;
}

const MAX_ENTRIES = 600;

class OfflineCacheDb extends Dexie {
  responses!: Table<CachedResponse, string>;

  constructor() {
    super("erp-offline-cache");
    this.version(1).stores({ responses: "key, at" });
  }
}

let db: OfflineCacheDb | null = null;
let dbFailed = false;

function getDb(): OfflineCacheDb | null {
  if (dbFailed) return null;
  if (db) return db;
  try {
    if (typeof indexedDB === "undefined") {
      dbFailed = true;
      return null;
    }
    db = new OfflineCacheDb();
    return db;
  } catch {
    dbFailed = true;
    return null;
  }
}

function cacheKey(url: string, body: string): string {
  return `${url}|${body}`;
}

export async function readCache(url: string, body: string): Promise<string | null> {
  const store = getDb();
  if (!store) return null;
  try {
    const row = await store.responses.get(cacheKey(url, body));
    return row?.body ?? null;
  } catch {
    return null;
  }
}

export async function writeCache(url: string, body: string, response: string): Promise<void> {
  const store = getDb();
  if (!store) return;
  try {
    await store.responses.put({ key: cacheKey(url, body), body: response, at: Date.now() });
    const count = await store.responses.count();
    if (count > MAX_ENTRIES) {
      // Drop the least recently written entries.
      const excess = count - MAX_ENTRIES;
      const oldest = await store.responses.orderBy("at").limit(excess).primaryKeys();
      if (oldest.length) await store.responses.bulkDelete(oldest as string[]);
    }
  } catch {
    /* cache is best-effort */
  }
}

export function cachedResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-erp-offline-cache": "1",
    },
  });
}

export async function clearOfflineCache(): Promise<void> {
  const store = getDb();
  try {
    await store?.responses.clear();
  } catch {
    /* ignore */
  }
}

/**
 * fetch() wrapper used by the tRPC links.
 *
 * `isQuery` must be true only for query batches: those are the only requests
 * that are safe to answer from the cache.
 */
export function createOfflineFetch(isQuery: boolean) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const body = typeof init?.body === "string" ? init.body : "";

    const doFetch = () =>
      globalThis.fetch(input, {
        ...(init ?? {}),
        credentials: "include",
      });

    try {
      const response = await doFetch();

      if (isQuery && response.ok) {
        try {
          const text = await response.clone().text();
          void writeCache(url, body, text);
        } catch {
          /* ignore clone/read issues */
        }
      }

      // 503 = loopback proxy could not reach the hosted ERP.
      if (isQuery && response.status === 503) {
        const hit = await readCache(url, body);
        if (hit) return cachedResponse(hit);
      }

      return response;
    } catch (err: any) {
      if (isQuery) {
        const hit = await readCache(url, body);
        if (hit) return cachedResponse(hit);
      }
      const errorMsg = err?.message || err?.response?.data?.message || "Network or Server Error";
      throw new Error(errorMsg);
    }
  };
}

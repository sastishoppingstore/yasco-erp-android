import { createContext, useContext, type ReactNode } from "react";

/**
 * Server-only mode.
 *
 * The desktop app is a thin client of the live backend (the same server the
 * website uses) and keeps no local database or offline write queue. This
 * provider is kept only so the existing UI (sync badge, "Sync now" button and
 * legacy sync pages) keeps compiling and rendering: it reports an always-online
 * state and the actions are no-ops. All reads/writes go to the server.
 */
export type SyncStatus = {
  state: "online" | "offline" | "syncing" | "sync_failed" | "unknown";
  pendingCount: number;
  failedCount: number;
  lastSyncAt: string | null;
};

const ONLINE: SyncStatus = {
  state: "online",
  pendingCount: 0,
  failedCount: 0,
  lastSyncAt: null,
};

const SyncContext = createContext<{
  status: SyncStatus;
  sync: () => void;
  retryAllFailed: () => void;
  getStats: () => Promise<any>;
} | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  return (
    <SyncContext.Provider
      value={{
        status: ONLINE,
        sync: () => {},
        retryAllFailed: () => {},
        getStats: async () => ({ pending: 0, failed: 0 }),
      }}
    >
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within SyncProvider");
  return ctx;
}

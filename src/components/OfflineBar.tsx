import { useEffect, useState } from "react";
import { flush, list, remove, retry, retryAllFailed, subscribe, type QueueState, type QueuedMutation } from "@/lib/offline/mutationQueue";
import { queryClient } from "@/providers/trpc";

/**
 * Small floating status bar for offline mode.
 *
 * It only appears when there is something to say: the device is offline, or
 * mutations were queued while it was offline. Nothing is hidden from the user —
 * queued changes are listed with their procedure name and can be retried or
 * discarded individually.
 */
export function OfflineBar() {
  const [state, setState] = useState<QueueState>({
    pending: 0,
    failed: 0,
    flushing: false,
    lastFlushAt: null,
    lastError: null,
  });
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<QueuedMutation[]>([]);

  useEffect(() => subscribe(setState), []);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  // After a successful replay, server data changed: refresh what is on screen.
  useEffect(() => {
    const onFlushed = () => {
      void queryClient.invalidateQueries();
    };
    window.addEventListener("erp:offline-flushed", onFlushed);
    return () => window.removeEventListener("erp:offline-flushed", onFlushed);
  }, []);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () => {
      void list().then((rows) => {
        if (alive) setItems(rows);
      });
    };
    load();
    const timer = window.setInterval(load, 2000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [open]);

  const total = state.pending + state.failed;
  if (total === 0 && online) return null;

  const label = state.flushing
    ? "Syncing..."
    : state.failed > 0
      ? `${state.failed} change(s) rejected`
      : state.pending > 0
        ? `${state.pending} change(s) waiting to sync`
        : "Offline — showing saved data";

  return (
    <div className="fixed bottom-3 left-3 z-[60] max-w-[calc(100vw-1.5rem)] font-sans" dir="ltr">
      {open && (
        <div className="mb-2 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-white/10 bg-slate-900/95 text-slate-100 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <div className="text-sm font-bold">Offline changes / تغييرات غير متزامنة</div>
              <div className="text-[11px] text-slate-400">
                {state.pending} pending · {state.failed} rejected
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
            >
              Close
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {items.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-slate-400">Queue is empty.</div>
            )}
            {items.map((item) => (
              <div key={item.id} className="border-b border-white/5 px-4 py-2.5 last:border-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold">
                      {item.methods.length ? item.methods.join(", ") : "mutation"}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {new Date(item.at).toLocaleString()}
                      {item.status === "failed" && (
                        <span className="ms-2 rounded bg-rose-500/20 px-1.5 py-0.5 text-rose-300">rejected</span>
                      )}
                    </div>
                    {item.status === "failed" && item.lastError && (
                      <div className="mt-1 line-clamp-2 text-[11px] text-rose-300/90">{item.lastError}</div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {item.status === "failed" && item.id != null && (
                      <button
                        type="button"
                        onClick={() => void retry(item.id!)}
                        className="rounded-md bg-white/10 px-2 py-1 text-[11px] hover:bg-white/20"
                      >
                        Retry
                      </button>
                    )}
                    {item.id != null && (
                      <button
                        type="button"
                        onClick={() => void remove(item.id!)}
                        className="rounded-md bg-white/5 px-2 py-1 text-[11px] text-slate-300 hover:bg-rose-500/20 hover:text-rose-200"
                      >
                        Discard
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {state.lastError && (
            <div className="border-t border-white/10 px-4 py-2 text-[11px] text-amber-300/90">
              {state.lastError}
            </div>
          )}

          <div className="flex gap-2 border-t border-white/10 px-4 py-3">
            <button
              type="button"
              disabled={state.flushing || !online}
              onClick={() => {
                void retryAllFailed();
              }}
              className="flex-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
            >
              {state.flushing ? "Syncing..." : "Sync now"}
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/95 px-3.5 py-2 text-xs font-semibold text-slate-100 shadow-xl backdrop-blur hover:bg-slate-800"
      >
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            state.flushing ? "animate-pulse bg-amber-400" : online ? "bg-emerald-400" : "bg-rose-500"
          }`}
        />
        <span>{label}</span>
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
      </button>
    </div>
  );
}

export default OfflineBar;
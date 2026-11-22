import { lazy, useEffect, useState } from "react";
import { Navigate } from "react-router";
import { useTenantModules } from "@/hooks/useTenantModules";
import AppLayout from "./AppLayout";

const Dashboard = lazy(() => import("@/pages/Dashboard"));

/**
 * Business home for the exact /app route.
 * Construction tenants go straight to their Sahl-style dashboard
 * (/app/construction) — they never sit on the generic launcher.
 * Everyone else keeps the launcher Dashboard as today.
 * While modules load, a dark splash keeps the screen Sahl-consistent.
 */
export default function BusinessHomeRedirect() {
  const { serverModules, isLoadingModules } = useTenantModules();

  // Never trap the user on the splash: if the module list has not arrived after
  // a few seconds we fall through to the launcher instead of spinning forever.
  const [modulesTimedOut, setModulesTimedOut] = useState(false);
  useEffect(() => {
    if (!isLoadingModules) {
      setModulesTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setModulesTimedOut(true), 8000);
    return () => clearTimeout(timer);
  }, [isLoadingModules]);

  if (isLoadingModules && !serverModules && !modulesTimedOut) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-neutral-900 via-stone-900 to-neutral-900">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
          <p className="text-sm text-emerald-200">... جار التحميل</p>
        </div>
      </div>
    );
  }

  if (!serverModules) {
    return (
      <AppLayout>
        <Dashboard />
      </AppLayout>
    );
  }

  if (serverModules.includes("construction")) {
    return <Navigate to="/app/construction" replace />;
  }

  /* [decoration] Decoration & Construction tenants land on the 3-D launcher.
   * Placed after the construction check so Sahl / construction tenants keep
   * their existing landing — no pre-existing system is affected. */
  if (serverModules.includes("decoration")) {
    return <Navigate to="/app/decoration" replace />;
  }

  /* Travel tenants land directly inside their travel module, so after login
   * only travel is on screen — the construction / other modules never show. */
  if (serverModules.includes("travel")) {
    return <Navigate to="/app/verticals/travel/dashboard" replace />;
  }

  return (
    <AppLayout>
      <Dashboard />
    </AppLayout>
  );
}

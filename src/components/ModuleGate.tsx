/**
 * Server-authoritative module gate.
 *
 * Wraps a route (or a route tree) that belongs to a specific module. The
 * tenant's enabled modules come from `tenant_modules` via
 * `settings.modulesGet`, so a user only ever opens the module they actually
 * own:
 *
 *   - travel tenant  → travel routes only, `/app/construction` bounces home
 *   - construction tenant → construction routes only, travel routes bounce home
 *
 * `lenient` is used for the legacy core modules (construction / Sahl): tenants
 * that have no `tenant_modules` rows at all keep full access, so the gate can
 * never lock out a pre-existing account that predates the module registry. A
 * tenant whose module list IS known but excludes the module is always bounced.
 */
import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useTenantModules } from "@/hooks/useTenantModules";
import { useAuth } from "@/hooks/useAuth";

export default function ModuleGate({
  module,
  children,
  lenient = false,
}: {
  module: string;
  children: ReactNode;
  lenient?: boolean;
}) {
  const { user } = useAuth();
  const { serverModules, isLoadingModules } = useTenantModules();

  // Super admins are never scoped to a single module — the sidebar shows them
  // every module, so the route gate must match and let them preview any of them.
  if (user?.role === "super_admin") {
    return <>{children}</>;
  }

  // Hold the screen until the server list resolves — guessing here would bounce
  // a user out of the very module they are entitled to.
  if (isLoadingModules) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
          <p className="text-sm text-sky-200">جارٍ تحميل الوحدة...</p>
        </div>
      </div>
    );
  }

  // No rows at all: pre-existing/legacy tenants. `lenient` modules stay open
  // (nothing to reveal), strict modules stay closed.
  if (!serverModules) {
    return lenient ? <>{children}</> : <Navigate to="/app" replace />;
  }

  if (!serverModules.includes(module)) {
    return <Navigate to="/app" replace />;
  }

  return <>{children}</>;
}

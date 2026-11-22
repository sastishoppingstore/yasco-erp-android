// Travel & Tours — dedicated full-screen workspace shell.
//
// Wraps every `/app/verticals/travel/*` route so the bulky global ERP header
// (Dashboard / Global Smart ERP / country tax badge / global search) and the
// global sidebar are NOT rendered inside the Travel module. The agency gets the
// whole viewport for tickets, invoices, reports and the 3-D launcher.
//
// A prominent "← Back" button sits top-left on every Travel screen and returns
// straight to the Travel 3D Launcher Dashboard.
//
// This file belongs to the Travel module only and does not import or affect any
// other module's layout.
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { ArrowLeft, ArrowRight, Plane } from "lucide-react";
import { useLanguage } from "@/providers/language";

const LAUNCHER = "/app/verticals/travel/dashboard";

export default function TravelLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { language } = useLanguage();
  const rtl = language === "ar";

  // Already on the launcher? "Back" then returns to the business home (`/app`,
  // which for a travel tenant resolves back to this launcher).
  const onLauncher =
    location.pathname === LAUNCHER ||
    location.pathname === "/app/verticals/travel" ||
    location.pathname === "/app/verticals/travel/";
  const backTo = onLauncher ? "/app" : LAUNCHER;

  return (
    <div dir={rtl ? "rtl" : "ltr"} className="flex min-h-dvh flex-col bg-slate-50">
      <header
        className="sticky top-0 z-30 flex items-center gap-3 border-b border-black/20 px-3 py-2 text-white shadow-md"
        style={{ background: "linear-gradient(90deg,#0f172a 0%,#0d9488 55%,#0284c7 100%)" }}
      >
        <button
          type="button"
          onClick={() => navigate(backTo)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/30 bg-white/15 px-3 py-1.5 text-sm font-extrabold text-white backdrop-blur transition hover:bg-white/25 active:scale-95"
          aria-label={rtl ? "رجوع" : "Back"}
          title={rtl ? "رجوع" : "Back"}
        >
          {rtl ? <ArrowRight className="size-4" /> : <ArrowLeft className="size-4" />}
          {rtl ? "رجوع" : "Back"}
        </button>

        <span className="flex items-center gap-2 text-sm font-extrabold tracking-tight text-white/95">
          <Plane className="size-4" />
          {rtl ? "السياحة والسفر" : "Travel & Tours"}
        </span>

        <span className="ms-auto hidden text-[11px] font-medium text-white/70 sm:block">
          {rtl ? "وضع ملء الشاشة" : "Full-screen workspace"}
        </span>
      </header>

      <main className="flex-1 min-h-0 overflow-auto">{children}</main>
    </div>
  );
}

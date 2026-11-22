import { useMemo, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { useNavigate } from "react-router";
import { motion } from "framer-motion";
import { trpc } from "@/providers/trpc";
import { useLanguage } from "@/providers/language";
import {
  Plane, FileText, PlusCircle, Compass, Users, Package, Stamp, Hotel,
  Building2, MapPin, Receipt, Settings, TrendingUp, Wallet,
  CalendarClock, ShieldCheck, BarChart3, type LucideIcon,
} from "lucide-react";
import { fmtMoney } from "@/lib/travelCalc";

/* ── vivid gradient palette (launcher / glossy 3D tiles) ── */
const G = [
  "linear-gradient(135deg,#0ea5e9 0%,#38bdf8 50%,#7dd3fc 100%)", // sky
  "linear-gradient(135deg,#059669 0%,#10b981 50%,#6ee7b7 100%)", // emerald
  "linear-gradient(135deg,#7c3aed 0%,#a855f7 50%,#d8b4fe 100%)", // violet
  "linear-gradient(135deg,#ea580c 0%,#f97316 50%,#fdba74 100%)", // orange
  "linear-gradient(135deg,#0d9488 0%,#14b8a6 50%,#5eead4 100%)", // teal
  "linear-gradient(135deg,#db2777 0%,#ec4899 50%,#f9a8d4 100%)", // pink
  "linear-gradient(135deg,#b45309 0%,#f59e0b 50%,#fde047 100%)", // amber / gold
  "linear-gradient(135deg,#1d4ed8 0%,#3b82f6 50%,#93c5fd 100%)", // blue
  "linear-gradient(135deg,#15803d 0%,#22c55e 50%,#bbf7d0 100%)", // green
  "linear-gradient(135deg,#4338ca 0%,#6366f1 50%,#a5b4fc 100%)", // indigo
  "linear-gradient(135deg,#9d174d 0%,#be185d 50%,#f472b6 100%)", // rose
  "linear-gradient(135deg,#334155 0%,#475569 50%,#94a3b8 100%)", // slate
];

interface Tile {
  key: string;
  label: string;
  labelAr: string;
  icon: LucideIcon;
  path: string;
  g: string;
  badgeKey?: "tickets" | "passengers" | "visas" | "packages" | "bookings" | "suppliers";
  hint?: string;
  hintAr?: string;
}

export default function TravelDashboard() {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const rtl = language === "ar";
  const T = (en: string, ar: string) => (rtl ? ar : en);

  const { data } = trpc.travel.travelDashboard.useQuery();
  const { data: settingsData } = trpc.travel.settingsGet.useQuery();
  const company = settingsData?.company as any;
  const tset = settingsData?.settings as any;

  const counts = useMemo(() => ({
    tickets: data?.totalTickets ?? 0,
    passengers: data?.totalPassengers ?? 0,
    visas: data?.totalVisas ?? 0,
    packages: data?.totalPackages ?? 0,
    bookings: data?.totalBookings ?? 0,
    suppliers: data?.totalSuppliers ?? 0,
  }), [data]);

  // ── 8 launcher tiles (all-in-one cockpit) ──
  const tiles: Tile[] = [
    { key: "new", label: "Create Ticket / Invoice", labelAr: "إنشاء فاتورة تذكرة", icon: PlusCircle, path: "/app/verticals/travel/tickets/new", g: G[1], hint: "Dual-amount + A4 preview", hintAr: "مزدوج المبلغ + معاينة" },
    { key: "tickets", label: "Air Tickets & PNR", labelAr: "حجوزات الطيران", icon: Plane, path: "/app/verticals/travel/tickets", g: G[0], badgeKey: "tickets", hint: "Sectors / PNR / tickets", hintAr: "المسارات / PNR / التذاكر" },
    { key: "packages", label: "Umrah & Tour Packages", labelAr: "باقات العمرة والسياحة", icon: Package, path: "/app/verticals/travel/packages", g: G[6], badgeKey: "packages", hint: "Umrah / Hajj / tours", hintAr: "عمرة / حج / رحلات" },
    { key: "visas", label: "Visas & Hotels", labelAr: "التأشيرات والفنادق", icon: Stamp, path: "/app/verticals/travel/visas", g: G[2], badgeKey: "visas", hint: "Visa status & vouchers", hintAr: "حالة التأشيرة والفنادق" },
    { key: "suppliers", label: "Airlines & Suppliers Ledger", labelAr: "حسابات الموردين", icon: Building2, path: "/app/verticals/travel/suppliers", g: G[11], badgeKey: "suppliers", hint: "Payables & commission", hintAr: "المستحقات والعمولة" },
    { key: "passengers", label: "Passengers & CRM", labelAr: "سجل المسافرين", icon: Users, path: "/app/verticals/travel/passengers", g: G[9], badgeKey: "passengers", hint: "Passport / WhatsApp CRM", hintAr: "الجوازات / واتساب" },
    { key: "margin", label: "ZATCA Margin Report", labelAr: "تقرير ضريبة الأرباح", icon: BarChart3, path: "/app/verticals/travel/margin-report", g: G[3], hint: "Base cost vs profit vs VAT", hintAr: "التكلفة والربح والضريبة" },
    { key: "settings", label: "Agency & License Settings", labelAr: "إعدادات الوكالة", icon: Settings, path: "/app/verticals/travel/settings", g: G[7], hint: "VAT #, tourism license", hintAr: "الرقم الضريبي والترخيص" },
  ];

  const kpis = [
    { label: T("Total ticket & package sales", "إجمالي مبيعات التذاكر والباقات"), value: `SAR ${fmtMoney((data?.revenue ?? 0) + (data?.packageSales ?? 0))}`, icon: Wallet, g: G[1] },
    { label: T("Net agency profit (taxable)", "صافي ربح الوكالة (خاضع)"), value: `SAR ${fmtMoney(data?.profit ?? 0)}`, icon: TrendingUp, g: G[6] },
    { label: T("ZATCA vs 0% non-tax", "الهيئة مقابل غير ضريبية"), value: `${data?.zatcaCount ?? 0} / ${data?.nonTaxCount ?? 0}`, icon: ShieldCheck, g: G[0] },
    { label: T("Airlines & supplier payables", "مستحقات الموردين"), value: `SAR ${fmtMoney(data?.supplierPayables ?? 0)}`, icon: CalendarClock, g: G[2] },
  ];

  return (
    <div dir={rtl ? "rtl" : "ltr"} className="relative min-h-screen overflow-hidden">
      {/* rich gradient backdrop */}
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(1200px 600px at 15% -10%, #0ea5e959, transparent), radial-gradient(1000px 500px at 90% 0%, #a855f759, transparent), radial-gradient(900px 700px at 50% 120%, #10b98159, transparent), linear-gradient(160deg,#0f172a 0%,#111827 45%,#0b1220 100%)" }} />

      <div className="relative z-10 mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
        {/* ── command bar ── */}
        <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
          className="mb-5 flex flex-wrap items-center gap-4 overflow-hidden rounded-3xl border border-white/15 p-4 shadow-2xl sm:p-5"
          style={{ background: "linear-gradient(120deg,#0284c7e6 0%,#0d9488e6 45%,#7c3aede6 100%)", boxShadow: "0 20px 50px -12px rgba(13,148,136,0.5), inset 0 1px 0 rgba(255,255,255,0.25)" }}>
          <div className="flex size-16 items-center justify-center rounded-2xl border border-white/25 bg-white/10 backdrop-blur">
            <Plane className="size-9 text-white drop-shadow" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight text-white drop-shadow-sm sm:text-3xl">
              {T("Travel & Tours", "السياحة والسفر")}
            </h1>
            <p className="truncate text-sm text-white/90">
              {company?.companyName || T("Travel Agency Suite", "منظومة وكالة السفر")}
            </p>
            <p dir="rtl" className="truncate text-[13px] font-semibold text-white/90">
              {company?.companyNameAr || tset?.taglineAr || ""}
            </p>
          </div>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <div className="rounded-2xl border border-white/20 bg-white/10 px-3 py-1.5 backdrop-blur">
              <div className="text-[10px] text-white/75">{T("VAT number", "الرقم الضريبي")}</div>
              <div className="font-mono text-[12px] font-bold text-white">{company?.taxNumber || "—"}</div>
            </div>
            <div className="rounded-2xl border border-white/20 bg-white/10 px-3 py-1.5 backdrop-blur">
              <div className="text-[10px] text-white/75">{T("Tourism license", "رقم ترخيص وزارة السياحة")}</div>
              <div className="font-mono text-[12px] font-bold text-white">
                {tset?.tourismLicenseNo || "—"}
                {tset?.tourismLicenseTypeAr ? <span dir="rtl" className="ms-1 text-[10px] font-normal text-white/80">{tset.tourismLicenseTypeAr}</span> : null}
              </div>
            </div>
            <div className="hidden items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-3 py-2 backdrop-blur sm:flex">
              <ShieldCheck className="size-4 text-emerald-200" />
              <span className="text-[11px] font-semibold text-white">{T("ZATCA Phase-2 verified", "الهيئة مرحلة ثانية — موثّق")}</span>
            </div>
          </div>
        </motion.div>

        {/* ── KPI strip ── */}
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map((k, i) => (
            <motion.div key={k.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06, duration: 0.35 }}
              className="relative overflow-hidden rounded-2xl border border-white/15 p-3 text-white shadow-lg"
              style={{ background: k.g, boxShadow: "0 10px 30px -10px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.25)" }}>
              <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(180deg,rgba(255,255,255,0.22),transparent 55%)" }} />
              <div className="relative flex items-center justify-between">
                <span className="text-[11px] font-medium text-white/90">{k.label}</span>
                <k.icon className="size-5 opacity-90" />
              </div>
              <div className="relative mt-1.5 font-mono text-lg font-extrabold tracking-tight sm:text-xl">{k.value}</div>
            </motion.div>
          ))}
        </div>

        {/* ── module launcher grid ── */}
        <div className="mb-3 flex items-center gap-2 text-white/90">
          <div className="h-1 w-6 rounded-full bg-gradient-to-r from-sky-400 to-fuchsia-400" />
          <h2 className="text-sm font-bold uppercase tracking-wider">{T("All Modules", "جميع الوحدات")}</h2>
        </div>

        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4">
          {tiles.map((tl, i) => (
            <Tile3D key={tl.key} tile={tl} count={tl.badgeKey ? counts[tl.badgeKey] : undefined} index={i} rtl={rtl}
              onClick={() => navigate(tl.path)} />
          ))}
        </div>

        {/* ── quick access row: bookings / itineraries / reconciliation ── */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { label: T("Travel Bookings", "حجوزات السفر"), icon: Compass, path: "/app/verticals/travel/bookings", g: G[4] },
            { label: T("Tour Itineraries", "برامج الرحلات"), icon: MapPin, path: "/app/verticals/travel/itineraries", g: G[5] },
            { label: T("Settlements & Rec", "تسوية الحسابات"), icon: Receipt, path: "/app/verticals/travel/reconciliation", g: G[10] },
          ].map((q) => (
            <button key={q.path} onClick={() => navigate(q.path)}
              className="flex items-center gap-3 rounded-2xl border border-white/15 px-4 py-3 text-start text-white transition hover:brightness-110"
              style={{ background: q.g, boxShadow: "0 10px 24px -12px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.25)" }}>
              <q.icon className="size-6 drop-shadow" />
              <span className="text-[13px] font-bold">{q.label}</span>
            </button>
          ))}
        </div>

        {/* ── recent tickets quick list ── */}
        <div className="mt-6 overflow-hidden rounded-2xl border border-white/15 bg-white/5 backdrop-blur">
          <div className="flex items-center justify-between px-4 py-2 text-white/90">
            <span className="text-sm font-bold">{T("Recent tickets", "أحدث التذاكر")}</span>
            <button onClick={() => navigate("/app/verticals/travel/tickets")} className="text-[11px] font-semibold text-sky-300 hover:text-sky-200">
              {T("View all", "عرض الكل")} →
            </button>
          </div>
          <div className="divide-y divide-white/10">
            {(data?.recent || []).slice(0, 5).map((t: any) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-2 text-white/90">
                <span className="font-mono text-xs text-sky-300">{t.invoiceNumber}</span>
                <span className="min-w-0 flex-1 truncate text-[12px]">{t.customerName || t.passengerName || "—"}</span>
                {t.mode === "zatca"
                  ? <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">ZATCA</span>
                  : <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/70">{t.vatPercent}%</span>}
                <span className="font-mono text-xs tabular-nums">{fmtMoney(t.totalAmount)}</span>
              </div>
            ))}
            {!data?.recent?.length && <div className="px-4 py-6 text-center text-sm text-white/50">{T("No tickets yet", "لا توجد تذاكر بعد")}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile3D({ tile, count, index, rtl, onClick }: { tile: Tile; count?: number; index: number; rtl: boolean; onClick: () => void }) {
  const Icon = tile.icon;
  const ref = useRef<HTMLButtonElement>(null);

  // Pointer-driven 3D tilt (kept lightweight — transforms only).
  const onMove = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(700px) rotateY(${px * 14}deg) rotateX(${-py * 14}deg) translateY(-6px) scale(1.05)`;
  };
  const onLeave = () => {
    const el = ref.current;
    if (el) el.style.transform = "";
  };

  return (
    <motion.button
      ref={ref}
      initial={{ opacity: 0, scale: 0.85, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ delay: index * 0.04, type: "spring", stiffness: 400, damping: 24 }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className="group relative flex min-h-[150px] flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-white/25 p-3 text-white outline-none transition-transform duration-150 ease-out will-change-transform focus-visible:ring-2 focus-visible:ring-white/60"
      style={{ background: tile.g, boxShadow: "0 12px 30px -10px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.3), inset 0 -3px 6px rgba(0,0,0,0.18)", transformStyle: "preserve-3d" }}
    >
      {/* glossy overlay */}
      <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(180deg,rgba(255,255,255,0.28) 0%,rgba(255,255,255,0.06) 45%,transparent 55%)" }} />
      {count !== undefined && count > 0 && (
        <span className="absolute end-2 top-2 z-10 rounded-full bg-black/30 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white backdrop-blur">{count}</span>
      )}
      <Icon className="relative z-10 size-9 drop-shadow-md" strokeWidth={1.8} style={{ transform: "translateZ(30px)" }} />
      <span className="relative z-10 text-center text-[11.5px] font-bold leading-tight drop-shadow-sm" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>
        {rtl ? tile.labelAr : tile.label}
      </span>
      <span className="relative z-10 text-center text-[9.5px] leading-tight text-white/85">
        {rtl ? tile.label : tile.labelAr}
      </span>
      {tile.hint && (
        <span className="absolute inset-x-2 bottom-1 z-10 truncate text-center text-[9px] text-white/70">
          {rtl ? tile.hintAr : tile.hint}
        </span>
      )}
    </motion.button>
  );
}

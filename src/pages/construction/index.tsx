import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useLanguage } from "@/providers/language";
import {
  FileText, Receipt, Users, Wallet, Package,
  ArrowLeftRight, FileBarChart, ClipboardList,
  Calculator, Plus, ShoppingCart, ShoppingBag, ClipboardCheck, ListOrdered, Settings,
  Presentation, PackageOpen, Tags, HandCoins, Headset, X, HardHat, Warehouse,
  ChevronLeft, ChevronRight, Sparkles,
} from "lucide-react";

const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });

// Sahl palette — flat module colours, rendered with a soft 3D sheen.
const C = {
  green: "#2fae4e",
  blue: "#1b9bd7",
  navy: "#1b3a5f",
  teal: "#1a9e8f",
  tealDark: "#0d7d72",
  redOrange: "#e05242",
  coral: "#ef6a5a",
  burgundy: "#7b2d4e",
  turquoise: "#0fa3b1",
  yellow: "#f5c518",
};

interface Tile {
  label: string;
  labelAr: string;
  icon: any;
  path?: string;
  action?: string;
  color: string;
  dark?: boolean;
}

const TOUR_STEPS = [
  { ar: "هذه الواجهة الرئيسية — كل مربع يفتح وحدة حقيقية", en: "This is the main dashboard — every tile opens a real module" },
  { ar: "الصف الأخضر: التقارير والفواتير والخزينة والحسابات والبضاعة", en: "Green row: reports, invoices, treasury, accounts, inventory" },
  { ar: "الأزرق: إدخال الحسابات والأصناف وإعداد البرنامج", en: "Blue: product/account entry and program settings" },
  { ar: "مربعات البيع والشراء والمخازن بأسفل الشاشة", en: "Sales, purchase and warehouse tiles at the bottom" },
  { ar: "زر فاتورة جديدة يفتح منشئ الفواتير مباشرة", en: "New Invoice opens the bill creator directly" },
];

// Dashboard backgrounds offered in the footer (kept in localStorage).
const DASH_BGS = ["#04070f", "#0b1220", "#0d1b2a", "#150f2b", "#0b1a14"];

export default function ConstructionDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { language } = useLanguage();
  const rtl = language === "ar";
  const [tour, setTour] = useState(false);
  const [step, setStep] = useState(0);
  const [showSupport, setShowSupport] = useState(false);
  const [whOpen, setWhOpen] = useState(false);
  const [whName, setWhName] = useState("");
  const [whMsg, setWhMsg] = useState("");
  const utils = trpc.useUtils();
  const addWarehouse = trpc.inventory.warehouseCreate.useMutation({
    onSuccess: () => {
      setWhMsg(rtl ? "✓ تم إضافة المخزن" : "✓ Warehouse added");
      setWhName("");
      utils.inventory.warehouseList.invalidate();
      setTimeout(() => { setWhOpen(false); setWhMsg(""); }, 1200);
    },
    onError: (e: any) => setWhMsg(String(e?.message ?? e)),
  });
  const [dashBg, setDashBg] = useState(() => {
    try { return localStorage.getItem("sahl-dashbg") || DASH_BGS[0]; } catch { return DASH_BGS[0]; }
  });
  const changeBg = (bg: string) => {
    setDashBg(bg);
    try { localStorage.setItem("sahl-dashbg", bg); } catch { /* ignore */ }
  };
  // Header Help menu deep links: Quick tour / Support open the real overlays.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.get("tour") === "1") { setStep(0); setTour(true); }
    if (q.get("support") === "1") setShowSupport(true);
  }, [location.key, location.search]);
  const { data: stats } = trpc.construction.constructionStats.useQuery(undefined);
  const { data: projects } = trpc.construction.projectList.useQuery(undefined);
  // Real Sahl numbers: the dashboard used to read the legacy construction
  // invoice table, which shows 0 even when the shop has live sales.
  const { data: sahl } = trpc.sahlReports.dashboard.useQuery(undefined);
  const { data: sahlInvoices } = trpc.sales.invoiceList.useQuery(undefined);
  const { data: company } = trpc.settings.companySettingsGet.useQuery();
  const brandAr = (company as any)?.companyNameAr || (company as any)?.companyName || "سهل";
  const brandEn = (company as any)?.companyName || "SAHL";

  const activeProjects = projects?.filter((p) => p.status === "active") || [];
  const totalContractValue = projects?.reduce((sum, p) => sum + Number(p.contractValue || 0), 0) || 0;
  const totalInvoiced = Number((sahl as any)?.totalSales ?? 0);
  const outstanding = Number((sahl as any)?.totalDue ?? 0);
  const recentInvoices = [...(sahlInvoices || [])]
    .sort((a: any, b: any) => {
      const d = String(b.date || "").localeCompare(String(a.date || ""));
      return d !== 0 ? d : Number(b.id || 0) - Number(a.id || 0);
    })
    .slice(0, 5);

  const monthlySales = (() => {
    const buckets = new Map<string, number>();
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, 0);
    }
    (sahlInvoices || []).forEach((inv: any) => {
      const key = String(inv.date || "").slice(0, 7);
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) || 0) + Number(inv.totalAmount || 0));
    });
    const arr = [...buckets.entries()].map(([m, v]) => ({ month: m.slice(5), total: Math.round(v) }));
    const max = Math.max(1, ...arr.map((a) => a.total));
    return { arr, max };
  })();

  const go = (t: Tile) => {
    if (t.action === "tour") { setStep(0); setTour(true); return; }
    if (t.action === "addWarehouse") { setWhMsg(""); setWhName(""); setWhOpen(true); return; }
    if (t.path) navigate(t.path);
  };

  // SCR-002 top row: five green squares.
  const topTiles: Tile[] = [
    { label: "Reports", labelAr: "التقارير", icon: FileBarChart, path: "/app/construction/sahl/reports/period", color: C.green },
    { label: "Invoices", labelAr: "الفواتير", icon: Receipt, path: "/app/construction/sahl/sales", color: C.green },
    { label: "Treasury", labelAr: "الخزينة", icon: Wallet, path: "/app/construction/sahl/treasury", color: C.green },
    { label: "Accounts", labelAr: "الحسابات", icon: Users, path: "/app/construction/sahl/accounts", color: C.green },
    { label: "Goods", labelAr: "البضاعة", icon: Package, path: "/app/construction/sahl/products", color: C.green },
  ];
  const reportTiles: Tile[] = [
    { label: "Sales analysis", labelAr: "تحليل المبيعات", icon: FileBarChart, path: "/app/construction/sahl/reports/sales", color: C.navy },
    { label: "Daily movement", labelAr: "الحركة اليومية", icon: ClipboardList, path: "/app/construction/sahl/reports/daily", color: C.navy },
  ];
  const utilTiles: Tile[] = [
    { label: "Add quotation", labelAr: "عرض سعر جديد", icon: Calculator, path: "/app/construction/sahl/quotation", color: C.blue },
    { label: "Enter products", labelAr: "إدخال الأصناف", icon: ListOrdered, path: "/app/construction/sahl/products", color: C.blue },
    { label: "Program settings", labelAr: "إعداد البرنامج", icon: Settings, path: "/app/construction/sahl/settings", color: C.blue },
    { label: "Quick tour", labelAr: "جولة سريعة", icon: Presentation, action: "tour", color: C.blue },
  ];
  // Main transaction grid — equal tiles on a phone, no fixed pixel widths.
  const txnTiles: Tile[] = [
    { label: "Stocktake", labelAr: "جرد مخزن", icon: ClipboardCheck, path: "/app/construction/sahl/vault/stocktake", color: C.teal },
    { label: "Payment", labelAr: "صرف", icon: HandCoins, path: "/app/construction/sahl/cash", color: C.coral },
    { label: "Purchase", labelAr: "شراء", icon: ShoppingCart, path: "/app/construction/sahl/purchase", color: C.redOrange },
    { label: "Sales", labelAr: "بيع", icon: ShoppingBag, path: "/app/construction/sahl/sales", color: C.green },
  ];
  const txnTiles2: Tile[] = [
    { label: "Add contract", labelAr: "عقد جديد", icon: FileText, path: "/app/construction/sahl/contracts", color: C.turquoise },
    { label: "Contractors", labelAr: "المقاولون", icon: HardHat, path: "/app/construction/sahl/contractors", color: C.tealDark },
    { label: "Add warehouse", labelAr: "مخزن جديد", icon: Warehouse, action: "addWarehouse", color: C.green },
    { label: "Purchase return", labelAr: "مرتجع شراء", icon: PackageOpen, path: "/app/construction/sahl/purchase-return", color: C.burgundy },
    { label: "Receipt", labelAr: "قبض", icon: Wallet, path: "/app/construction/sahl/receipts", color: C.green },
    { label: "Sales return", labelAr: "مرتجع بيع", icon: PackageOpen, path: "/app/construction/sahl/sales-return", color: C.green },
  ];
  // Management & follow-up modules (rendered as compact rows).
  const mgmtTiles: Tile[] = [
    { label: "Salesmen", labelAr: "المندوبون", icon: Users, path: "/app/construction/sahl/salesmen", color: C.blue },
    { label: "Users", labelAr: "المستخدمون", icon: Settings, path: "/app/construction/sahl/users", color: C.navy },
    { label: "Prices", labelAr: "الأسعار", icon: Tags, path: "/app/construction/sahl/prices", color: C.green },
    { label: "Transfer", labelAr: "التحويل", icon: ArrowLeftRight, path: "/app/construction/sahl/vault/transfer", color: C.tealDark },
    { label: "Item moves", labelAr: "حركة صنف", icon: ClipboardList, path: "/app/construction/sahl/vault/moves", color: C.turquoise },
    { label: "Archive", labelAr: "الأرشيف", icon: FileText, path: "/app/construction/sahl/vault/archive", color: C.navy },
    { label: "Cheques", labelAr: "الشيكات", icon: Receipt, path: "/app/construction/sahl/vault/cheques", color: C.blue },
    { label: "Installments", labelAr: "الأقساط", icon: Calculator, path: "/app/construction/sahl/vault/inst", color: C.burgundy },
    { label: "Barcode", labelAr: "الباركود", icon: Tags, path: "/app/construction/sahl/vault/labels", color: C.green },
    { label: "Prints", labelAr: "الطباعة", icon: FileText, path: "/app/construction/sahl/prints", color: C.blue },
    { label: "Valuation", labelAr: "التقييم", icon: Calculator, path: "/app/construction/sahl/reports/stock", color: C.green },
    { label: "Treasury", labelAr: "الخزينة", icon: Wallet, path: "/app/construction/sahl/treasury", color: C.teal },
    { label: "Admin", labelAr: "الإدارة", icon: Settings, path: "/app/construction/sahl/admin", color: C.navy },
    { label: "More reports", labelAr: "تقارير أخرى", icon: FileBarChart, path: "/app/construction/sahl/reports/more", color: C.blue },
  ];

  const kpis = [
    { l: "Today sales", a: "مبيعات اليوم", v: (sahl as any)?.todaySales, c: "#34d399" },
    { l: "This month", a: "مبيعات الشهر", v: (sahl as any)?.monthSales, c: "#34d399" },
    { l: "Total sales", a: "إجمالي المبيعات", v: (sahl as any)?.totalSales, c: "#5eead4" },
    { l: "Outstanding", a: "المتبقي", v: (sahl as any)?.totalDue, c: "#fb7185" },
    { l: "Returns", a: "المرتجعات", v: (sahl as any)?.returnsTotal, c: "#fbbf24" },
    { l: "Purchases", a: "المشتريات", v: (sahl as any)?.purchaseTotal, c: "#60a5fa" },
  ];

  // Square module tile. Height is driven by the 2:1 aspect of the cell, never
  // by a fixed pixel width — so it always fits the phone width exactly.
  const SahlTile = ({ t }: { t: Tile }) => (
    <button
      onClick={() => go(t)}
      title={rtl ? t.labelAr : t.label}
      className="group relative flex min-h-[78px] min-w-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl px-1.5 py-2 text-center text-white ring-1 ring-white/15 shadow-[0_6px_18px_-8px_rgba(0,0,0,.9)] transition duration-150 active:scale-[.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
      style={{ background: `linear-gradient(155deg, rgba(255,255,255,.16), rgba(0,0,0,.28)), ${t.color}` }}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/30" />
      <t.icon className="h-5 w-5 shrink-0 opacity-95" strokeWidth={1.7} />
      <span className="w-full break-words text-[11px] font-bold leading-[1.15]">{rtl ? t.labelAr : t.label}</span>
      <span className="w-full break-words text-[9px] leading-none opacity-75">{rtl ? t.label : t.labelAr}</span>
    </button>
  );

  const SahlRow = ({ t }: { t: Tile }) => (
    <button
      onClick={() => go(t)}
      title={rtl ? t.labelAr : t.label}
      className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/10 bg-white/[.045] px-2.5 py-2 text-start text-white transition active:scale-[.98] hover:bg-white/[.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
    >
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-white/20"
        style={{ background: `linear-gradient(155deg, rgba(255,255,255,.22), rgba(0,0,0,.25)), ${t.color}` }}
      >
        <t.icon className="h-4 w-4" strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-bold leading-tight">{rtl ? t.labelAr : t.label}</span>
        <span className="block truncate text-[9px] leading-tight text-white/50">{rtl ? t.label : t.labelAr}</span>
      </span>
      {rtl
        ? <ChevronLeft className="h-4 w-4 shrink-0 text-white/35" />
        : <ChevronRight className="h-4 w-4 shrink-0 text-white/35" />}
    </button>
  );

  const SectionTitle = ({ ar, en, extra }: { ar: string; en: string; extra?: string }) => (
    <div className="mb-2 mt-1 flex items-center justify-between gap-2 px-0.5">
      <h2 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.18em] text-white/55">
        <span className="inline-block h-3 w-1 rounded-full bg-amber-400/80" />
        {rtl ? ar : en}
      </h2>
      {extra && <span className="truncate text-[10px] text-white/35">{extra}</span>}
    </div>
  );

  return (
    <div
      className="min-h-full w-full min-w-0 px-2.5 pb-4 pt-2.5 text-white sm:px-3"
      style={{
        background: `radial-gradient(120% 70% at 50% 0%, rgba(59,130,246,.16), transparent 62%), radial-gradient(90% 50% at 100% 100%, rgba(47,174,78,.12), transparent 60%), ${dashBg}`,
      }}
    >
      <div className="mx-auto w-full max-w-6xl space-y-3">
        {/* ===== brand hero ===== */}
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#173a6b] via-[#102a52] to-[#0a1a33] p-3.5 shadow-[0_18px_40px_-24px_rgba(0,0,0,.95)] sm:p-4">
          <div className="pointer-events-none absolute -right-12 -top-16 size-40 rounded-full bg-amber-400/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-16 -left-10 size-36 rounded-full bg-emerald-400/15 blur-3xl" />
          <div className="relative flex items-center gap-3">
            <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#facc15] to-[#d97706] shadow-lg shadow-amber-900/40 ring-1 ring-white/30 sm:size-14">
              <svg viewBox="0 0 24 24" className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden="true">
                <path d="M12 4v8m0 0-5 7m5-7 5 7" fill="none" stroke="#3b2a05" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[9px] font-bold tracking-[.3em] text-amber-300/85">YASCO ERP</p>
              <h1 className="truncate text-[19px] font-extrabold leading-tight text-white sm:text-2xl">{brandAr}</h1>
              <p className="truncate text-[10px] text-white/60 sm:text-[11px]">
                {rtl ? "المقاولات — المشاريع والمخازن والفواتير" : "Construction — projects, stock & invoices"}
                <span className="mx-1 text-white/25">•</span>
                <span className="font-mono">{brandEn}</span>
              </p>
            </div>
          </div>
          <div className="relative mt-3 flex items-stretch gap-2">
            <button
              onClick={() => navigate("/app/construction/sahl/sales")}
              className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#2fae4e] px-3 py-2.5 text-[12px] font-extrabold text-white shadow-lg shadow-emerald-950/40 ring-1 ring-white/20 transition active:scale-[.98] hover:brightness-110"
            >
              <Plus className="h-4 w-4 shrink-0" />
              <span className="truncate">{rtl ? "فاتورة جديدة" : "New invoice"}</span>
            </button>
            <button
              onClick={() => navigate("/app/construction/sahl/reports/period")}
              className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white/10 px-3 py-2.5 text-[12px] font-bold text-white ring-1 ring-white/20 backdrop-blur transition active:scale-[.98] hover:bg-white/15"
            >
              <FileBarChart className="h-4 w-4 shrink-0" />
              <span className="truncate">{rtl ? "تقرير الفترة" : "Period report"}</span>
            </button>
          </div>
        </div>

        {/* ===== live KPIs (real persisted sales) ===== */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {kpis.map((k) => (
            <div
              key={k.l}
              className="min-w-0 rounded-2xl border border-white/10 bg-white/[.045] px-2.5 py-2 shadow-inner shadow-black/30"
              title={`${k.l} / ${k.a}`}
            >
              <div className="truncate text-[10px] leading-tight text-white/55">{rtl ? k.a : k.l}</div>
              <div className="mt-0.5 truncate font-mono text-[17px] font-bold leading-tight tabular-nums sm:text-lg" style={{ color: k.c }}>
                {fmt(Number(k.v ?? 0))}
              </div>
            </div>
          ))}
        </div>

        {/* ===== primary modules ===== */}
        <section>
          <SectionTitle ar="الوحدات الأساسية" en="Core modules" />
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {topTiles.map((t) => <SahlTile key={t.label} t={t} />)}
          </div>
        </section>

        {/* ===== daily operations ===== */}
        <section>
          <SectionTitle ar="العمليات اليومية" en="Daily operations" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {txnTiles.map((t) => <SahlTile key={t.label} t={t} />)}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {txnTiles2.map((t) => <SahlTile key={t.label} t={t} />)}
          </div>
        </section>

        {/* ===== reports ===== */}
        <section>
          <SectionTitle ar="التقارير" en="Reports" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[...reportTiles, ...utilTiles].map((t) => <SahlTile key={t.label} t={t} />)}
          </div>
        </section>

        {/* ===== sales analysis (real persisted data only) ===== */}
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[.04]">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-white/[.05] px-3 py-2">
            <span className="min-w-0 truncate text-[12px] font-bold text-white">
              {rtl ? "تحليل المبيعات — آخر 6 أشهر" : "Sales analysis — last 6 months"}
            </span>
            <button
              onClick={() => navigate("/app/construction/sahl/sales")}
              className="flex shrink-0 items-center gap-1 rounded-lg bg-[#2fae4e] px-2 py-1 text-[10px] font-bold text-white transition active:scale-95 hover:brightness-110"
            >
              <Plus className="h-3 w-3" />
              {rtl ? "فاتورة" : "Invoice"}
            </button>
          </div>
          <div className="p-3">
            <div className="mb-2 grid grid-cols-2 gap-1.5 text-[10px] text-white/60 sm:grid-cols-4">
              <span className="truncate">{rtl ? "إجمالي الفواتير" : "Invoiced"}: <b className="font-mono text-white tabular-nums">{fmt(totalInvoiced)}</b></span>
              <span className="truncate">{rtl ? "العقود" : "Contracts"}: <b className="font-mono text-white tabular-nums">{fmt(totalContractValue)}</b></span>
              <span className="truncate">{rtl ? "المتبقي" : "Outstanding"}: <b className="font-mono text-white tabular-nums">{fmt(outstanding)}</b></span>
              <span className="truncate">{rtl ? "المشاريع النشطة" : "Active"}: <b className="font-mono text-white tabular-nums">{stats?.activeProjects ?? activeProjects.length}</b></span>
            </div>
            <div className="flex h-[96px] items-end gap-1.5 rounded-xl border border-white/10 bg-black/35 p-1.5" dir="ltr">
              {monthlySales.arr.map((m) => (
                <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-0.5" title={`${m.month}: ${fmt(m.total)}`}>
                  <span className="text-[8px] text-white/55 tabular-nums">{m.total >= 1000 ? `${Math.round(m.total / 1000)}k` : m.total}</span>
                  <div
                    className="w-full rounded-t-sm bg-gradient-to-t from-[#1f8a3d] to-[#4ade80]"
                    style={{ height: `${Math.max(4, Math.round((m.total / monthlySales.max) * 64))}px` }}
                  />
                  <span className="text-[8px] text-white/50">{m.month}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== management ===== */}
        <section>
          <SectionTitle
            ar="الإدارة والمتابعة"
            en="Management & follow-up"
            extra={`${(sahl as any)?.invoiceCount ?? 0} ${rtl ? "فاتورة" : "invoices"} · ${(sahl as any)?.customerCount ?? 0} ${rtl ? "عميل" : "customers"}`}
          />
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {mgmtTiles.map((t) => <SahlRow key={t.label} t={t} />)}
          </div>
        </section>

        {/* ===== recent invoices ===== */}
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[.04]">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
            <span className="truncate text-[12px] font-bold">{rtl ? "أحدث الفواتير" : "Recent invoices"}</span>
            <button
              onClick={() => navigate("/app/construction/sahl/sales")}
              className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold text-emerald-300 transition hover:bg-white/10"
            >
              {rtl ? "عرض الكل" : "View all"}
            </button>
          </div>
          {recentInvoices.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12px] text-white/45">
              {rtl ? "لا توجد فواتير بعد" : "No invoices yet"}
            </p>
          ) : (
            <>
              {/* phone: card rows, no horizontal table overflow */}
              <div className="divide-y divide-white/10 px-3 sm:hidden">
                {recentInvoices.map((inv: any) => (
                  <div key={inv.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-semibold">{inv.customerName || "—"}</div>
                      <div className="truncate font-mono text-[10px] text-white/45">
                        {inv.invoiceNumber} · {inv.status}
                      </div>
                    </div>
                    <div className="shrink-0 font-mono text-[13px] font-bold tabular-nums text-emerald-300">
                      {fmt(Number(inv.totalAmount || 0))}
                    </div>
                  </div>
                ))}
              </div>
              {/* tablet/desktop: compact table */}
              <div className="hidden sm:block">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-white/[.06] text-white/70">
                      <th className="px-2 py-1.5 text-start font-semibold">{rtl ? "الرقم" : "No."}</th>
                      <th className="px-2 py-1.5 text-start font-semibold">{rtl ? "العميل" : "Customer"}</th>
                      <th className="px-2 py-1.5 text-end font-semibold">{rtl ? "الإجمالي" : "Total"}</th>
                      <th className="px-2 py-1.5 text-start font-semibold">{rtl ? "الحالة" : "Status"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentInvoices.map((inv: any) => (
                      <tr key={inv.id} className="border-t border-white/10 odd:bg-white/[.02]">
                        <td className="px-2 py-1.5 font-mono">{inv.invoiceNumber}</td>
                        <td className="max-w-[160px] truncate px-2 py-1.5">{inv.customerName || ""}</td>
                        <td className="px-2 py-1.5 text-end font-mono tabular-nums">{fmt(Number(inv.totalAmount || 0))}</td>
                        <td className="px-2 py-1.5">{inv.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/10 px-3 py-2 text-[10px] text-white/55">
            <span>{(sahl as any)?.productCount ?? 0} {rtl ? "صنف" : "items"}</span>
            <span className="text-white/20">·</span>
            <span>{rtl ? "المشاريع" : "Projects"}: <b className="font-mono text-white">{activeProjects.length}</b></span>
            <span className="text-white/20">·</span>
            <button onClick={() => navigate("/app/construction/sahl/contracts")} className="rounded px-1 py-0.5 font-semibold text-emerald-300 hover:bg-white/10">{rtl ? "العقود" : "Contracts"}</button>
            <button onClick={() => navigate("/app/construction/daily-reports")} className="rounded px-1 py-0.5 font-semibold text-emerald-300 hover:bg-white/10">{rtl ? "التقارير اليومية" : "Daily reports"}</button>
            <button onClick={() => navigate("/app/construction/hse")} className="rounded px-1 py-0.5 font-semibold text-emerald-300 hover:bg-white/10">{rtl ? "السلامة" : "HSE"}</button>
          </div>
        </section>

        {/* ===== support + appearance ===== */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[.03] px-3 py-2">
          <button
            onClick={() => setShowSupport(true)}
            className="flex items-center gap-1.5 rounded-xl bg-[#e05242] px-3 py-2 text-[11px] font-bold text-white shadow-lg shadow-rose-950/30 ring-1 ring-white/20 transition active:scale-95 hover:brightness-110"
          >
            <Headset className="h-4 w-4" />
            {rtl ? "الدعم الفني" : "Support"}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/45">{rtl ? "الخلفية" : "Theme"}</span>
            <div className="flex items-center gap-1.5">
              {DASH_BGS.map((bg) => (
                <button
                  key={bg}
                  onClick={() => changeBg(bg)}
                  title={bg}
                  aria-label={bg}
                  className="size-6 rounded-full ring-2 transition active:scale-95"
                  style={{
                    background: bg,
                    borderColor: dashBg === bg ? "#facc15" : "rgba(255,255,255,.28)",
                    outline: dashBg === bg ? "2px solid #facc15" : "1px solid rgba(255,255,255,.18)",
                    outlineOffset: 1,
                  }}
                />
              ))}
            </div>
            <FeedbackChip rtl={rtl} onOpen={() => { setStep(0); setTour(true); }} />
          </div>
        </div>
      </div>

      {whOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setWhOpen(false)}>
          <div className="max-h-[85vh] w-full max-w-xs overflow-y-auto rounded-2xl border border-white/15 bg-[#161616] p-4 text-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <b className="truncate text-[13px]">{rtl ? "إضافة مخزن جديد" : "Add a new warehouse"}</b>
              <button onClick={() => setWhOpen(false)} className="shrink-0 text-white/60 hover:text-white"><X className="h-4 w-4" /></button>
            </div>
            <input
              autoFocus
              value={whName}
              onChange={(e) => setWhName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && whName.trim()) {
                  const code = `WH-${Date.now().toString().slice(-6)}`;
                  addWarehouse.mutate({ name: whName.trim(), code });
                }
              }}
              placeholder={rtl ? "اسم المخزن" : "Warehouse name"}
              className="w-full rounded-lg border border-white/25 bg-black/40 px-2 py-2 text-[12px] text-white outline-none focus:border-emerald-400"
            />
            {whMsg && <div className="mt-1 text-[11px] text-emerald-300">{whMsg}</div>}
            <button
              className="mt-3 w-full rounded-lg px-3 py-2 text-[12px] font-bold text-white transition active:scale-[.98] disabled:opacity-50"
              style={{ background: C.green }}
              disabled={!whName.trim() || addWarehouse.isPending}
              onClick={() => {
                const code = `WH-${Date.now().toString().slice(-6)}`;
                addWarehouse.mutate({ name: whName.trim(), code });
              }}
            >
              {addWarehouse.isPending ? (rtl ? "جارٍ الحفظ..." : "Saving...") : (rtl ? "إضافة" : "Add")}
            </button>
          </div>
        </div>
      )}

      {showSupport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowSupport(false)}>
          <div className="max-h-[85vh] w-full max-w-xs overflow-y-auto rounded-2xl border border-white/15 bg-[#161616] p-4 text-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <b className="truncate text-[13px]">{rtl ? "الدعم الفني" : "Technical support"}</b>
              <button onClick={() => setShowSupport(false)} className="shrink-0 text-white/60 hover:text-white"><X className="h-4 w-4" /></button>
            </div>
            <p className="text-[12px] leading-relaxed text-white/85">
              {rtl
                ? "للدعم: تواصل مع مدير النظام من صفحة المستخدمين، أو راجع سجل الحركات من التقارير."
                : "For support: contact your system administrator from the Users page, or review Reports."}
            </p>
            <button onClick={() => { setShowSupport(false); navigate("/app/construction/sahl/users"); }}
              className="mt-3 w-full rounded-lg px-3 py-2 text-[12px] font-bold text-white transition active:scale-[.98]" style={{ background: C.green }}>
              {rtl ? "المستخدمون" : "Users"}
            </button>
          </div>
        </div>
      )}

      {tour && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setTour(false)}>
          <div className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-2xl border border-white/15 bg-[#161616] p-4 text-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <b className="truncate text-[13px]">{rtl ? "جولة تعريفية" : "Guided tour"} ({step + 1}/{TOUR_STEPS.length})</b>
              <button onClick={() => setTour(false)} className="shrink-0 text-white/60 hover:text-white"><X className="h-4 w-4" /></button>
            </div>
            <p className="min-h-[44px] text-[12px] leading-relaxed text-white/85">{rtl ? TOUR_STEPS[step].ar : TOUR_STEPS[step].en}</p>
            <div className="mt-3 flex justify-between gap-2">
              <button disabled={step === 0} onClick={() => setStep(step - 1)} className="rounded-lg border border-white/30 px-3 py-1.5 text-[12px] transition disabled:opacity-40">{rtl ? "السابق" : "Back"}</button>
              {step < TOUR_STEPS.length - 1
                ? <button onClick={() => setStep(step + 1)} className="rounded-lg px-3 py-1.5 text-[12px] font-bold text-white transition active:scale-95" style={{ background: C.green }}>{rtl ? "التالي" : "Next"}</button>
                : <button onClick={() => { setTour(false); navigate("/app/construction/sahl/sales"); }} className="rounded-lg px-3 py-1.5 text-[12px] font-bold text-white transition active:scale-95" style={{ background: C.green }}>{rtl ? "ابدأ — فاتورة جديدة" : "Start — new invoice"}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FeedbackChip({ rtl, onOpen }: { rtl: boolean; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex items-center gap-1 rounded-full border border-white/15 bg-white/[.06] px-2 py-1 text-[10px] font-semibold text-white/70 transition hover:bg-white/10 active:scale-95"
    >
      <Sparkles className="h-3 w-3" />
      {rtl ? "جولة" : "Tour"}
    </button>
  );
}
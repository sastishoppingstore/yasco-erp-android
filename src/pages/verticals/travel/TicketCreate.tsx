import { useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { useLanguage } from "@/providers/language";
import { Plane, Plus, Trash2, Save, Printer, Users, FileText, ShieldCheck, Search, History, X } from "lucide-react";
import { calcTravelLine, computeTravelTotals, fmtNum, type PricingMode, type VatMode } from "@/lib/travelCalc";
import { printTravelTicket } from "@/lib/travelPrint";

/* ─────────────────────────────────────────────────────────────────────────
   Sahl-style dense ERP primitives (local to the Travel module — the Sahl
   construction module is reference-only and is NOT imported/modified).
   ───────────────────────────────────────────────────────────────────────── */
const inputCls =
  "w-full border border-[#777] bg-white px-1.5 py-1 text-[12px] text-black outline-none focus:border-black placeholder:text-[#999]";
const btnCls =
  "border border-[#555] bg-[#f5f5f5] px-2.5 py-1 text-[12px] text-black hover:bg-white active:bg-[#ddd] disabled:opacity-50";
const GREEN = "#2fae4e";
const GREEN_DARK = "#1d7a37";

function SectionHead({ n, children }: { n?: number; children: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center gap-2 px-2 py-1 text-[12px] font-bold text-black" style={{ background: "#c8e6c9" }}>
      {n != null && (
        <span className="flex size-5 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: GREEN }}>
          {n}
        </span>
      )}
      <span>{children}</span>
    </div>
  );
}

function FuncKey({
  k,
  label,
  onClick,
  color,
  disabled,
  icon: Icon,
}: {
  k: string;
  label: string;
  onClick?: () => void;
  color?: string;
  disabled?: boolean;
  icon?: typeof Plane;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-w-[72px] flex-col items-center gap-0.5 border border-black px-2 py-1 text-[11px] leading-tight text-white hover:brightness-110 disabled:opacity-40"
      style={{ background: color ?? "#455a64" }}
    >
      <span className="flex items-center gap-1 font-bold">
        {Icon && <Icon className="size-3.5" />}
        {k}
      </span>
      <span className="opacity-90">{label}</span>
    </button>
  );
}

function Field({ label, children, w }: { label: string; children: ReactNode; w?: string }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px]">
      <b className={`shrink-0 text-[#333] ${w ?? "w-[92px]"}`}>{label}</b>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

type Mode = "zatca" | "non_tax";

interface Row {
  description: string;
  descriptionAr: string;
  route: string;
  ticketRef: string;
  quantity: number;
  unitPrice: string;
  /** Base Price / net ticket cost (non-taxable supplier fare). */
  baseFare: string;
  /** Sale Price (base + agency profit) — profit = sale − base. */
  salePrice: string;
  /** Legacy manual service fee (kept for backward compatibility). */
  serviceFee: string;
}

const newRow = (): Row => ({ description: "", descriptionAr: "", route: "", ticketRef: "", quantity: 1, unitPrice: "", baseFare: "", salePrice: "", serviceFee: "" });
const today = () => new Date().toISOString().slice(0, 10);
const num = (v: string) => (v === "" ? 0 : Number(v) || 0);
/** Per-unit agency profit = sale price − base price (never negative). */
const profitOf = (r: Row) => Math.max(0, num(r.salePrice) - num(r.baseFare));

export default function TravelTicketCreate() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { language } = useLanguage();
  const rtl = language === "ar";
  const T = (en: string, ar: string) => (rtl ? ar : en);
  const utils = trpc.useUtils();
  const bookingId = params.get("bookingId") ? Number(params.get("bookingId")) : undefined;

  const { data: settingsData } = trpc.travel.settingsGet.useQuery();
  const company = settingsData?.company as any;
  const tset = settingsData?.settings as any;
  const sellerVat = String(company?.taxNumber || "");
  const vatReady = /^\d{15}$/.test(sellerVat);

  const [mode, setMode] = useState<Mode>("zatca");
  const [pricingMode, setPricingMode] = useState<PricingMode>("margin");
  const [vatMode, setVatMode] = useState<VatMode>("exclusive");
  const [nonTaxKind, setNonTaxKind] = useState<"0" | "15" | "custom">("0");
  const [vatPercent, setVatPercent] = useState<number>(0);

  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerNameAr, setCustomerNameAr] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerVat, setCustomerVat] = useState("");

  const [date, setDate] = useState(today());
  const [dueDate, setDueDate] = useState(today());
  const [paidAmount, setPaidAmount] = useState("");
  const [notes, setNotes] = useState("");

  const [travelType, setTravelType] = useState("flight");
  const [serviceRef, setServiceRef] = useState("");
  const [pnr, setPnr] = useState("");
  const [ticketNumber, setTicketNumber] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [passengerName, setPassengerName] = useState("");
  const [rows, setRows] = useState<Row[]>([{ ...newRow(), description: "JED-MCT-BOM" }]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);

  const effectiveVat = mode === "zatca" ? 15 : (nonTaxKind === "custom" ? vatPercent : Number(nonTaxKind));
  const isMargin = pricingMode === "margin";

  const lineCalcs = useMemo(
    () => rows.map((r) => calcTravelLine(
      { quantity: Number(r.quantity) || 0, unitPrice: num(r.unitPrice), baseFare: num(r.baseFare), salePrice: num(r.salePrice), serviceFee: num(r.serviceFee) },
      pricingMode, vatMode, effectiveVat,
    )),
    [rows, pricingMode, vatMode, effectiveVat],
  );

  const totals = useMemo(
    () => computeTravelTotals(
      rows.map((r) => ({ quantity: Number(r.quantity) || 0, unitPrice: num(r.unitPrice), baseFare: num(r.baseFare), salePrice: num(r.salePrice), serviceFee: num(r.serviceFee) })),
      pricingMode, vatMode, effectiveVat,
    ),
    [rows, pricingMode, vatMode, effectiveVat],
  );

  const balanceDue = Math.max(0, Math.round((totals.totalAmount - num(paidAmount)) * 100) / 100);

  const create = trpc.travel.ticketCreate.useMutation({
    onSuccess: (res: any) => {
      setErr(null);
      setSavedId(res.travelInvoiceId);
      setMsg(res.zatcaError
        ? T(`Saved ${res.invoiceNumber}. ZATCA signing deferred: ${res.zatcaError}`, `تم الحفظ ${res.invoiceNumber}. تأجيل توقيع الهيئة: ${res.zatcaError}`)
        : T(`Saved ${res.invoiceNumber} ✓`, `تم الحفظ ${res.invoiceNumber} ✓`));
      utils.travel.ticketList.invalidate();
      utils.travel.travelDashboard.invalidate();
    },
    onError: (e: any) => { setMsg(null); setErr(e?.message || "Save failed"); },
  });

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const canSave = rows.some((r) => r.description.trim().length > 0) && (mode === "non_tax" || vatReady);

  function buildItems() {
    return rows
      .filter((r) => r.description.trim() || r.route.trim() || num(r.baseFare) || num(r.salePrice) || num(r.unitPrice))
      .map((r) => ({
        description: r.description.trim() || r.route.trim() || "Air Ticket",
        descriptionAr: r.descriptionAr.trim() || undefined,
        ticketRef: r.ticketRef.trim() || undefined,
        route: r.route.trim() || undefined,
        quantity: Number(r.quantity) || 1,
        unitPrice: pricingMode === "standard" ? num(r.unitPrice) : undefined,
        baseFare: isMargin ? num(r.baseFare) : undefined,
        salePrice: isMargin ? num(r.salePrice) : undefined,
      }));
  }

  async function save() {
    setErr(null);
    const items = buildItems();
    if (!items.length) { setErr(T("Add at least one ticket line.", "أضف بند تذكرة واحداً على الأقل.")); return; }
    try {
      await create.mutateAsync({
        mode,
        pricingMode,
        vatMode,
        vatPercent: mode === "non_tax" ? effectiveVat : undefined,
        customerId: customerId ?? undefined,
        customerName: customerName.trim() || undefined,
        customerNameAr: customerNameAr.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        customerVat: customerVat.trim() || undefined,
        bookingId,
        travelType: travelType as any,
        serviceRef: serviceRef.trim() || undefined,
        pnr: pnr.trim() || undefined,
        ticketNumber: ticketNumber.trim() || undefined,
        origin: origin.trim() || undefined,
        destination: destination.trim() || undefined,
        passengerName: passengerName.trim() || customerName.trim() || undefined,
        date,
        dueDate: dueDate || undefined,
        paidAmount: num(paidAmount),
        notes: notes.trim() || undefined,
        items,
      });
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  async function printSaved() {
    if (!savedId) return;
    const detail = await utils.travel.ticketGet.fetch({ id: savedId });
    await printTravelTicket(detail as any);
  }

  function resetForm() {
    setRows([{ ...newRow(), description: "JED-MCT-BOM" }]);
    setCustomerId(null); setCustomerName(""); setCustomerNameAr(""); setCustomerPhone(""); setCustomerVat("");
    setPassengerName(""); setServiceRef(""); setPnr(""); setTicketNumber(""); setOrigin(""); setDestination("");
    setPaidAmount(""); setNotes(""); setSavedId(null); setMsg(null); setErr(null);
    setDate(today()); setDueDate(today());
  }

  return (
    <div dir="ltr" className="flex min-h-full flex-col bg-white text-[12px] text-black">
      {/* ===== Top action bar ===== */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#bbb] px-2 py-1.5" style={{ background: `linear-gradient(180deg, ${GREEN} 0%, ${GREEN_DARK} 100%)` }}>
        <span className="flex items-center gap-2 text-[15px] font-bold text-white">
          <Plane className="size-5" /> {T("Travel — Ticket / Invoice", "السفر — تذكرة / فاتورة")}
        </span>
        <span className="border border-white/50 bg-white/15 px-2 py-0.5 text-[11px] text-white">
          {tset?.invoicePrefix || "TICK-"}
        </span>
        <span className="ms-auto flex flex-wrap items-center gap-1">
          <button type="button" className={`${btnCls} flex items-center gap-1`} onClick={resetForm}>
            <FileText className="size-3.5" />{T("New", "جديد")}
          </button>
          <button type="button" className={`${btnCls} flex items-center gap-1`} onClick={() => navigate("/app/verticals/travel/tickets")}>
            <History className="size-3.5" />{T("History", "السجل")}
          </button>
          {savedId && (
            <button type="button" className={`${btnCls} flex items-center gap-1`} onClick={printSaved}>
              <Printer className="size-3.5" />{T("Print", "طباعة")}
            </button>
          )}
          <button type="button" className={`${btnCls} flex items-center gap-1`} onClick={save} disabled={!canSave || create.isPending}
            style={{ background: "#fff", borderColor: "#0a5c2a", color: "#0a5c2a", fontWeight: 700 }}>
            <Save className="size-3.5" />{create.isPending ? T("Saving…", "جارٍ الحفظ…") : T("Save (F9)", "حفظ (F9)")}
          </button>
        </span>
      </div>

      {msg && (
        <div className="flex items-center justify-between gap-3 border-b border-emerald-300 bg-emerald-50 px-3 py-1.5 text-emerald-800">
          <span>{msg}</span>
          <button type="button" className={btnCls} onClick={printSaved}><Printer className="inline size-3.5 me-1" />{T("Print", "طباعة")}</button>
        </div>
      )}
      {err && <div className="border-b border-red-300 bg-red-50 px-3 py-1.5 text-red-700">{err}</div>}
      {mode === "zatca" && !vatReady && (
        <div className="border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-800">
          {T("Seller VAT/TIN must be a 15-digit number in Travel Settings before a ZATCA invoice can be issued.", "يجب إدخال الرقم الضريبي (١٥ رقم) في إعدادات السفر قبل إصدار فاتورة الهيئة.")}
        </div>
      )}

      {/* ===== Zone 2: header summary + entry form ===== */}
      <div className="flex items-start gap-2 border-b border-[#bbb] bg-[#f4f4f4] p-1.5">
        {/* Left: document mode + grand total */}
        <div className="flex w-[150px] shrink-0 flex-col gap-1">
          <div className="border p-1 text-center" style={{ borderColor: GREEN_DARK, background: GREEN }}>
            <div className="text-[10px] text-white/90">{T("Document", "المستند")}</div>
            <div className="font-mono text-[16px] font-bold leading-tight text-white">{mode === "zatca" ? "ZATCA" : "NON-TAX"}</div>
          </div>
          <div className="border p-1 text-center" style={{ borderColor: "#c8a419", background: "#ffeb3b" }}>
            <div className="text-[10px] text-black/70">{T("Total due", "الرصيد المستحق")}</div>
            <div className="font-mono text-[17px] font-bold leading-tight text-black tabular-nums">{fmtNum(totals.totalAmount)}</div>
          </div>
          {savedId && (
            <div className="border border-[#1b6fa8] bg-[#e3f2fd] p-1 text-center text-[10px] leading-tight text-[#0f4c75]">
              {T("Saved id", "المعرّف")}: <b>{savedId}</b>
            </div>
          )}
        </div>

        {/* Center: dense entry chain */}
        <div className="min-w-0 flex-1">
          {/* Invoice type — exactly two options */}
          <div className="mb-1.5 grid grid-cols-2 gap-1.5">
            <button type="button" onClick={() => setMode("zatca")}
              className="flex items-start gap-2 border-2 p-1.5 text-start"
              style={mode === "zatca" ? { borderColor: GREEN, background: "#e8f5e9" } : { borderColor: "#ccc", background: "#fff" }}>
              <ShieldCheck className="mt-0.5 size-4 shrink-0" style={{ color: GREEN_DARK }} />
              <span>
                <span className="block text-[12px] font-bold" style={{ color: "#0a5c2a" }}>{T("Option 1 — ZATCA Simplified Tax Invoice", "الخيار ١ — فاتورة ضريبية مبسطة")}</span>
                <span className="block text-[10px] text-[#555]">{T("Automatic 15% VAT + signed Phase-2 XML + TLV QR.", "ضريبة ١٥٪ تلقائية + توقيع فوري + رمز QR.")}</span>
              </span>
            </button>
            <button type="button" onClick={() => setMode("non_tax")}
              className="flex items-start gap-2 border-2 p-1.5 text-start"
              style={mode === "non_tax" ? { borderColor: "#455a64", background: "#eceff1" } : { borderColor: "#ccc", background: "#fff" }}>
              <FileText className="mt-0.5 size-4 shrink-0 text-[#455a64]" />
              <span>
                <span className="block text-[12px] font-bold text-[#37474f]">{T("Option 2 — Non-Tax / Manual VAT", "الخيار ٢ — غير ضريبية / ضريبة يدوية")}</span>
                <span className="block text-[10px] text-[#555]">{T("Pick 0% / 15% / custom. No ZATCA report; QR hidden at 0%.", "اختر ٠٪ أو ١٥٪ أو مخصص. بدون رفع للهيئة وبدون QR عند ٠٪.")}</span>
              </span>
            </button>
          </div>

          {/* Pricing & VAT */}
          <div className="border border-[#bbb] bg-white">
            <SectionHead n={1}>{T("Pricing & VAT", "التسعير والضريبة")}</SectionHead>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 p-1.5 lg:grid-cols-4">
              <Field label={T("Scheme", "النظام")}>
                <select className={inputCls} value={pricingMode} onChange={(e) => setPricingMode(e.target.value as PricingMode)}>
                  <option value="margin">{T("Margin — Base price + Sale price", "هامش — سعر التكلفة + سعر البيع")}</option>
                  <option value="standard">{T("Standard — whole price taxable", "قياسي — السعر كاملاً خاضع")}</option>
                </select>
              </Field>
              {isMargin && (
                <Field label={T("VAT on profit", "الضريبة على الربح")}>
                  <select className={inputCls} value={vatMode} onChange={(e) => setVatMode(e.target.value as VatMode)}>
                    <option value="exclusive">{T("Exclusive (add VAT on profit)", "غير شامل (تُضاف على الربح)")}</option>
                    <option value="inclusive">{T("Inclusive (profit has VAT)", "شامل (الربح يتضمن الضريبة)")}</option>
                  </select>
                </Field>
              )}
              <Field label={T("VAT %", "النسبة")}>
                {mode === "zatca" ? (
                  <input className={`${inputCls} bg-[#e8f5e9] font-bold`} value="15% (ZATCA)" readOnly />
                ) : (
                  <span className="flex gap-1">
                    <select className={`${inputCls} w-24`} value={nonTaxKind} onChange={(e) => setNonTaxKind(e.target.value as any)}>
                      <option value="0">0%</option>
                      <option value="15">15%</option>
                      <option value="custom">{T("Custom", "مخصص")}</option>
                    </select>
                    {nonTaxKind === "custom" && <input type="number" min={0} max={100} className={inputCls} value={vatPercent} onChange={(e) => setVatPercent(Number(e.target.value))} />}
                  </span>
                )}
              </Field>
              <Field label={T("Service type", "نوع الخدمة")}>
                <select className={inputCls} value={travelType} onChange={(e) => setTravelType(e.target.value)}>
                  {["flight", "hotel", "package", "car_rental", "insurance", "visa", "other"].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        </div>
      </div>

      {/* ===== Customer + document details ===== */}
      <div className="grid grid-cols-1 gap-1.5 border-b border-[#bbb] p-1.5 lg:grid-cols-2">
        <div className="border border-[#bbb] bg-white">
          <SectionHead n={2}>{T("Customer / Passenger", "العميل / المسافر")}</SectionHead>
          <div className="space-y-1.5 p-1.5">
            <div className="flex items-center gap-1.5">
              <button type="button" className={`${btnCls} flex items-center gap-1`} onClick={() => setPickerOpen(true)}>
                <Users className="size-3.5" />{customerId ? T(`Customer #${customerId}`, `العميل #${customerId}`) : T("Select / walk-in", "اختيار / عابر")}
              </button>
              {customerId && <button type="button" className={btnCls} onClick={() => { setCustomerId(null); setCustomerName(""); setCustomerNameAr(""); setCustomerPhone(""); setCustomerVat(""); }}>
                <X className="size-3.5" />
              </button>}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <Field label={T("Name EN", "الاسم EN")}><input className={`${inputCls} uppercase`} value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="SAMSAD ALI/MR" /></Field>
              <Field label={T("Name AR", "الاسم AR")}><input dir="rtl" className={inputCls} value={customerNameAr} onChange={(e) => setCustomerNameAr(e.target.value)} /></Field>
              <Field label={T("Phone", "الهاتف")}><input className={inputCls} value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} /></Field>
              <Field label={T("Buyer VAT", "الرقم الضريبي")}><input className={inputCls} maxLength={15} value={customerVat} onChange={(e) => setCustomerVat(e.target.value)} /></Field>
            </div>
            <Field label={T("Passenger", "المسافر")}><input className={inputCls} value={passengerName} onChange={(e) => setPassengerName(e.target.value)} placeholder={T("Name as on passport", "كما في الجواز")} /></Field>
          </div>
        </div>

        <div className="border border-[#bbb] bg-white">
          <SectionHead n={3}>{T("Ticket / Document", "التذكرة / المستند")}</SectionHead>
          <div className="space-y-1.5 p-1.5">
            <div className="grid grid-cols-3 gap-x-3 gap-y-1.5">
              <Field label={T("Date", "التاريخ")} w="w-[52px]"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label={T("Due", "الاستحقاق")} w="w-[52px]"><input type="date" className={inputCls} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
              <Field label={T("Paid", "المدفوع")} w="w-[44px]"><input type="number" className={inputCls} value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <Field label="PNR"><input className={inputCls} value={pnr} onChange={(e) => setPnr(e.target.value)} /></Field>
              <Field label={T("Ticket #", "رقم التذكرة")}><input className={inputCls} value={ticketNumber} onChange={(e) => setTicketNumber(e.target.value)} /></Field>
              <Field label={T("Origin", "من")}><input className={inputCls} value={origin} onChange={(e) => setOrigin(e.target.value)} /></Field>
              <Field label={T("Destination", "إلى")}><input className={inputCls} value={destination} onChange={(e) => setDestination(e.target.value)} /></Field>
            </div>
            <Field label={T("Ref / route", "المرجع / المسار")}><input className={inputCls} value={serviceRef} onChange={(e) => setServiceRef(e.target.value)} placeholder="JED-MCT-BOM" /></Field>
            <Field label={T("Note", "ملاحظة")}><textarea rows={2} className={`${inputCls} resize-y`} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
        </div>
      </div>

      {/* ===== Ticket lines ===== */}
      <div className="border-b border-[#bbb] bg-white p-1.5">
        <div className="mb-1.5 flex items-center justify-between">
          <SectionHead n={4}>{T("Ticket lines (multi-ticket)", "بنود التذاكر (متعدد)")}</SectionHead>
          <button type="button" className={`${btnCls} flex items-center gap-1`} onClick={() => setRows((rs) => [...rs, newRow()])}>
            <Plus className="size-3.5" />{T("Add row", "إضافة بند")}
          </button>
        </div>
        <div className="overflow-auto border border-[#888]">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr style={{ background: GREEN, color: "#fff" }}>
                <th className="border px-1.5 py-1 font-normal" style={{ borderColor: GREEN_DARK }}>#</th>
                <th className="border px-1.5 py-1 font-normal" style={{ borderColor: GREEN_DARK }}>{T("Item / Description", "الوصف / المنتج")}</th>
                <th className="border px-1.5 py-1 font-normal" style={{ borderColor: GREEN_DARK }}>PNR / {T("Ticket", "تذكرة")}</th>
                <th className="border px-1.5 py-1 font-normal" style={{ borderColor: GREEN_DARK }}>{T("Qty", "الكمية")}</th>
                {isMargin ? (
                  <>
                    <th className="border px-1.5 py-1 font-normal" style={{ borderColor: GREEN_DARK }}>{T("Base price", "سعر التكلفة")}</th>
                    <th className="border px-1.5 py-1 font-normal" style={{ borderColor: GREEN_DARK }}>{T("Sale price", "سعر البيع")}</th>
                    <th className="border px-1.5 py-1 font-normal" style={{ borderColor: GREEN_DARK }}>{T("Profit", "الربح")}</th>
                  </>
                ) : (
                  <th className="border px-1.5 py-1 font-normal" style={{ borderColor: GREEN_DARK }}>{T("Price", "السعر")}</th>
                )}
                <th className="border px-1.5 py-1 font-normal" style={{ borderColor: GREEN_DARK }}>{T("Taxable", "الخاضع")}</th>
                <th className="border px-1.5 py-1 font-normal" style={{ borderColor: GREEN_DARK }}>VAT</th>
                <th className="border px-1.5 py-1 font-normal" style={{ borderColor: GREEN_DARK }}>{T("Amount", "المجموع")}</th>
                <th className="border px-1.5 py-1 font-normal" style={{ borderColor: GREEN_DARK }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const c = lineCalcs[i];
                return (
                  <tr key={i} className="align-top hover:bg-[#f1f8e9]">
                    <td className="border border-[#ccc] px-1 py-1 text-center tabular-nums">{i + 1}</td>
                    <td className="border border-[#ccc] px-1 py-1">
                      <input className={inputCls} value={r.description} onChange={(e) => setRow(i, { description: e.target.value })} placeholder="JED-MCT-BOM" />
                      <input dir="rtl" className={`${inputCls} mt-1`} value={r.descriptionAr} onChange={(e) => setRow(i, { descriptionAr: e.target.value })} placeholder="الوصف بالعربية" />
                    </td>
                    <td className="border border-[#ccc] px-1 py-1"><input className={inputCls} value={r.ticketRef} onChange={(e) => setRow(i, { ticketRef: e.target.value })} /></td>
                    <td className="border border-[#ccc] px-1 py-1"><input type="number" min={1} className={`${inputCls} w-16`} value={r.quantity} onChange={(e) => setRow(i, { quantity: Math.max(1, Number(e.target.value) || 1) })} /></td>
                    {isMargin ? (
                      <>
                        <td className="border border-[#ccc] px-1 py-1"><input type="number" className={`${inputCls} w-24`} value={r.baseFare} onChange={(e) => setRow(i, { baseFare: e.target.value })} placeholder="1500" title={T("Non-taxable net ticket cost", "سعر التكلفة / التذكرة الأساسية")} /></td>
                        <td className="border border-[#ccc] px-1 py-1"><input type="number" className={`${inputCls} w-24`} value={r.salePrice} onChange={(e) => setRow(i, { salePrice: e.target.value })} placeholder="1550" title={T("Customer sale price (base + profit)", "سعر البيع للعميل")} /></td>
                        <td className="border border-[#ccc] px-1 py-1 text-end tabular-nums" style={{ color: "#0a5c2a", fontWeight: 700 }}>{(c?.margin ?? profitOf(r)).toFixed(2)}</td>
                      </>
                    ) : (
                      <td className="border border-[#ccc] px-1 py-1"><input type="number" className={`${inputCls} w-24`} value={r.unitPrice} onChange={(e) => setRow(i, { unitPrice: e.target.value })} /></td>
                    )}
                    <td className="border border-[#ccc] px-1 py-1 text-end tabular-nums">{c?.taxable.toFixed(2)}</td>
                    <td className="border border-[#ccc] px-1 py-1 text-end tabular-nums">{c?.vat.toFixed(2)}</td>
                    <td className="border border-[#ccc] px-1 py-1 text-end font-bold tabular-nums">{c?.total.toFixed(2)}</td>
                    <td className="border border-[#ccc] px-1 py-1 text-center">
                      <button type="button" className="text-red-500 hover:text-red-700 disabled:opacity-30" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))} disabled={rows.length === 1}>
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== Totals + F-keys ===== */}
      <div className="flex flex-wrap items-end justify-between gap-3 bg-[#f4f4f4] p-2">
        <div className="flex flex-wrap items-center gap-1">
          <FuncKey k="F2" label={T("Save", "حفظ")} color={GREEN} icon={Save} onClick={save} disabled={!canSave || create.isPending} />
          <FuncKey k="F4" label={T("New", "جديد")} icon={FileText} onClick={resetForm} />
          <FuncKey k="F3" label={T("History", "السجل")} icon={History} onClick={() => navigate("/app/verticals/travel/tickets")} />
          <FuncKey k="F9" label={T("Print", "طباعة")} color="#1b9bd7" icon={Printer} onClick={printSaved} disabled={!savedId} />
          <FuncKey k="Esc" label={T("Exit", "خروج")} color="#b71c1c" icon={X} onClick={() => navigate("/app/verticals/travel/dashboard")} />
        </div>

        <div className="w-full max-w-sm border border-[#bbb] bg-white text-[12px]">
          <div className="flex justify-between border-b border-[#e0e0e0] px-2 py-1"><span className="text-[#555]">{T("Base price / non-taxable", "سعر التكلفة / غير خاضع")}</span><span className="tabular-nums">{fmtNum(totals.nonTaxableAmount)}</span></div>
          <div className="flex justify-between border-b border-[#e0e0e0] px-2 py-1"><span className="text-[#555]">{T("Agency profit (margin)", "ربح الوكالة (الهامش)")}</span><span className="tabular-nums font-semibold text-[#0a5c2a]">{fmtNum(totals.marginAmount)}</span></div>
          <div className="flex justify-between border-b border-[#e0e0e0] px-2 py-1"><span className="text-[#555]">{T("Taxable amount (profit)", "المبلغ الخاضع (الربح)")}</span><span className="tabular-nums">{fmtNum(totals.taxableAmount)}</span></div>
          <div className="flex justify-between border-b border-[#e0e0e0] px-2 py-1"><span className="text-[#555]">{T("SubTotal", "المجموع الفرعي")}</span><span className="tabular-nums">{fmtNum(totals.subTotal)}</span></div>
          <div className="flex justify-between border-b border-[#e0e0e0] px-2 py-1"><span className="text-[#555]">{T("VAT on profit", "الضريبة على الربح")} ({effectiveVat}%)</span><span className="tabular-nums">{fmtNum(totals.taxAmount)}</span></div>
          <div className="flex justify-between border-b border-[#e0e0e0] px-2 py-1"><span className="text-[#555]">{T("Paid", "المدفوع")}</span><span className="tabular-nums">{fmtNum(num(paidAmount))}</span></div>
          <div className="flex justify-between bg-[#fffde7] px-2 py-1.5 text-[15px] font-bold"><span>{T("Total (SAR ر.س)", "الإجمالي (ر.س)")}</span><span className="tabular-nums">{fmtNum(totals.totalAmount)}</span></div>
          <div className="flex justify-between px-2 py-1 font-bold text-[#b71c1c]"><span>{T("Balance due", "المتبقي")}</span><span className="tabular-nums">{fmtNum(balanceDue)}</span></div>
          {mode === "zatca" && (
            <div className="border-t border-[#e0e0e0] bg-[#e8f5e9] px-2 py-1 text-[10px] font-bold text-[#0a5c2a]">
              {T("ZATCA: signed XML + TLV QR generated on save", "هيئة الزكاة: توقيع XML + رمز QR عند الحفظ")}
            </div>
          )}
        </div>
      </div>

      {pickerOpen && (
        <CustomerPicker
          onPick={(c: any) => {
            setCustomerId(c.id);
            setCustomerName(c.name || "");
            setCustomerNameAr(c.nameAr || "");
            setCustomerPhone(c.phone || "");
            setCustomerVat(c.vatNumber || c.taxNumber || "");
            setPickerOpen(false);
          }}
          onClear={() => { setCustomerId(null); setCustomerName(""); setCustomerNameAr(""); setCustomerPhone(""); setCustomerVat(""); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

/* ─── Sahl-styled customer picker (inline overlay, no shadcn coupling) ─── */
function CustomerPicker({ onPick, onClear, onClose }: { onPick: (c: any) => void; onClear: () => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const { data: customers, isLoading } = trpc.sales.customerList.useQuery(q ? { search: q } : undefined);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="mt-10 w-full max-w-lg border border-black bg-white" onClick={(e) => e.stopPropagation()} dir="ltr">
        <div className="flex items-center justify-between px-3 py-1.5 text-white" style={{ background: GREEN }}>
          <b>{/* i18n-free label */}{"Select customer"}</b>
          <button type="button" onClick={onClose}><X className="size-4" /></button>
        </div>
        <div className="flex items-center gap-1 border-b border-[#ddd] p-2">
          <Search className="size-4 text-[#777]" />
          <input autoFocus className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / phone / code" />
        </div>
        <div className="max-h-72 overflow-auto">
          {isLoading && <div className="p-3 text-center text-[#999]">Loading…</div>}
          {(customers || []).map((c: any) => (
            <button key={c.id} type="button" className="flex w-full items-center justify-between border-b border-[#eee] px-3 py-2 text-start hover:bg-[#e8f5e9]" onClick={() => onPick(c)}>
              <span className="font-medium">{c.name}</span>
              <span className="text-[11px] text-[#777]">{c.phone} {c.vatNumber ? `· VAT ${c.vatNumber}` : ""}</span>
            </button>
          ))}
          {!isLoading && !customers?.length && <div className="p-4 text-center text-[#999]">No customers</div>}
        </div>
        <div className="flex justify-end border-t border-[#ddd] p-2">
          <button type="button" className={btnCls} onClick={onClear}>Use walk-in customer</button>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/providers/trpc";
import { useLanguage } from "@/providers/language";
import { Plus, Printer, XCircle, ShieldCheck, FileText, FileSpreadsheet, Loader2 } from "lucide-react";
import { fmtMoney } from "@/lib/travelCalc";
import { printTravelTicket } from "@/lib/travelPrint";
import { exportTravelExcel, exportTravelHistoryExcel } from "@/lib/travelExcel";

const statusColors: Record<string, string> = {
  issued: "bg-emerald-100 text-emerald-700",
  draft: "bg-slate-100 text-slate-700",
  paid: "bg-blue-100 text-blue-700",
  cancelled: "bg-red-100 text-red-700",
  refunded: "bg-purple-100 text-purple-700",
};

export default function TravelTickets() {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const rtl = language === "ar";
  const T = (en: string, ar: string) => (rtl ? ar : en);

  const [mode, setMode] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const { data: tickets, refetch } = trpc.travel.ticketList.useQuery({
    mode: (mode || undefined) as any,
    status: status || undefined,
  });
  const utils = trpc.useUtils();
  const cancelMutation = trpc.travel.ticketCancel.useMutation({ onSuccess: () => { refetch(); utils.travel.travelDashboard.invalidate(); } });

  const rows = (tickets || []).filter((t: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return [t.invoiceNumber, t.customerName, t.passengerName, t.pnr, t.ticketNumber, t.serviceRef]
      .some((v) => String(v || "").toLowerCase().includes(s));
  });

  /** Every output needs the full document payload, so fetch it on demand. */
  async function withDetail(id: number, key: string, fn: (detail: any) => Promise<void> | void) {
    if (busy) return;
    setMsg(null);
    setBusy(key);
    try {
      const detail = await utils.travel.ticketGet.fetch({ id });
      await fn(detail as any);
    } catch (e: any) {
      setMsg(e?.message || String(e));
    } finally {
      setBusy(null);
    }
  }

  const doPrint = (id: number, fmt: "a4" | "thermal") =>
    withDetail(id, `p-${fmt}-${id}`, (d) => printTravelTicket(d, fmt));
  const doExcel = (id: number, fmt: "a4" | "thermal") =>
    withDetail(id, `x-${fmt}-${id}`, (d) => exportTravelExcel(d, fmt));

  async function exportLedger() {
    if (busy) return;
    setMsg(null);
    setBusy("history");
    try {
      await exportTravelHistoryExcel(rows);
    } catch (e: any) {
      setMsg(e?.message || String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5" dir={rtl ? "rtl" : "ltr"}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold">{T("Travel Tickets & Invoices", "تذاكر وفواتير السفر")}</h2>
          <p className="text-slate-500 text-sm">{T("History of issued tickets, tax and non-tax invoices", "سجل التذاكر والفواتير الضريبية وغير الضريبية")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={exportLedger} disabled={busy === "history" || rows.length === 0}>
            {busy === "history" ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 me-2" />}
            {T("Export History Report (Excel)", "تصدير تقرير السجل (Excel)")}
          </Button>
          <Button onClick={() => navigate("/app/verticals/travel/tickets/new")}><Plus className="w-4 h-4 me-2" />{T("New ticket / invoice", "تذكرة / فاتورة جديدة")}</Button>
        </div>
      </div>

      {msg && <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</div>}

      <Card>
        <CardContent className="py-3 flex flex-wrap gap-3 items-end">
          <div className="w-56"><Input placeholder={T("Search number / name / PNR", "بحث بالرقم / الاسم / PNR")} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <div className="w-44">
            <Select value={mode || "all"} onValueChange={(v) => setMode(v === "all" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{T("All modes", "جميع الأنواع")}</SelectItem>
                <SelectItem value="zatca">{T("ZATCA (tax)", "ضريبية")}</SelectItem>
                <SelectItem value="non_tax">{T("Non-tax", "غير ضريبية")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-44">
            <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{T("All status", "جميع الحالات")}</SelectItem>
                <SelectItem value="issued">issued</SelectItem>
                <SelectItem value="paid">paid</SelectItem>
                <SelectItem value="cancelled">cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{T("Number", "الرقم")}</TableHead>
                <TableHead>{T("Date", "التاريخ")}</TableHead>
                <TableHead>{T("Customer", "العميل")}</TableHead>
                <TableHead>{T("Route / PNR", "المسار / PNR")}</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead className="text-end">{T("Base Cost", "التكلفة")}</TableHead>
                <TableHead className="text-end">{T("Sale Price", "سعر البيع")}</TableHead>
                <TableHead className="text-end">{T("Profit", "الربح")}</TableHead>
                <TableHead className="text-end">VAT</TableHead>
                <TableHead className="text-end">{T("Total", "الإجمالي")}</TableHead>
                <TableHead>{T("Status", "الحالة")}</TableHead>
                <TableHead className="text-end">{T("Actions", "إجراءات")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.invoiceNumber}</TableCell>
                  <TableCell>{t.date}</TableCell>
                  <TableCell>{t.customerName || t.passengerName || "—"}</TableCell>
                  <TableCell className="text-xs text-slate-600">{[t.serviceRef, t.origin, t.pnr].filter(Boolean).join(" · ") || "—"}</TableCell>
                  <TableCell>
                    {t.mode === "zatca"
                      ? <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100"><ShieldCheck className="w-3 h-3 me-1" />ZATCA</Badge>
                      : <Badge variant="secondary"><FileText className="w-3 h-3 me-1" />{t.vatPercent}%</Badge>}
                  </TableCell>
                  <TableCell className="text-end tabular-nums text-slate-500">{fmtMoney(t.nonTaxableAmount)}</TableCell>
                  <TableCell className="text-end tabular-nums">{fmtMoney(t.subTotal)}</TableCell>
                  <TableCell className="text-end tabular-nums text-[#0a5c2a] font-semibold">{fmtMoney(t.taxableAmount)}</TableCell>
                  <TableCell className="text-end tabular-nums">{fmtMoney(t.taxAmount)}</TableCell>
                  <TableCell className="text-end font-semibold tabular-nums">{fmtMoney(t.totalAmount)}</TableCell>
                  <TableCell><Badge className={statusColors[t.status] || ""}>{t.status}</Badge></TableCell>
                  <TableCell className="text-end whitespace-nowrap">
                    <Button size="sm" variant="ghost" title={T("Print / PDF (A4)", "طباعة / PDF (A4)")} disabled={!!busy} onClick={() => doPrint(t.id, "a4")}>
                      {busy === `p-a4-${t.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                    </Button>
                    <Button size="sm" variant="ghost" title={T("Print / PDF (Thermal)", "طباعة / PDF (حراري)")} disabled={!!busy} onClick={() => doPrint(t.id, "thermal")}>
                      {busy === `p-thermal-${t.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                    </Button>
                    <Button size="sm" variant="ghost" title={T("Excel (A4)", "إكسل (A4)")} disabled={!!busy} onClick={() => doExcel(t.id, "a4")}>
                      {busy === `x-a4-${t.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 text-emerald-700" />}
                    </Button>
                    <Button size="sm" variant="ghost" title={T("Excel (Thermal)", "إكسل (حراري)")} disabled={!!busy} onClick={() => doExcel(t.id, "thermal")}>
                      {busy === `x-thermal-${t.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 text-amber-700" />}
                    </Button>
                    {t.status !== "cancelled" && (
                      <Button size="sm" variant="ghost" title={T("Cancel", "إلغاء")} onClick={() => cancelMutation.mutate({ id: t.id })}><XCircle className="w-4 h-4 text-red-500" /></Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={12} className="text-center text-slate-400 py-8">{T("No tickets yet.", "لا توجد تذاكر بعد.")}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

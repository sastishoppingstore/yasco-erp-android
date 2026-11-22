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
import { Plus, Printer, XCircle, ShieldCheck, FileText } from "lucide-react";
import { fmtMoney } from "@/lib/travelCalc";
import { printTravelTicket } from "@/lib/travelPrint";

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

  async function doPrint(id: number) {
    const detail = await utils.travel.ticketGet.fetch({ id });
    await printTravelTicket(detail as any);
  }

  return (
    <div className="space-y-5" dir={rtl ? "rtl" : "ltr"}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold">{T("Travel Tickets & Invoices", "تذاكر وفواتير السفر")}</h2>
          <p className="text-slate-500 text-sm">{T("History of issued tickets, tax and non-tax invoices", "سجل التذاكر والفواتير الضريبية وغير الضريبية")}</p>
        </div>
        <Button onClick={() => navigate("/app/verticals/travel/tickets/new")}><Plus className="w-4 h-4 me-2" />{T("New ticket / invoice", "تذكرة / فاتورة جديدة")}</Button>
      </div>

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
                <TableHead className="text-end">{T("Total", "الإجمالي")}</TableHead>
                <TableHead className="text-end">VAT</TableHead>
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
                  <TableCell className="text-end font-semibold">{fmtMoney(t.totalAmount)}</TableCell>
                  <TableCell className="text-end">{fmtMoney(t.taxAmount)}</TableCell>
                  <TableCell><Badge className={statusColors[t.status] || ""}>{t.status}</Badge></TableCell>
                  <TableCell className="text-end whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => doPrint(t.id)}><Printer className="w-4 h-4" /></Button>
                    {t.status !== "cancelled" && (
                      <Button size="sm" variant="ghost" onClick={() => cancelMutation.mutate({ id: t.id })}><XCircle className="w-4 h-4 text-red-500" /></Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-slate-400 py-8">{T("No tickets yet.", "لا توجد تذاكر بعد.")}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

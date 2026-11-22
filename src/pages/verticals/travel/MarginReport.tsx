import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/providers/trpc";
import { useLanguage } from "@/providers/language";
import { fmtMoney } from "@/lib/travelCalc";
import { BarChart3, Wallet, TrendingUp, ShieldCheck } from "lucide-react";

/**
 * ZATCA Margin Report — separates the non-taxable ticket base cost (supplier /
 * airline disbursement) from the taxable agency profit and the output VAT.
 * Margin scheme invoices carry exactly that split in the ticket document.
 */
export default function TravelMarginReport() {
  const { language } = useLanguage();
  const rtl = language === "ar";
  const T = (en: string, ar: string) => (rtl ? ar : en);

  const { data, isLoading } = trpc.travel.ticketList.useQuery({});
  const rows: any[] = data || [];

  const totals = useMemo(() => {
    let base = 0, profit = 0, vat = 0, grand = 0, zatca = 0, nonTax = 0;
    for (const r of rows) {
      base += Number(r.nonTaxableAmount) || 0;
      profit += Number(r.taxableAmount) || 0;
      vat += Number(r.taxAmount) || 0;
      grand += Number(r.totalAmount) || 0;
      if (r.mode === "zatca") zatca++; else nonTax++;
    }
    return { base, profit, vat, grand, zatca, nonTax };
  }, [rows]);

  const cards = [
    { label: T("Non-taxable base cost", "التكلفة الأساسية غير الخاضعة"), value: totals.base, icon: Wallet, color: "text-sky-700" },
    { label: T("Taxable agency profit", "ربح الوكالة الخاضع"), value: totals.profit, icon: TrendingUp, color: "text-emerald-700" },
    { label: T("Output VAT", "ضريبة المخرجات"), value: totals.vat, icon: ShieldCheck, color: "text-amber-700" },
  ];

  return (
    <div className="space-y-6" dir={rtl ? "rtl" : "ltr"}>
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="w-6 h-6 text-emerald-600" />{T("ZATCA Margin Report", "تقرير ضريبة الأرباح")}</h2>
        <p className="text-slate-500 text-sm">
          {T("Non-taxable ticket base cost vs taxable agency profit and output VAT.",
            "التكلفة الأساسية غير الخاضعة مقابل ربح الوكالة الخاضع وضريبة المخرجات.")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">{c.label}</span>
                <c.icon className={`w-5 h-5 ${c.color}`} />
              </div>
              <div className="mt-1 font-mono text-xl font-bold">SAR {fmtMoney(c.value)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <Badge className="bg-emerald-100 text-emerald-700">ZATCA: {totals.zatca}</Badge>
        <Badge className="bg-slate-100 text-slate-700">{T("Non-tax 0%", "غير ضريبية")}: {totals.nonTax}</Badge>
        <Badge className="bg-sky-100 text-sky-700">{T("Grand total", "الإجمالي")}: SAR {fmtMoney(totals.grand)}</Badge>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{T("Per-ticket margin breakdown", "تفصيل الهامش لكل تذكرة")}</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>{T("Ticket", "التذكرة")}</TableHead>
                <TableHead>{T("Mode", "النمط")}</TableHead>
                <TableHead>{T("Customer", "العميل")}</TableHead>
                <TableHead className="text-right">{T("Base cost", "التكلفة")}</TableHead>
                <TableHead className="text-right">{T("Profit", "الربح")}</TableHead>
                <TableHead className="text-right">VAT</TableHead>
                <TableHead className="text-right">{T("Total", "الإجمالي")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={8} className="text-center text-slate-400">Loading…</TableCell></TableRow>}
              {!isLoading && !rows.length && (
                <TableRow><TableCell colSpan={8} className="text-center text-slate-400">{T("No tickets yet", "لا توجد تذاكر بعد")}</TableCell></TableRow>
              )}
              {rows.map((r, i) => (
                <TableRow key={r.id}>
                  <TableCell className="text-slate-400">{i + 1}</TableCell>
                  <TableCell className="font-mono text-sm">{r.invoiceNumber}</TableCell>
                  <TableCell>
                    {r.mode === "zatca"
                      ? <Badge className="bg-emerald-100 text-emerald-700">ZATCA {r.vatPercent}%</Badge>
                      : <Badge className="bg-slate-100 text-slate-700">{T("Non-tax", "غير ضريبية")} {r.vatPercent}%</Badge>}
                  </TableCell>
                  <TableCell className="truncate max-w-[180px]">{r.customerName || r.passengerName || "—"}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(r.nonTaxableAmount)}</TableCell>
                  <TableCell className="text-right font-mono text-emerald-700">{fmtMoney(r.taxableAmount)}</TableCell>
                  <TableCell className="text-right font-mono text-amber-700">{fmtMoney(r.taxAmount)}</TableCell>
                  <TableCell className="text-right font-mono font-bold">{fmtMoney(r.totalAmount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

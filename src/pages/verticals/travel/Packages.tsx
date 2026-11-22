import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { trpc } from "@/providers/trpc";
import { useLanguage } from "@/providers/language";
import { Plus, Package } from "lucide-react";
import { fmtMoney } from "@/lib/travelCalc";

const types = ["umrah", "hajj", "tour", "holiday", "corporate"];
const typeLabel: Record<string, string> = { umrah: "Umrah", hajj: "Hajj", tour: "Tour", holiday: "Holiday", corporate: "Corporate" };

export default function TravelPackages() {
  const { language } = useLanguage();
  const rtl = language === "ar";
  const T = (en: string, ar: string) => (rtl ? ar : en);
  const utils = trpc.useUtils();
  const { data: packages } = trpc.travel.packageList.useQuery();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "", nameAr: "", code: "", packageType: "umrah", durationDays: 0, nightsMakkah: 0, nightsMadinah: 0,
    costPrice: 0, sellingPrice: 0, includes: "", excludes: "",
  });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const create = trpc.travel.packageCreate.useMutation({
    onSuccess: () => { utils.travel.packageList.invalidate(); setOpen(false); setForm({ name: "", nameAr: "", code: "", packageType: "umrah", durationDays: 0, nightsMakkah: 0, nightsMadinah: 0, costPrice: 0, sellingPrice: 0, includes: "", excludes: "" }); },
  });

  return (
    <div className="space-y-5" dir={rtl ? "rtl" : "ltr"}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2"><Package className="w-6 h-6 text-amber-600" />{T("Umrah & Tour Packages", "باقات العمرة والجولات")}</h2>
          <p className="text-slate-500 text-sm">{T("Sell custom Umrah / holiday packages with pricing", "بيع باقات العمرة والعطلات بأسعار مخصصة")}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 me-2" />{T("New package", "باقة جديدة")}</Button></DialogTrigger>
          <DialogContent className="max-w-xl">
            <DialogHeader><DialogTitle>{T("New package", "باقة جديدة")}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label>{T("Package name", "اسم الباقة")}</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
              <div className="col-span-2"><Label>{T("Name (Arabic)", "الاسم (عربي)")}</Label><Input dir="rtl" value={form.nameAr} onChange={(e) => set("nameAr", e.target.value)} /></div>
              <div><Label>{T("Code", "الرمز")}</Label><Input value={form.code} onChange={(e) => set("code", e.target.value)} /></div>
              <div>
                <Label>{T("Type", "النوع")}</Label>
                <Select value={form.packageType} onValueChange={(v) => set("packageType", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{types.map((t) => <SelectItem key={t} value={t}>{typeLabel[t]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>{T("Duration (days)", "المدة (أيام)")}</Label><Input type="number" value={form.durationDays} onChange={(e) => set("durationDays", Number(e.target.value))} /></div>
              <div><Label>{T("Makkah nights", "ليالي مكة")}</Label><Input type="number" value={form.nightsMakkah} onChange={(e) => set("nightsMakkah", Number(e.target.value))} /></div>
              <div><Label>{T("Madinah nights", "ليالي المدينة")}</Label><Input type="number" value={form.nightsMadinah} onChange={(e) => set("nightsMadinah", Number(e.target.value))} /></div>
              <div><Label>{T("Cost price", "سعر التكلفة")}</Label><Input type="number" value={form.costPrice} onChange={(e) => set("costPrice", Number(e.target.value))} /></div>
              <div><Label>{T("Selling price", "سعر البيع")}</Label><Input type="number" value={form.sellingPrice} onChange={(e) => set("sellingPrice", Number(e.target.value))} /></div>
              <div className="col-span-2"><Label>{T("Includes", "يشمل")}</Label><Input value={form.includes} onChange={(e) => set("includes", e.target.value)} /></div>
            </div>
            <Button disabled={!form.name.trim() || create.isPending} onClick={() => create.mutate({
              name: form.name.trim(), nameAr: form.nameAr.trim() || undefined, code: form.code.trim() || undefined,
              packageType: form.packageType as any, durationDays: form.durationDays || undefined,
              nightsMakkah: form.nightsMakkah || undefined, nightsMadinah: form.nightsMadinah || undefined,
              costPrice: form.costPrice || undefined, sellingPrice: form.sellingPrice || undefined,
              includes: form.includes.trim() || undefined,
            })}>{create.isPending ? T("Saving…", "جارٍ الحفظ…") : T("Save package", "حفظ الباقة")}</Button>
          </DialogContent>
        </Dialog>
      </div>

      <Card><CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>{T("Name", "الاسم")}</TableHead>
            <TableHead>{T("Type", "النوع")}</TableHead>
            <TableHead>{T("Days", "الأيام")}</TableHead>
            <TableHead>{T("Makkah/Madinah", "مكة/المدينة")}</TableHead>
            <TableHead className="text-end">{T("Cost", "التكلفة")}</TableHead>
            <TableHead className="text-end">{T("Selling", "البيع")}</TableHead>
            <TableHead className="text-end">{T("Margin", "الهامش")}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(packages || []).map((p: any) => {
              const margin = (Number(p.sellingPrice) || 0) - (Number(p.costPrice) || 0);
              return (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}{p.nameAr ? <span className="text-slate-400" dir="rtl"> · {p.nameAr}</span> : null}</TableCell>
                  <TableCell><Badge variant="secondary">{typeLabel[p.packageType] || p.packageType}</Badge></TableCell>
                  <TableCell>{p.durationDays || "—"}</TableCell>
                  <TableCell>{p.nightsMakkah || 0} / {p.nightsMadinah || 0}</TableCell>
                  <TableCell className="text-end">{fmtMoney(p.costPrice)}</TableCell>
                  <TableCell className="text-end">{fmtMoney(p.sellingPrice)}</TableCell>
                  <TableCell className="text-end font-semibold text-emerald-700">{fmtMoney(margin)}</TableCell>
                </TableRow>
              );
            })}
            {!packages?.length && <TableRow><TableCell colSpan={7} className="text-center text-slate-400 py-8">{T("No packages yet.", "لا توجد باقات بعد.")}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

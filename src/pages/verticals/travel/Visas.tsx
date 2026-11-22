import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/providers/trpc";
import { useLanguage } from "@/providers/language";
import { Plus, Stamp } from "lucide-react";

const statusColors: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700", submitted: "bg-sky-100 text-sky-700",
  processing: "bg-amber-100 text-amber-700", approved: "bg-emerald-100 text-emerald-700",
  issued: "bg-emerald-100 text-emerald-800", rejected: "bg-red-100 text-red-700", cancelled: "bg-red-100 text-red-700",
};

const empty = {
  passengerName: "", passportNo: "", nationality: "", visaType: "umrah", visaCountry: "Saudi Arabia",
  referenceNumber: "", applicationDate: "", issueDate: "", expiryDate: "", costAmount: 0, feeAmount: 0, status: "draft",
};

export default function TravelVisas() {
  const { language } = useLanguage();
  const rtl = language === "ar";
  const T = (en: string, ar: string) => (rtl ? ar : en);
  const utils = trpc.useUtils();
  const { data: visas } = trpc.travel.visaList.useQuery({});
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const create = trpc.travel.visaCreate.useMutation({ onSuccess: () => { utils.travel.visaList.invalidate(); setOpen(false); setForm({ ...empty }); } });
  const update = trpc.travel.visaUpdate.useMutation({ onSuccess: () => utils.travel.visaList.invalidate() });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-5" dir={rtl ? "rtl" : "ltr"}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2"><Stamp className="w-6 h-6 text-sky-600" />{T("Visa Processing", "معالجة التأشيرات")}</h2>
          <p className="text-slate-500 text-sm">{T("Umrah, visit, work and transit visas", "تأشيرات العمرة والزيارة والعمل والعبور")}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 me-2" />{T("New visa", "تأشيرة جديدة")}</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{T("New visa application", "طلب تأشيرة جديد")}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>{T("Passenger name", "اسم المسافر")}</Label><Input value={form.passengerName} onChange={(e) => set("passengerName", e.target.value)} /></div>
              <div><Label>{T("Passport No.", "رقم الجواز")}</Label><Input value={form.passportNo} onChange={(e) => set("passportNo", e.target.value)} /></div>
              <div><Label>{T("Nationality", "الجنسية")}</Label><Input value={form.nationality} onChange={(e) => set("nationality", e.target.value)} /></div>
              <div>
                <Label>{T("Visa type", "نوع التأشيرة")}</Label>
                <Select value={form.visaType} onValueChange={(v) => set("visaType", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["umrah", "visit", "work", "business", "transit", "hajj", "other"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>{T("Country", "الدولة")}</Label><Input value={form.visaCountry} onChange={(e) => set("visaCountry", e.target.value)} /></div>
              <div><Label>{T("Reference No.", "الرقم المرجعي")}</Label><Input value={form.referenceNumber} onChange={(e) => set("referenceNumber", e.target.value)} /></div>
              <div><Label>{T("Application date", "تاريخ الطلب")}</Label><Input type="date" value={form.applicationDate} onChange={(e) => set("applicationDate", e.target.value)} /></div>
              <div><Label>{T("Status", "الحالة")}</Label>
                <Select value={form.status} onValueChange={(v) => set("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["draft", "submitted", "processing", "approved", "issued", "rejected", "cancelled"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>{T("Issue date", "تاريخ الإصدار")}</Label><Input type="date" value={form.issueDate} onChange={(e) => set("issueDate", e.target.value)} /></div>
              <div><Label>{T("Expiry date", "تاريخ الانتهاء")}</Label><Input type="date" value={form.expiryDate} onChange={(e) => set("expiryDate", e.target.value)} /></div>
              <div><Label>{T("Cost", "التكلفة")}</Label><Input type="number" value={form.costAmount} onChange={(e) => set("costAmount", Number(e.target.value))} /></div>
              <div><Label>{T("Fee", "الرسوم")}</Label><Input type="number" value={form.feeAmount} onChange={(e) => set("feeAmount", Number(e.target.value))} /></div>
            </div>
            <Button className="w-full" disabled={!form.passengerName || create.isPending} onClick={() => create.mutate({ ...form, visaType: form.visaType as any, status: form.status as any, issueDate: form.issueDate || undefined, expiryDate: form.expiryDate || undefined, applicationDate: form.applicationDate || undefined })}>
              {create.isPending ? T("Saving…", "جارٍ الحفظ…") : T("Create visa", "إنشاء التأشيرة")}
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{T("Passenger", "المسافر")}</TableHead>
                <TableHead>{T("Type", "النوع")}</TableHead>
                <TableHead>{T("Country", "الدولة")}</TableHead>
                <TableHead>{T("Expiry", "الانتهاء")}</TableHead>
                <TableHead className="text-end">{T("Cost", "التكلفة")}</TableHead>
                <TableHead className="text-end">{T("Fee", "الرسوم")}</TableHead>
                <TableHead>{T("Status", "الحالة")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(visas || []).map((v: any) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">{v.passengerName}<div className="text-xs text-slate-500">{v.passportNo}</div></TableCell>
                  <TableCell><Badge variant="secondary">{v.visaType}</Badge></TableCell>
                  <TableCell>{v.visaCountry || "—"}</TableCell>
                  <TableCell>{v.expiryDate || "—"}</TableCell>
                  <TableCell className="text-end">{Number(v.costAmount || 0).toFixed(2)}</TableCell>
                  <TableCell className="text-end">{Number(v.feeAmount || 0).toFixed(2)}</TableCell>
                  <TableCell>
                    <Select value={v.status} onValueChange={(s) => update.mutate({ id: v.id, status: s as any })}>
                      <SelectTrigger className={`h-7 w-32 ${statusColors[v.status] || ""}`}><SelectValue /></SelectTrigger>
                      <SelectContent>{["draft", "submitted", "processing", "approved", "issued", "rejected", "cancelled"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
              {!(visas || []).length && <TableRow><TableCell colSpan={7} className="text-center text-slate-400 py-8">{T("No visas yet.", "لا توجد تأشيرات بعد.")}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

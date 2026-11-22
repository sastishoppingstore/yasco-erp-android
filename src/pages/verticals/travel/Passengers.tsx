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
import { Plus, Search } from "lucide-react";

export default function TravelPassengers() {
  const { language } = useLanguage();
  const rtl = language === "ar";
  const T = (en: string, ar: string) => (rtl ? ar : en);
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const { data: passengers } = trpc.travel.passengerList.useQuery({ search: search || undefined });

  const [form, setForm] = useState({
    fullName: "", fullNameAr: "", passportNo: "", nationality: "", phone: "", whatsapp: "",
    email: "", dateOfBirth: "", passportExpiry: "", gender: "" as "" | "male" | "female",
  });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const create = trpc.travel.passengerCreate.useMutation({
    onSuccess: () => { utils.travel.passengerList.invalidate(); setOpen(false); setForm({ fullName: "", fullNameAr: "", passportNo: "", nationality: "", phone: "", whatsapp: "", email: "", dateOfBirth: "", passportExpiry: "", gender: "" }); },
  });

  return (
    <div className="space-y-5" dir={rtl ? "rtl" : "ltr"}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold">{T("Passengers Directory", "دليل المسافرين")}</h2>
          <p className="text-slate-500 text-sm">{T("Passport-level passenger records for tickets and visas", "بيانات المسافرين لجوازات السفر والتذاكر والتأشيرات")}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 me-2" />{T("Add passenger", "إضافة مسافر")}</Button></DialogTrigger>
          <DialogContent className="max-w-xl">
            <DialogHeader><DialogTitle>{T("New passenger", "مسافر جديد")}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label>{T("Full name (as on passport)", "الاسم الكامل (كما في الجواز)")}</Label><Input value={form.fullName} onChange={(e) => set("fullName", e.target.value)} placeholder="SAMSAD ALI/MR" /></div>
              <div className="col-span-2"><Label>{T("Name (Arabic)", "الاسم (عربي)")}</Label><Input dir="rtl" value={form.fullNameAr} onChange={(e) => set("fullNameAr", e.target.value)} /></div>
              <div><Label>{T("Passport No.", "رقم الجواز")}</Label><Input value={form.passportNo} onChange={(e) => set("passportNo", e.target.value)} /></div>
              <div><Label>{T("Nationality", "الجنسية")}</Label><Input value={form.nationality} onChange={(e) => set("nationality", e.target.value)} /></div>
              <div><Label>{T("Phone", "الهاتف")}</Label><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
              <div><Label>WhatsApp</Label><Input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div>
              <div><Label>{T("Email", "البريد")}</Label><Input value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
              <div>
                <Label>{T("Gender", "الجنس")}</Label>
                <Select value={form.gender || "none"} onValueChange={(v) => set("gender", v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">—</SelectItem><SelectItem value="male">Male</SelectItem><SelectItem value="female">Female</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>{T("Date of birth", "تاريخ الميلاد")}</Label><Input type="date" value={form.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} /></div>
              <div><Label>{T("Passport expiry", "انتهاء الجواز")}</Label><Input type="date" value={form.passportExpiry} onChange={(e) => set("passportExpiry", e.target.value)} /></div>
            </div>
            <Button onClick={() => create.mutate({
              fullName: form.fullName.trim(),
              fullNameAr: form.fullNameAr.trim() || undefined,
              passportNo: form.passportNo.trim() || undefined,
              nationality: form.nationality.trim() || undefined,
              phone: form.phone.trim() || undefined,
              whatsapp: form.whatsapp.trim() || undefined,
              email: form.email.trim() || undefined,
              gender: form.gender || undefined,
              dateOfBirth: form.dateOfBirth || undefined,
              passportExpiry: form.passportExpiry || undefined,
            })} disabled={!form.fullName.trim() || create.isPending}>
              {create.isPending ? T("Saving…", "جارٍ الحفظ…") : T("Save passenger", "حفظ المسافر")}
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      <Card><CardContent className="py-3">
        <div className="relative w-72">
          <Search className="w-4 h-4 absolute top-3 start-3 text-slate-400" />
          <Input className="ps-9" placeholder={T("Search name / passport / phone", "بحث بالاسم / الجواز / الهاتف")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </CardContent></Card>

      <Card><CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>{T("Name", "الاسم")}</TableHead>
            <TableHead>{T("Passport", "الجواز")}</TableHead>
            <TableHead>{T("Nationality", "الجنسية")}</TableHead>
            <TableHead>{T("Phone", "الهاتف")}</TableHead>
            <TableHead>{T("Expiry", "الانتهاء")}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(passengers || []).map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.fullName}{p.fullNameAr ? <span className="text-slate-400" dir="rtl"> · {p.fullNameAr}</span> : null}</TableCell>
                <TableCell>{p.passportNo || "—"}</TableCell>
                <TableCell>{p.nationality || "—"}</TableCell>
                <TableCell>{p.phone || p.whatsapp || "—"}</TableCell>
                <TableCell>{p.passportExpiry ? <Badge variant="secondary">{p.passportExpiry}</Badge> : "—"}</TableCell>
              </TableRow>
            ))}
            {!passengers?.length && <TableRow><TableCell colSpan={5} className="text-center text-slate-400 py-8">{T("No passengers yet.", "لا يوجد مسافرون بعد.")}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

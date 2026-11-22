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
import { Plus, Hotel } from "lucide-react";
import { fmtMoney } from "@/lib/travelCalc";

const statusColors: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  confirmed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
  completed: "bg-sky-100 text-sky-700",
};

const empty = {
  bookingRef: "", passengerName: "", hotelName: "", hotelCity: "", roomType: "",
  rooms: 1, guests: 1, checkIn: "", checkOut: "", nights: 0,
  costAmount: 0, sellingAmount: 0, status: "confirmed",
};

export default function TravelHotels() {
  const { language } = useLanguage();
  const rtl = language === "ar";
  const T = (en: string, ar: string) => (rtl ? ar : en);
  const utils = trpc.useUtils();
  const { data: hotels } = trpc.travel.hotelList.useQuery({});
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const create = trpc.travel.hotelCreate.useMutation({
    onSuccess: () => { utils.travel.hotelList.invalidate(); setOpen(false); setForm({ ...empty }); },
  });
  const update = trpc.travel.hotelUpdate.useMutation({ onSuccess: () => utils.travel.hotelList.invalidate() });

  const nights = (() => {
    if (form.checkIn && form.checkOut) {
      const a = new Date(form.checkIn).getTime();
      const b = new Date(form.checkOut).getTime();
      if (!Number.isNaN(a) && !Number.isNaN(b)) return Math.max(0, Math.round((b - a) / 86400000));
    }
    return form.nights || 0;
  })();

  const margin = (Number(form.sellingAmount) || 0) - (Number(form.costAmount) || 0);

  return (
    <div className="space-y-5" dir={rtl ? "rtl" : "ltr"}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2"><Hotel className="w-6 h-6 text-sky-600" />{T("Hotel Bookings", "حجوزات الفنادق")}</h2>
          <p className="text-slate-500 text-sm">{T("Makkah / Madinah and city hotel reservations", "حجوزات فنادق مكة والمدينة والمدن")}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 me-2" />{T("New hotel booking", "حجز فندقي جديد")}</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{T("New hotel booking", "حجز فندقي جديد")}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>{T("Passenger / guest", "المسافر / النزيل")}</Label><Input value={form.passengerName} onChange={(e) => set("passengerName", e.target.value)} /></div>
              <div><Label>{T("Booking ref", "المرجع")}</Label><Input value={form.bookingRef} onChange={(e) => set("bookingRef", e.target.value)} /></div>
              <div><Label>{T("Hotel name", "اسم الفندق")}</Label><Input value={form.hotelName} onChange={(e) => set("hotelName", e.target.value)} placeholder="Swissotel Makkah" /></div>
              <div><Label>{T("City", "المدينة")}</Label><Input value={form.hotelCity} onChange={(e) => set("hotelCity", e.target.value)} placeholder="Makkah" /></div>
              <div><Label>{T("Room type", "نوع الغرفة")}</Label><Input value={form.roomType} onChange={(e) => set("roomType", e.target.value)} placeholder="Double / Triple" /></div>
              <div>{/* spacer */}</div>
              <div><Label>{T("Check-in", "تاريخ الوصول")}</Label><Input type="date" value={form.checkIn} onChange={(e) => set("checkIn", e.target.value)} /></div>
              <div><Label>{T("Check-out", "تاريخ المغادرة")}</Label><Input type="date" value={form.checkOut} onChange={(e) => set("checkOut", e.target.value)} /></div>
              <div><Label>{T("Rooms", "الغرف")}</Label><Input type="number" min={1} value={form.rooms} onChange={(e) => set("rooms", Number(e.target.value))} /></div>
              <div><Label>{T("Guests", "النزلاء")}</Label><Input type="number" min={1} value={form.guests} onChange={(e) => set("guests", Number(e.target.value))} /></div>
              <div><Label>{T("Cost amount", "مبلغ التكلفة")}</Label><Input type="number" value={form.costAmount} onChange={(e) => set("costAmount", Number(e.target.value))} /></div>
              <div><Label>{T("Selling amount", "مبلغ البيع")}</Label><Input type="number" value={form.sellingAmount} onChange={(e) => set("sellingAmount", Number(e.target.value))} /></div>
              <div>
                <Label>{T("Status", "الحالة")}</Label>
                <Select value={form.status} onValueChange={(v) => set("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["draft", "confirmed", "completed", "cancelled"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex items-end text-sm text-slate-500">
                {T("Nights", "الليالي")}: <b className="ms-1">{nights}</b>
                <span className="mx-3">·</span>
                {T("Margin", "الهامش")}: <b className="ms-1 text-emerald-700">{fmtMoney(margin)}</b>
              </div>
            </div>
            <Button className="w-full" disabled={!form.passengerName || !form.hotelName || create.isPending}
              onClick={() => create.mutate({
                bookingRef: form.bookingRef.trim() || undefined,
                passengerName: form.passengerName.trim(),
                hotelName: form.hotelName.trim(),
                hotelCity: form.hotelCity.trim() || undefined,
                roomType: form.roomType.trim() || undefined,
                rooms: form.rooms || undefined,
                guests: form.guests || undefined,
                checkIn: form.checkIn || undefined,
                checkOut: form.checkOut || undefined,
                nights: nights || undefined,
                costAmount: form.costAmount || undefined,
                sellingAmount: form.sellingAmount || undefined,
                status: form.status as any,
              })}>
              {create.isPending ? T("Saving...", "جارٍ الحفظ...") : T("Save booking", "حفظ الحجز")}
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{T("Guest", "النزيل")}</TableHead>
                <TableHead>{T("Hotel", "الفندق")}</TableHead>
                <TableHead>{T("City", "المدينة")}</TableHead>
                <TableHead>{T("Check-in / out", "الوصول / المغادرة")}</TableHead>
                <TableHead>{T("Nights", "الليالي")}</TableHead>
                <TableHead className="text-end">{T("Cost", "التكلفة")}</TableHead>
                <TableHead className="text-end">{T("Selling", "البيع")}</TableHead>
                <TableHead>{T("Status", "الحالة")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(hotels || []).map((h: any) => (
                <TableRow key={h.id}>
                  <TableCell className="font-medium">{h.passengerName}{h.bookingRef ? <div className="text-xs text-slate-500">{h.bookingRef}</div> : null}</TableCell>
                  <TableCell>{h.hotelName}{h.roomType ? <div className="text-xs text-slate-500">{h.roomType}</div> : null}</TableCell>
                  <TableCell>{h.hotelCity || "—"}</TableCell>
                  <TableCell className="text-xs">{h.checkIn || "—"} → {h.checkOut || "—"}</TableCell>
                  <TableCell>{h.nights || "—"}</TableCell>
                  <TableCell className="text-end">{fmtMoney(h.costAmount)}</TableCell>
                  <TableCell className="text-end font-medium">{fmtMoney(h.sellingAmount)}</TableCell>
                  <TableCell>
                    <Select value={h.status} onValueChange={(s) => update.mutate({ id: h.id, status: s as any })}>
                      <SelectTrigger className={`h-7 w-32 ${statusColors[h.status] || ""}`}><SelectValue /></SelectTrigger>
                      <SelectContent>{["draft", "confirmed", "completed", "cancelled"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
              {!(hotels || []).length && (
                <TableRow><TableCell colSpan={8} className="text-center text-slate-400 py-8">{T("No hotel bookings yet.", "لا توجد حجوزات فنادق بعد.")}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/providers/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Building } from "lucide-react";

const emptyForm = { name: "", supplierType: "airline", contactPerson: "", email: "", phone: "", commissionPercent: 0 };

export default function SuppliersPage() {
  const utils = trpc.useUtils();
  const { data: suppliers } = trpc.travel.supplierList.useQuery(undefined);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const set = (k: keyof typeof form, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const create = trpc.travel.supplierCreate.useMutation({
    onSuccess: () => { utils.travel.supplierList.invalidate(); setOpen(false); setForm({ ...emptyForm }); },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-2xl font-bold">Travel Suppliers</h2><p className="text-slate-500">Manage airlines, hotels, and tour operators</p></div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Add Supplier</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Supplier</DialogTitle></DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!form.name.trim()) return;
                create.mutate({
                  name: form.name.trim(),
                  supplierType: form.supplierType as any,
                  contactPerson: form.contactPerson || undefined,
                  email: form.email || undefined,
                  phone: form.phone || undefined,
                  commissionPercent: Number(form.commissionPercent) || 0,
                });
              }}
              className="space-y-3"
            >
              <div><Label>Company Name</Label><Input required value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
              <div><Label>Type</Label><Select value={form.supplierType} onValueChange={(v) => set("supplierType", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="airline">Airline</SelectItem><SelectItem value="hotel">Hotel</SelectItem><SelectItem value="car_rental">Car Rental</SelectItem><SelectItem value="tour_operator">Tour Operator</SelectItem><SelectItem value="visa">Visa Service</SelectItem><SelectItem value="insurance">Insurance</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div>
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Contact Person</Label><Input value={form.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} /></div>
                <div><Label>Commission %</Label><Input type="number" value={form.commissionPercent} onChange={(e) => set("commissionPercent", Number(e.target.value))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
                <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
              </div>
              {create.isError && <p className="text-sm text-red-600">{String(create.error?.message || "Failed")}</p>}
              <Button type="submit" className="w-full" disabled={create.isPending}>{create.isPending ? "Saving…" : "Add Supplier"}</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle>Supplier Directory</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Contact</TableHead><TableHead>Email</TableHead><TableHead>Phone</TableHead><TableHead className="text-right">Commission</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {suppliers?.map(s => (
                <TableRow key={s.id}>
                  <TableCell><div className="flex items-center gap-2"><Building className="w-4 h-4 text-slate-400" /><span className="font-medium">{s.name}</span></div></TableCell>
                  <TableCell className="capitalize">{s.supplierType.replace("_", " ")}</TableCell>
                  <TableCell className="text-sm">{s.contactPerson || "—"}</TableCell>
                  <TableCell>{s.email || "—"}</TableCell>
                  <TableCell>{s.phone || "—"}</TableCell>
                  <TableCell className="text-right">{s.commissionPercent}%</TableCell>
                  <TableCell><Badge variant={s.isActive ? "default" : "secondary"}>{s.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

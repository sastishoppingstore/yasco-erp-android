import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/providers/trpc";
import { useLanguage } from "@/providers/language";
import { Save, Building2, Stamp } from "lucide-react";

export default function TravelSettings() {
  const { language } = useLanguage();
  const rtl = language === "ar";
  const T = (en: string, ar: string) => (rtl ? ar : en);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.travel.settingsGet.useQuery();
  const [msg, setMsg] = useState("");

  const [form, setForm] = useState({
    companyName: "", companyNameAr: "", phone: "", taxNumber: "", logo: "",
    tourismLicenseNo: "", tourismLicenseTypeAr: "وكيل سفر وسياحه", tourismLicenseTypeEn: "",
    tagline: "", taglineAr: "", defaultCurrency: "SAR", defaultVatPercent: 15, invoicePrefix: "TICK-",
    notes: "",
  });

  useEffect(() => {
    const c = data?.company;
    const s = data?.settings;
    if (!c && !s) return;
    setForm((f) => ({
      ...f,
      companyName: c?.companyName ?? f.companyName,
      companyNameAr: c?.companyNameAr ?? f.companyNameAr,
      phone: c?.phone ?? f.phone,
      taxNumber: c?.taxNumber ?? f.taxNumber,
      logo: c?.logo ?? f.logo,
      tourismLicenseNo: s?.tourismLicenseNo ?? f.tourismLicenseNo,
      tourismLicenseTypeAr: s?.tourismLicenseTypeAr ?? f.tourismLicenseTypeAr,
      tourismLicenseTypeEn: s?.tourismLicenseTypeEn ?? f.tourismLicenseTypeEn,
      tagline: s?.tagline ?? f.tagline,
      taglineAr: s?.taglineAr ?? f.taglineAr,
      defaultCurrency: s?.defaultCurrency ?? f.defaultCurrency,
      defaultVatPercent: s?.defaultVatPercent != null ? Number(s.defaultVatPercent) : f.defaultVatPercent,
      invoicePrefix: s?.invoicePrefix ?? f.invoicePrefix,
      notes: s?.notes ?? f.notes,
    }));
  }, [data]);

  const update = trpc.travel.settingsUpdate.useMutation({
    onSuccess: () => { utils.travel.settingsGet.invalidate(); setMsg(T("Saved ✓", "تم الحفظ ✓")); },
    onError: (e) => setMsg(e.message),
  });

  const set = (k: keyof typeof form, v: any) => setForm((f) => ({ ...f, [k]: v }));

  if (isLoading) return <div className="text-slate-500">Loading…</div>;

  return (
    <div className="space-y-5 max-w-4xl" dir={rtl ? "rtl" : "ltr"}>
      <div>
        <h2 className="text-2xl font-bold">{T("Travel Settings", "إعدادات السفر")}</h2>
        <p className="text-slate-500 text-sm">{T("Company identity, Ministry of Tourism licence and ticket defaults", "هوية الشركة، ترخيص وزارة السياحة والإعدادات الافتراضية")}</p>
      </div>

      {msg && <div className="rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 px-4 py-2 text-sm">{msg}</div>}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Building2 className="w-5 h-5" />{T("Company profile (printed on invoices)", "بيانات الشركة (تظهر على الفاتورة)")}</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>{T("Company name (English)", "اسم الشركة (إنجليزي)")}</Label><Input value={form.companyName} onChange={(e) => set("companyName", e.target.value)} /></div>
          <div><Label>{T("Company name (Arabic)", "اسم الشركة (عربي)")}</Label><Input dir="rtl" value={form.companyNameAr} onChange={(e) => set("companyNameAr", e.target.value)} /></div>
          <div><Label>{T("Phone", "الهاتف")}</Label><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+966 14 321 2300" /></div>
          <div><Label>{T("VAT registration number (15 digits)", "الرقم الضريبي (١٥ رقم)")}</Label><Input value={form.taxNumber} onChange={(e) => set("taxNumber", e.target.value)} maxLength={15} placeholder="300423527800003" /></div>
          <div className="md:col-span-2"><Label>{T("Logo URL", "رابط الشعار")}</Label><Input value={form.logo} onChange={(e) => set("logo", e.target.value)} placeholder="https://…/logo.png" /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Stamp className="w-5 h-5" />{T("Ministry of Tourism licence", "ترخيص وزارة السياحة")}</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>{T("Licence number", "رقم الترخيص")}</Label><Input value={form.tourismLicenseNo} onChange={(e) => set("tourismLicenseNo", e.target.value)} placeholder="73103883" /></div>
          <div><Label>{T("Licence type (Arabic)", "نوع الترخيص (عربي)")}</Label><Input dir="rtl" value={form.tourismLicenseTypeAr} onChange={(e) => set("tourismLicenseTypeAr", e.target.value)} /></div>
          <div><Label>{T("Licence type (English)", "نوع الترخيص (إنجليزي)")}</Label><Input value={form.tourismLicenseTypeEn} onChange={(e) => set("tourismLicenseTypeEn", e.target.value)} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{T("Ticket defaults", "افتراضيات التذكرة")}</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><Label>{T("Invoice prefix", "بادئة رقم الفاتورة")}</Label><Input value={form.invoicePrefix} onChange={(e) => set("invoicePrefix", e.target.value)} /></div>
          <div><Label>{T("Default currency", "العملة الافتراضية")}</Label><Input value={form.defaultCurrency} onChange={(e) => set("defaultCurrency", e.target.value)} /></div>
          <div><Label>{T("Default VAT % (non-tax)", "نسبة الضريبة الافتراضية (غير ضريبية)")}</Label><Input type="number" value={form.defaultVatPercent} onChange={(e) => set("defaultVatPercent", Number(e.target.value))} /></div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button onClick={() => update.mutate({ ...form, defaultVatPercent: Number(form.defaultVatPercent) })} disabled={update.isPending}>
          <Save className="w-4 h-4 me-2" />{update.isPending ? T("Saving…", "جارٍ الحفظ…") : T("Save settings", "حفظ الإعدادات")}
        </Button>
      </div>
    </div>
  );
}

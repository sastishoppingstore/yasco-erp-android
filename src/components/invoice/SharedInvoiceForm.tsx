import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useLanguage } from "@/providers/language";
import { trpc } from "@/providers/trpc";

/**
 * SharedInvoiceForm — the single create-invoice screen used by every module
 * except Sahl Construction.
 *
 * Visual contract: mirrors the Sahl Construction transaction screen (green
 * grid header, compact bordered fields, yellow total box, dark action dock,
 * right-hand function-key panel) WITHOUT touching any Sahl file. Sahl's own
 * page keeps using its own component.
 *
 * Module-specific behaviour is configuration only (`moduleKey`, optional
 * service/construction presets); the design never forks.
 */

export type SharedInvoiceLine = {
  key: string;
  productId?: number;
  code: string;
  name: string;
  nameAr: string;
  unit: string;
  qty: number;
  price: number;
  discount: number;
  taxPercent: number;
  taxCategory: "S" | "E" | "Z" | "O";
  exemptionReason?: string;
  exemptionReasonCode?: string;
};

export interface SharedInvoiceFormProps {
  /** When set, the form loads this invoice and updates it instead of creating. */
  editId?: number | null;
  moduleKey?: string;
  defaultTaxPercent?: number;
  allowItemCode?: boolean;
  onSaved?: (id: number) => void;
  onPrint?: (id: number) => void;
  onCancelEdit?: () => void;
  compact?: boolean;
}

const inputCls =
  "w-full border border-[#777] bg-white px-1.5 py-1 text-[12px] text-black outline-none focus:border-black disabled:bg-[#f0f0f0]";
const btnCls =
  "border border-[#555] bg-[#f5f5f5] px-2 py-1 text-[11px] text-black hover:bg-white active:bg-[#ddd] disabled:opacity-50";
const btnGreenCls =
  "border border-[#0a5c2a] bg-[#2fae4e] px-2 py-1 text-[11px] font-bold text-white hover:brightness-110 disabled:opacity-50";

const newLine = (): SharedInvoiceLine => ({
  key: `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  code: "",
  name: "",
  nameAr: "",
  unit: "PCE",
  qty: 1,
  price: 0,
  discount: 0,
  taxPercent: 15,
  taxCategory: "S",
});

const n = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const money = (value: number) => (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
const today = () => new Date().toISOString().slice(0, 10);
const nowTime = () => new Date().toTimeString().slice(0, 5);

export default function SharedInvoiceForm({
  editId = null,
  moduleKey = "sales",
  defaultTaxPercent = 15,
  allowItemCode = true,
  onSaved,
  onPrint,
  onCancelEdit,
  compact = false,
}: SharedInvoiceFormProps) {
  const { language } = useLanguage();
  const T = (ar: string, en: string) => (language === "ar" ? ar : en);
  const queryClient = useQueryClient();

  const { data: settings } = trpc.settings.companySettingsGet.useQuery(undefined);
  const { data: products } = trpc.inventory.productList.useQuery(undefined);
  const { data: customers } = trpc.sales.customerList.useQuery(undefined);
  const editQuery = trpc.sales.invoiceGet.useQuery(
    { id: editId ?? 0 },
    { enabled: !!editId },
  );

  const createInvoice = trpc.sales.invoiceCreate.useMutation();
  const updateInvoice = trpc.sales.invoiceUpdate.useMutation();

  const currency = (settings as any)?.defaultCurrency || "SAR";

  // ---- header state -------------------------------------------------------
  const [docNo, setDocNo] = useState("");
  const [date, setDate] = useState(today());
  const [supplyDate, setSupplyDate] = useState(today());
  const [dueDate, setDueDate] = useState("");
  const [paymentMeans, setPaymentMeans] = useState("Credit");
  const [invoiceType, setInvoiceType] = useState<"simplified" | "standard">("simplified");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [noteAr, setNoteAr] = useState("");
  const [cashier, setCashier] = useState("مدير النظام");
  const [headerDiscount, setHeaderDiscount] = useState(0);
  const [taxPercent, setTaxPercent] = useState(defaultTaxPercent);

  // ---- buyer state --------------------------------------------------------
  const [customerId, setCustomerId] = useState(0);
  const [customerName, setCustomerName] = useState("");
  const [customerNameAr, setCustomerNameAr] = useState("");
  const [customerVat, setCustomerVat] = useState("");
  const [customerCr, setCustomerCr] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [buildingNumber, setBuildingNumber] = useState("");
  const [streetName, setStreetName] = useState("");
  const [district, setDistrict] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [additionalNumber, setAdditionalNumber] = useState("");

  // ---- lines --------------------------------------------------------------
  const [lines, setLines] = useState<SharedInvoiceLine[]>([]);
  const [selected, setSelected] = useState(0);
  const [query, setQuery] = useState("");
  const [gridOpen, setGridOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const isEditing = !!editId;

  // ---- load invoice for edit ---------------------------------------------
  useEffect(() => {
    if (!editId) return;
    const detail = editQuery.data;
    if (!detail || !detail.invoice || detail.invoice.id !== editId || loadedId === editId) return;
    const inv: any = detail.invoice;
    const cust: any = detail.customer;
    setLoadedId(editId);
    setDocNo(inv.invoiceNumber || "");
    setDate(inv.date || today());
    setSupplyDate(inv.supplyDate || inv.date || today());
    setDueDate(inv.dueDate || "");
    setPaymentMeans(inv.paymentMethod || inv.paymentType || "Credit");
    setInvoiceType(inv.invoiceType === "simplified" ? "simplified" : "standard");
    setReference(inv.poNumber || "");
    setNote(inv.notes || "");
    setNoteAr(inv.notesAr || "");
    setCashier(inv.cashier || "مدير النظام");
    setHeaderDiscount(n(inv.discountAmount));
    setTaxPercent(n(inv.taxPercent, defaultTaxPercent));
    setCustomerId(inv.customerId || 0);
    setCustomerName(inv.customerName || cust?.name || "");
    setCustomerNameAr(inv.customerNameAr || cust?.nameAr || "");
    setCustomerVat(inv.customerVat || cust?.vatNumber || cust?.taxNumber || "");
    setCustomerCr(inv.customerCr || cust?.crNumber || cust?.commercialRegistration || "");
    setCustomerPhone(inv.customerPhone || cust?.phone || "");
    setCustomerEmail(inv.customerEmail || cust?.email || "");
    setBuildingNumber(cust?.buildingNumber || "");
    setStreetName(cust?.streetName || "");
    setDistrict(cust?.district || "");
    setCity(cust?.city || "");
    setPostalCode(cust?.postalCode || "");
    setAdditionalNumber(cust?.additionalNumber || "");
    setLines(
      (detail.items || []).map((it: any, i: number) => ({
        key: `edit-${it.id ?? i}`,
        productId: it.productId ?? undefined,
        code: it.sku || "",
        name: it.description || "Item",
        nameAr: it.descriptionAr || "",
        unit: it.unit || "PCE",
        qty: n(it.quantity, 1),
        price: n(it.unitPrice),
        discount: 0,
        taxPercent: n(it.taxPercent, defaultTaxPercent),
        taxCategory: (it.taxCategory as SharedInvoiceLine["taxCategory"]) || "S",
        exemptionReason: it.exemptionReason || "",
        exemptionReasonCode: it.exemptionReasonCode || "",
      })),
    );
  }, [editId, editQuery.data, loadedId, defaultTaxPercent]);

  useEffect(() => {
    if (!isEditing) setDocNo((current) => current || `INV-${Date.now().toString().slice(-8)}`);
  }, [isEditing]);

  // ---- derived totals (identical maths to the backend pipeline) -----------
  const totals = useMemo(() => {
    let sub = 0;
    let vat = 0;
    const buckets = new Map<string, number>();
    for (const line of lines) {
      const gross = Math.round(line.qty * line.price * 100) / 100;
      const disc = Math.min(gross, Math.max(0, Math.round(line.discount * 100) / 100));
      const net = Math.round((gross - disc) * 100) / 100;
      const rate = line.taxCategory === "S" ? line.taxPercent : 0;
      sub += net;
      vat += Math.round(((net * rate) / 100) * 100) / 100;
      const key = `${line.taxCategory}:${rate}`;
      buckets.set(key, Math.round((buckets.get(key) || 0) + net) * 100 / 100);
    }
    sub = Math.round(sub * 100) / 100;
    const taxable = Math.max(0, Math.round((sub - headerDiscount) * 100) / 100);
    const ratio = sub > 0 ? taxable / sub : 1;
    const perCategory = Array.from(buckets.entries()).map(([key, amount]) => {
      const [category, rateText] = key.split(":");
      const rate = n(rateText);
      const lineTaxable = Math.round(amount * ratio * 100) / 100;
      return { category, rate, taxable: lineTaxable, tax: Math.round(((lineTaxable * rate) / 100) * 100) / 100 };
    });
    vat = Math.round(perCategory.reduce((sum, b) => sum + b.tax, 0) * 100) / 100;
    const total = Math.round((taxable + vat) * 100) / 100;
    return { sub, taxable, vat, total, perCategory };
  }, [lines, headerDiscount]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (products as any[] | undefined) || [];
    if (!q) return list.slice(0, 40);
    return list
      .filter((p) =>
        [p.name, p.nameAr, p.sku, p.barcode]
          .filter(Boolean)
          .some((value: string) => String(value).toLowerCase().includes(q)),
      )
      .slice(0, 40);
  }, [products, query]);

  const customerMatches = useMemo(() => {
    const q = customerName.trim().toLowerCase();
    if (!q) return [];
    return ((customers as any[] | undefined) || [])
      .filter((c) =>
        [c.name, c.nameAr, c.phone, c.vatNumber, c.taxNumber]
          .filter(Boolean)
          .some((value: string) => String(value).toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [customers, customerName]);

  // ---- line operations ----------------------------------------------------
  const patchLine = (index: number, patch: Partial<SharedInvoiceLine>) =>
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const addLine = () => {
    setLines((prev) => [...prev, { ...newLine(), taxPercent, taxCategory: taxPercent === 0 ? "Z" : "S" }]);
    setSelected(lines.length);
  };

  const addProduct = (product: any) => {
    const price = n(product.salePrice ?? product.price);
    const line: SharedInvoiceLine = {
      ...newLine(),
      productId: product.id,
      code: product.sku || product.barcode || "",
      name: product.name || "Item",
      nameAr: product.nameAr || "",
      unit: product.unitName || product.unit || "PCE",
      price,
      taxPercent,
      taxCategory: taxPercent === 0 ? "Z" : "S",
    };
    setLines((prev) => {
      const existing = prev.findIndex((l) => l.productId === product.id && l.price === price);
      if (existing >= 0) {
        return prev.map((l, i) => (i === existing ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...prev, line];
    });
    setQuery("");
    setGridOpen(false);
  };

  const removeLine = (index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index));
    setSelected((current) => Math.max(0, current - (index <= current ? 1 : 0)));
  };

  const moveLine = (index: number, delta: number) => {
    setLines((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const selectCustomer = (customer: any) => {
    setCustomerId(customer.id);
    setCustomerName(customer.name || "");
    setCustomerNameAr(customer.nameAr || "");
    setCustomerVat(customer.vatNumber || customer.taxNumber || "");
    setCustomerCr(customer.crNumber || customer.commercialRegistration || "");
    setCustomerPhone(customer.phone || "");
    setCustomerEmail(customer.email || "");
    setBuildingNumber(customer.buildingNumber || "");
    setStreetName(customer.streetName || studentStreet(customer));
    setDistrict(customer.district || "");
    setCity(customer.city || "");
    setPostalCode(customer.postalCode || "");
    setAdditionalNumber(customer.additionalNumber || "");
    // National-address presence decides whether B2B standard is allowed.
    if (customer.vatNumber || customer.taxNumber) setInvoiceType("standard");
  };

  const resetForm = () => {
    setDocNo(`INV-${Date.now().toString().slice(-8)}`);
    setDate(today());
    setSupplyDate(today());
    setDueDate("");
    setPaymentMeans("Credit");
    setInvoiceType("simplified");
    setReference("");
    setNote("");
    setNoteAr("");
    setHeaderDiscount(0);
    setCustomerId(0);
    setCustomerName("");
    setCustomerNameAr("");
    setCustomerVat("");
    setCustomerCr("");
    setCustomerPhone("");
    setCustomerEmail("");
    setBuildingNumber("");
    setStreetName("");
    setDistrict("");
    setCity("");
    setPostalCode("");
    setAdditionalNumber("");
    setLines([]);
    setSelected(0);
  };

  // ---- submit -------------------------------------------------------------
  const handleSubmit = async (event?: FormEvent, thenPrint = false) => {
    event?.preventDefault();
    if (!lines.length || lines.every((l) => !l.name.trim())) {
      toast.error(T("کم از کم ایک آئٹم شامل کریں", "Add at least one item"));
      return;
    }
    if (invoiceType === "standard" && !customerVat.trim()) {
      toast.error(
        T(
          "اسٹینڈرڈ (B2B) فاتورے کے لیے خریدار کا VAT نمبر لازمی ہے",
          "Standard (B2B) invoices require the buyer's VAT number",
        ),
      );
      return;
    }
    const composedAddress = [buildingNumber, streetName, district, city, postalCode, additionalNumber]
      .filter(Boolean)
      .join(", ");

    const items = lines.map((line) => {
      const gross = Math.round(line.qty * line.price * 100) / 100;
      const disc = Math.min(gross, Math.max(0, Math.round(line.discount * 100) / 100));
      const net = Math.round((gross - disc) * 100) / 100;
      const discountPercent = gross > 0 ? (disc / gross) * 100 : 0;
      return {
        productId: line.productId,
        description: line.name || "Item",
        descriptionAr: line.nameAr || undefined,
        quantity: line.qty,
        unitPrice: String(line.price),
        unit: line.unit,
        sku: line.code || undefined,
        taxPercent: String(line.taxCategory === "S" ? line.taxPercent : 0),
        taxCategory: line.taxCategory,
        exemptionReason: line.exemptionReason || undefined,
        exemptionReasonCode: line.exemptionReasonCode || undefined,
        discountPercent: discountPercent.toFixed(2),
        totalAmount: net.toFixed(2),
      };
    });

    const payload = {
      invoiceNumber: docNo || `INV-${Date.now().toString().slice(-8)}`,
      invoiceType: (invoiceType === "simplified" ? "simplified" : "zatca") as "simplified" | "zatca",
      invoiceMode: moduleKey,
      customerId: customerId || undefined,
      customerName: customerName.trim() || undefined,
      customerNameAr: customerNameAr.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
      customerAddress: composedAddress || undefined,
      customerAddressAr: composedAddress || undefined,
      customerVat: customerVat.trim() || undefined,
      customerCr: customerCr.trim() || undefined,
      customerEmail: customerEmail.trim() || undefined,
      date,
      supplyDate: supplyDate || date,
      time: nowTime(),
      dueDate: dueDate || undefined,
      paymentType: paymentMeans,
      cashier,
      poNumber: reference || undefined,
      subTotal: money(totals.taxable),
      taxableAmount: money(totals.taxable),
      discountAmount: String(headerDiscount || 0),
      taxAmount: money(totals.vat),
      taxPercent: String(taxPercent),
      totalAmount: money(totals.total),
      notes: note || undefined,
      notesAr: noteAr || undefined,
      items,
    };

    setSaving(true);
    try {
      const result = isEditing && editId
        ? await updateInvoice.mutateAsync({ id: editId, ...payload } as any)
        : await createInvoice.mutateAsync(payload as any);
      const id = (result as any)?.id;
      queryClient.invalidateQueries();
      toast.success(isEditing ? T("فاتورہ اپ ڈیٹ ہو گیا", "Invoice updated") : T("فاتورہ محفوظ ہو گیا", "Invoice saved"));
      if (!isEditing) resetForm();
      if (id != null) {
        onSaved?.(id);
        if (thenPrint) onPrint?.(id);
      }
    } catch (error: any) {
      toast.error(error?.message || T("محفوظ نہیں ہو سکا", "Could not save invoice"));
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "F9") {
      event.preventDefault();
      void handleSubmit();
    } else if (event.key === "F10") {
      event.preventDefault();
      resetForm();
    } else if (event.key === "F11") {
      event.preventDefault();
      void handleSubmit(undefined, true);
    }
  };

  // ---- render -------------------------------------------------------------
  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      onKeyDown={handleKeyDown}
      className="flex h-full min-h-0 w-full flex-col overflow-hidden border-t-2 border-[#2fae4e] bg-[#f7f7f7] text-[12px] text-black"
      dir={language === "ar" ? "rtl" : "ltr"}
    >
      {/* ===== Zone 1: document header ===== */}
      <div className="flex flex-wrap items-stretch gap-1 border-b border-[#888] bg-white px-1.5 py-1">
        <div className="flex min-w-[250px] flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-end gap-1">
            <label className="flex items-center gap-1">
              <b className="text-[11px]">{T("رقم المستند", "Doc no")}</b>
              <input className={`${inputCls} h-8 w-[130px] font-bold`} value={docNo} onChange={(e) => setDocNo(e.target.value)} />
            </label>
            <label className="flex items-center gap-1">
              <b className="text-[11px]">{T("التاريخ", "Date")}</b>
              <input type="date" className={`${inputCls} h-8 w-[135px]`} value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="flex items-center gap-1">
              <b className="text-[11px]">{T("تاريخ التوريد", "Supply date")}</b>
              <input type="date" className={`${inputCls} h-8 w-[135px]`} value={supplyDate} onChange={(e) => setSupplyDate(e.target.value)} />
            </label>
            <label className="flex items-center gap-1">
              <b className="text-[11px]">{T("الاستحقاق", "Due")}</b>
              <input type="date" className={`${inputCls} h-8 w-[135px]`} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <label className="flex items-center gap-1">
              <b className="text-[11px]">{T("نوع الفاتورة", "Invoice type")}</b>
              <select
                className={`${inputCls} h-8 w-[155px]`}
                value={invoiceType}
                onChange={(e) => setInvoiceType(e.target.value as "simplified" | "standard")}
              >
                <option value="simplified">{T("مبسطة B2C", "Simplified B2C")}</option>
                <option value="standard">{T("ضريبية B2B", "Standard B2B")}</option>
              </select>
            </label>
            <label className="flex items-center gap-1">
              <b className="text-[11px]">{T("طريقة الدفع", "Payment means")}</b>
              <select className={`${inputCls} h-8 w-[120px]`} value={paymentMeans} onChange={(e) => setPaymentMeans(e.target.value)}>
                <option value="Cash">{T("نقدي", "Cash")}</option>
                <option value="Credit">{T("آجل", "Credit")}</option>
                <option value="Card">{T("شبكة", "Card")}</option>
                <option value="Transfer">{T("تحويل", "Transfer")}</option>
              </select>
            </label>
            <label className="flex items-center gap-1">
              <b className="text-[11px]">{T("المرجع", "Reference")}</b>
              <input className={`${inputCls} h-8 w-[110px]`} value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
          </div>
        </div>

        {/* yellow total box, like Sahl's doc-total panel */}
        <div className="flex min-w-[190px] flex-col items-stretch justify-between border border-[#c8a419] bg-[#fff8e1] px-2 py-1">
          <div className="flex items-center justify-between text-[11px]">
            <span>{T("الإجمالي قبل الضريبة", "Taxable")}</span>
            <b className="tabular-nums">{currency} {money(totals.taxable)}</b>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span>{T("الضريبة", "VAT")} ({taxPercent}%)</span>
            <b className="tabular-nums">{currency} {money(totals.vat)}</b>
          </div>
          <div className="mt-0.5 flex items-center justify-between border-t border-[#c8a419] pt-0.5 text-[15px] font-black text-[#7a6100]">
            <span>{T("الصافي", "NET")}</span>
            <span className="tabular-nums">{currency} {money(totals.total)}</span>
          </div>
        </div>

        {/* brand block */}
        <div className="hidden min-w-[132px] flex-col items-center justify-center rounded-b-[26px] rounded-t-sm border border-[#0d5f2c] px-2 py-1 text-white md:flex" style={{ background: "#2fae4e" }}>
          <div className="text-[11px] font-black tracking-wide">YASCO ERP</div>
          <div className="mt-0.5 text-center text-[10px] leading-tight opacity-90">
            {(settings as any)?.companyNameAr || (settings as any)?.companyName || T("فاتورة", "Invoice")}
          </div>
          <div className="mt-1 border border-white/40 px-1 text-[9px]">
            {currency} · {invoiceType === "standard" ? "B2B" : "B2C"}
          </div>
        </div>
      </div>

      {/* ===== Zone 2: buyer + ZATCA fields ===== */}
      <div className="grid gap-x-2 gap-y-1 border-b border-[#bbb] bg-[#fafafa] px-1.5 py-1 md:grid-cols-4">
        <label className="relative flex items-center gap-1 md:col-span-2">
          <b className="w-[62px] shrink-0 text-[11px]">{T("العميل", "Customer")}</b>
          <input
            className={`${inputCls} h-8`}
            value={customerName}
            list="shared-invoice-customers"
            placeholder={T("اكتب اسم العميل أو VAT", "Type customer name or VAT")}
            onChange={(e) => {
              setCustomerName(e.target.value);
              setCustomerId(0);
            }}
            onBlur={() => {
              if (customerMatches.length === 1) selectCustomer(customerMatches[0]);
            }}
          />
          <datalist id="shared-invoice-customers">
            {customerMatches.map((c: any) => (
              <option key={c.id} value={c.name}>
                {c.nameAr || c.phone || c.vatNumber || ""}
              </option>
            ))}
          </datalist>
        </label>
        <label className="flex items-center gap-1">
          <b className="w-[56px] shrink-0 text-[11px]">{T("عربي", "Arabic")}</b>
          <input className={`${inputCls} h-8`} dir="rtl" value={customerNameAr} onChange={(e) => setCustomerNameAr(e.target.value)} />
        </label>
        <label className="flex items-center gap-1">
          <b className="w-[40px] shrink-0 text-[11px]">VAT</b>
          <input className={`${inputCls} h-8 tabular-nums`} value={customerVat} maxLength={15} onChange={(e) => setCustomerVat(e.target.value.replace(/\D/g, "").slice(0, 15))} placeholder="3xxxxxxxxxxxxx3" />
        </label>
        <label className="flex items-center gap-1">
          <b className="w-[40px] shrink-0 text-[11px]">CR</b>
          <input className={`${inputCls} h-8`} value={customerCr} onChange={(e) => setCustomerCr(e.target.value)} />
        </label>
        <label className="flex items-center gap-1">
          <b className="w-[56px] shrink-0 text-[11px]">{T("هاتف", "Phone")}</b>
          <input className={`${inputCls} h-8`} value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
        </label>
        <label className="flex items-center gap-1">
          <b className="w-[56px] shrink-0 text-[11px]">{T("بريد", "Email")}</b>
          <input className={`${inputCls} h-8`} value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
        </label>
        <label className="flex items-center gap-1">
          <b className="w-[56px] shrink-0 text-[11px]">{T("مبنى", "Bldg")}</b>
          <input className={`${inputCls} h-8`} value={buildingNumber} onChange={(e) => setBuildingNumber(e.target.value)} placeholder="0000" />
        </label>
        <label className="flex items-center gap-1">
          <b className="w-[56px] shrink-0 text-[11px]">{T("شارع", "Street")}</b>
          <input className={`${inputCls} h-8`} value={streetName} onChange={(e) => setStreetName(e.target.value)} />
        </label>
        <label className="flex items-center gap-1">
          <b className="w-[56px] shrink-0 text-[11px]">{T("حي", "District")}</b>
          <input className={`${inputCls} h-8`} value={district} onChange={(e) => setDistrict(e.target.value)} />
        </label>
        <label className="flex items-center gap-1">
          <b className="w-[56px] shrink-0 text-[11px]">{T("مدينة", "City")}</b>
          <input className={`${inputCls} h-8`} value={city} onChange={(e) => setCity(e.target.value)} />
        </label>
        <label className="flex items-center gap-1">
          <b className="w-[56px] shrink-0 text-[11px]">{T("رمز بريدي", "Postal")}</b>
          <input className={`${inputCls} h-8`} value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="00000" />
        </label>
        <label className="flex items-center gap-1">
          <b className="w-[56px] shrink-0 text-[11px]">{T("إضافي", "Addl")}</b>
          <input className={`${inputCls} h-8`} value={additionalNumber} onChange={(e) => setAdditionalNumber(e.target.value)} placeholder="0000" />
        </label>
      </div>

      {/* ===== Zone 3: item search + green table ===== */}
      <div className="relative flex min-h-[150px] flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-1 border-b border-[#bbb] bg-white px-1.5 py-1">
          <label className="flex min-w-[260px] flex-1 items-center gap-1">
            <b className="whitespace-nowrap text-[11px]">{T("صنف", "Item")}</b>
            <input
              ref={searchRef}
              className="h-8 flex-1 border-2 px-2 text-[13px] font-bold text-white outline-none placeholder:text-white/70"
              style={{ background: query ? "#2fae4e" : "#e53935", borderColor: query ? "#1d7a37" : "#c62828" }}
              value={query}
              onFocus={() => setGridOpen(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setGridOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (results.length) addProduct(results[0]);
                  else addLine();
                }
                if (e.key === "Escape") setGridOpen(false);
              }}
              placeholder={T("باركود / كود / اسم الصنف — Enter", "Barcode / code / item name — Enter")}
            />
          </label>
          <button type="button" className={btnGreenCls} onClick={addLine}>
            + {T("بند يدوي", "Manual line")}
          </button>
          <button type="button" className={btnCls} onClick={() => setGridOpen((v) => !v)}>
            {T("قائمة اللمس", "Touch list")}
          </button>
        </div>

        {gridOpen && (
          <div className="absolute inset-x-0 top-[42px] z-30 max-h-[70%] overflow-auto border-[3px] border-[#2fae4e] bg-white p-1 shadow-lg">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr style={{ background: "#2fae4e", color: "#fff" }}>
                  {[T("الكود", "Code"), T("الصنف", "Item"), T("الوحدة", "Unit"), T("المتاح", "Avail"), T("السعر", "Price")].map((c) => (
                    <th key={c} className="border border-[#1d7a37] px-1 py-1 font-normal">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((p: any, index: number) => (
                  <tr
                    key={p.id}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addProduct(p);
                    }}
                    className="cursor-pointer"
                    style={{ background: index === 0 ? "#22e022" : undefined }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#22e022"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = index === 0 ? "#22e022" : ""; }}
                  >
                    <td className="border border-[#ddd] px-1 py-0.5 text-center">{p.sku || p.barcode || ""}</td>
                    <td className="border border-[#ddd] px-1 py-0.5 text-center">
                      {p.nameAr || p.name}
                      <div className="text-[9px] text-[#666]">{p.name}</div>
                    </td>
                    <td className="border border-[#ddd] px-1 py-0.5 text-center">{p.unitName || p.unit || "PCE"}</td>
                    <td className="border border-[#ddd] px-1 py-0.5 text-center tabular-nums">{n(p.stock ?? p.quantity)}</td>
                    <td className="border border-[#ddd] px-1 py-0.5 text-center font-bold tabular-nums">{money(n(p.salePrice ?? p.price))}</td>
                  </tr>
                ))}
                {!results.length && (
                  <tr>
                    <td colSpan={5} className="border border-[#ddd] p-2 text-center text-[#666]">
                      {T("لا توجد نتائج — أضف بنداً يدوياً", "No results — add a manual line")}
                      <button type="button" className={`${btnGreenCls} ms-2`} onClick={addLine}>
                        + {T("بند", "Line")}
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="flex items-center justify-end gap-1 border-t-2 border-[#2fae4e] bg-[#e8f5e9] px-1 py-1">
              <button type="button" className={btnGreenCls} onClick={addLine}>+ {T("بند جديد", "New line")}</button>
              <button type="button" className={btnCls} onClick={() => { setQuery(""); setGridOpen(false); }}>{T("إخفاء", "Hide")}</button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr style={{ background: "#2fae4e", color: "#fff" }}>
                {[
                  "#",
                  T("الكود", "Code"),
                  T("اسم الصنف", "Item"),
                  T("الوحدة", "Unit"),
                  T("الكمية", "Qty"),
                  T("السعر", "Price"),
                  T("الإجمالي", "Total"),
                  T("الخصم", "Disc"),
                  T("الفئة", "Tax cat"),
                  T("ضريبة %", "VAT %"),
                  T("إجراءات", "Actions"),
                ].map((c) => (
                  <th key={c} className="border border-[#1d7a37] px-1 py-1 font-normal">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!lines.length && (
                <tr>
                  <td colSpan={11} className="py-6 text-center text-[#888]">
                    {T("فاتورة فارغة — ابحث عن صنف (الحقل الأحمر) وأضفه", "Empty — search an item (red field) and add it")}
                  </td>
                </tr>
              )}
              {lines.map((line, index) => {
                const gross = Math.round(line.qty * line.price * 100) / 100;
                return (
                  <tr
                    key={line.key}
                    onClick={() => setSelected(index)}
                    className="cursor-pointer"
                    style={{ background: index === selected ? "#22e022" : undefined }}
                  >
                    <td className="border border-[#ccc] px-1 py-0.5 text-center">{index + 1}</td>
                    <td className="border border-[#ccc] px-1 py-0.5 text-center">
                      {allowItemCode ? (
                        <input className="w-[70px] border-0 bg-transparent text-center" value={line.code} onChange={(e) => patchLine(index, { code: e.target.value })} />
                      ) : (
                        line.code
                      )}
                    </td>
                    <td className="border border-[#ccc] px-1 py-0.5">
                      <input className="w-full min-w-[120px] border-0 bg-transparent" value={line.name} onChange={(e) => patchLine(index, { name: e.target.value })} />
                      {line.nameAr && <div className="text-[10px] text-[#555]" dir="rtl">{line.nameAr}</div>}
                    </td>
                    <td className="border border-[#ccc] px-1 py-0.5 text-center">
                      <input className="w-[54px] border-0 bg-transparent text-center" value={line.unit} onChange={(e) => patchLine(index, { unit: e.target.value })} />
                    </td>
                    <td className="border border-[#ccc] px-1 py-0.5 text-center">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        className="w-[58px] border-0 bg-transparent text-center tabular-nums"
                        value={line.qty}
                        onChange={(e) => patchLine(index, { qty: Math.max(0, n(e.target.value)) })}
                      />
                    </td>
                    <td className="border border-[#ccc] px-1 py-0.5 text-center">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="w-[74px] border-0 bg-transparent text-center tabular-nums"
                        value={line.price}
                        onChange={(e) => patchLine(index, { price: Math.max(0, n(e.target.value)) })}
                      />
                    </td>
                    <td className="border border-[#ccc] px-1 py-0.5 text-center font-bold tabular-nums">
                      {money(gross - line.discount)}
                    </td>
                    <td className="border border-[#ccc] px-1 py-0.5 text-center">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="w-[62px] border-0 bg-transparent text-center tabular-nums"
                        value={line.discount}
                        onChange={(e) => patchLine(index, { discount: Math.min(gross, Math.max(0, n(e.target.value))) })}
                      />
                    </td>
                    <td className="border border-[#ccc] px-1 py-0.5 text-center">
                      <select
                        className="w-[54px] border-0 bg-transparent text-center"
                        value={line.taxCategory}
                        onChange={(e) => {
                          const category = e.target.value as SharedInvoiceLine["taxCategory"];
                          patchLine(index, {
                            taxCategory: category,
                            taxPercent: category === "S" ? line.taxPercent || 15 : 0,
                          });
                        }}
                      >
                        <option value="S">S</option>
                        <option value="Z">Z</option>
                        <option value="E">E</option>
                        <option value="O">O</option>
                      </select>
                    </td>
                    <td className="border border-[#ccc] px-1 py-0.5 text-center">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={line.taxCategory !== "S"}
                        className="w-[56px] border-0 bg-transparent text-center tabular-nums disabled:text-[#888]"
                        value={line.taxCategory === "S" ? line.taxPercent : 0}
                        onChange={(e) => patchLine(index, { taxPercent: Math.max(0, n(e.target.value)) })}
                      />
                    </td>
                    <td className="border border-[#ccc] px-1 py-0.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <span className="flex items-center justify-center gap-0.5">
                        <button type="button" className="border border-[#999] bg-white px-1" onClick={() => moveLine(index, -1)} title={T("أعلى", "Up")}>▲</button>
                        <button type="button" className="border border-[#999] bg-white px-1" onClick={() => moveLine(index, 1)} title={T("أسفل", "Down")}>▼</button>
                        <button type="button" className="border border-[#999] bg-white px-1 text-red-700" onClick={() => removeLine(index)} title={T("حذف", "Delete")}>✕</button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* exemption reason for non-standard categories */}
          {lines.some((l) => l.taxCategory === "E" || l.taxCategory === "O" || l.taxCategory === "Z") && (
            <div className="grid gap-1 border-t border-[#ccc] bg-[#fff8e1] px-1.5 py-1 md:grid-cols-3">
              <div className="md:col-span-2 text-[11px] text-[#7a6100]">
                {T(
                  "الفئات E / O / Z کے لیے استثناء کی وجہ لازمی ہے۔",
                  "E / O / Z tax categories require an exemption reason.",
                )}
              </div>
              {lines.map((line, index) =>
                line.taxCategory === "S" ? null : (
                  <label key={`ex-${line.key}`} className="flex items-center gap-1 text-[11px]">
                    <b className="shrink-0">#{index + 1}</b>
                    <input
                      className={`${inputCls} h-7`}
                      placeholder={T("سبب الإعفاء", "Exemption reason")}
                      value={line.exemptionReason || ""}
                      onChange={(e) => patchLine(index, { exemptionReason: e.target.value })}
                    />
                  </label>
                ),
              )}
            </div>
          )}
        </div>

        <div className="border-t border-[#bbb] bg-[#e0e0e0] px-1.5 py-1 text-[11px] text-[#555]">
          {T("الحفظ يرحّل المخزون والحسابات ويوقّع الفاتورة إلكترونياً", "Saving posts stock/accounts and signs the e-invoice")}
          {" · "}{T("بنود", "Lines")}: {lines.length}
        </div>
      </div>

      {/* ===== Zone 4: green context strip ===== */}
      <div className="flex flex-wrap items-center gap-2 px-1.5 py-1 text-white" style={{ background: "#2fae4e" }}>
        <label className="flex items-center gap-1 text-[11px]">
          <span className="opacity-90">{T("الخصم", "Discount")}</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={headerDiscount}
            onChange={(e) => setHeaderDiscount(Math.max(0, n(e.target.value)))}
            className="h-7 w-[80px] px-1 text-black tabular-nums"
          />
        </label>
        <label className="flex items-center gap-1 text-[11px]">
          <span className="opacity-90">{T("ضريبة %", "Tax %")}</span>
          <input
            type="number"
            min={0}
            value={taxPercent}
            onChange={(e) => {
              const next = Math.max(0, n(e.target.value));
              setTaxPercent(next);
              setLines((prev) => prev.map((l) => (l.taxCategory === "S" ? { ...l, taxPercent: next } : l)));
            }}
            className="h-7 w-[54px] px-1 text-black tabular-nums"
          />
        </label>
        <label className="flex items-center gap-1 text-[11px]">
          <span className="opacity-90">{T("الكاشير", "Cashier")}</span>
          <input value={cashier} onChange={(e) => setCashier(e.target.value)} className="h-7 w-[120px] px-1 text-black" />
        </label>
        <label className="flex min-w-[220px] flex-1 items-center gap-1 text-[11px]">
          <span className="opacity-90">{T("ملاحظة", "Note")}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className="h-7 flex-1 px-1 text-black" />
        </label>
        <label className="flex items-center gap-1 text-[11px]">
          <span className="opacity-90">{T("عربي", "AR")}</span>
          <input dir="rtl" value={noteAr} onChange={(e) => setNoteAr(e.target.value)} className="h-7 w-[150px] px-1 text-black" />
        </label>
        <span className="ms-auto text-[12px]">
          {T("الصافي", "Net")}: <b className="tabular-nums">{money(totals.total)}</b>
        </span>
      </div>

      {/* ===== Zone 5: dark dock ===== */}
      <div className="flex flex-wrap items-center gap-1 bg-[#333333] px-1.5 py-1 text-[11px] text-white" dir="ltr">
        <button type="button" className="flex items-center gap-1 border border-[#0a5c2a] px-2 py-1 font-bold hover:brightness-110" style={{ background: "#2fae4e" }} disabled={saving} onClick={() => void handleSubmit()}>
          ✓ <b>{T("حفظ F9", "Save F9")}</b>
        </button>
        <button type="button" className="border border-[#555] bg-[#3a3a3a] px-2 py-1 hover:bg-[#444]" disabled={saving} onClick={() => void handleSubmit(undefined, true)}>
          🖨 <b>{T("حفظ وطباعة F11", "Save & print F11")}</b>
        </button>
        {isEditing && (
          <button type="button" className="border border-[#8a6d00] bg-[#f7c631] px-2 py-1 font-bold text-black hover:brightness-105" onClick={() => onCancelEdit?.()}>
            ✖ <b>{T("إلغاء التعديل", "Cancel edit")}</b>
          </button>
        )}
        <button type="button" className="border border-[#555] bg-[#1565c0] px-2 py-1 hover:bg-[#1b74d4]" onClick={resetForm}>
          ➕ <b>{T("جديد F10", "New F10")}</b>
        </button>
        <button type="button" className="border border-[#555] bg-[#3a3a3a] px-2 py-1 hover:bg-[#444]" onClick={addLine}>
          ＋ <b>{T("بند", "Line")}</b>
        </button>
        <span className="mx-1 h-5 w-px bg-[#555]" />
        <span className="text-[10px] text-white/70">
          {saving ? T("جارٍ الحفظ…", "Saving…") : T("جاهز", "Ready")}
        </span>
        {!!totals.vat && (
          <span className="ms-auto border border-white/30 px-1 tabular-nums">
            VAT {money(totals.vat)}
          </span>
        )}
      </div>

      {compact && (
        <div className="border-t border-[#bbb] bg-white px-1.5 py-1 text-[10px] text-[#555]">
          {T("وضع مضغوط", "Compact mode")}
        </div>
      )}
    </form>
  );
}

function studentStreet(customer: any): string {
  if (customer?.streetName) return customer.streetName;
  const address = String(customer?.address || "").trim();
  if (!address) return "";
  const parts = address.split(",").map((p: string) => p.trim());
  return parts.length > 1 ? parts[1] : parts[0];
}
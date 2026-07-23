"use client";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency } from "@/lib/utils";
import { validatePrice, validateDuration } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { Service } from "@/lib/database.types";

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-[#141414] border border-[#2a2a2a] rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-white">✓</span>{message}
      <button onClick={onClose} className="text-[#8f8f8f] hover:text-white ml-2">✕</button>
    </div>
  );
}

const CATEGORY_COLORS: Record<string, string> = {
  Hair: "text-blue-400 bg-blue-500/20 border-blue-500/30",
  Beard: "text-white bg-black/10 border-black",
  Packages: "text-emerald-400 bg-emerald-500/20 border-emerald-500/30",
};

const BLANK_SVC = { name: "", price: "", duration_minutes: "", category: "Hair", description: "", is_active: true, deposit_required: false, deposit_amount: "" };

export default function ServicesPage() {
  const { shop } = useAuth();
  const [toast, setToast] = useState("");
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [editService, setEditService] = useState<Service | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [newSvc, setNewSvc] = useState(BLANK_SVC);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const loadData = useCallback(async () => {
    if (!shop) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.from("services").select("*").eq("shop_id", shop.id).order("category").order("name");
    if (data) setServices(data);
    setLoading(false);
  }, [shop]);

  useEffect(() => { loadData(); }, [loadData]);

  const categories = ["Hair", "Beard", "Packages"];
  const grouped = categories.reduce((acc, cat) => {
    acc[cat] = services.filter(s => s.category === cat);
    return acc;
  }, {} as Record<string, Service[]>);

  const openEditService = (s: Service) => {
    setEditService(s);
    setNewSvc({ name: s.name, price: String(s.price), duration_minutes: String(s.duration_minutes), category: s.category, description: s.description ?? "", is_active: s.is_active, deposit_required: s.deposit_required ?? false, deposit_amount: String(s.deposit_amount ?? "") });
    setShowServiceModal(true);
  };

  const toggleServiceActive = async (svc: Service) => {
    const { error } = await supabase.from("services").update({ is_active: !svc.is_active }).eq("id", svc.id);
    if (!error) setServices(prev => prev.map(s => s.id === svc.id ? { ...s, is_active: !s.is_active } : s));
  };

  const saveService = async () => {
    if (!shop) return;
    if (!newSvc.name.trim() || newSvc.name.trim().length < 3) { showToast("Service name must be at least 3 characters"); return; }
    const priceErr = validatePrice(newSvc.price);
    if (priceErr) { showToast(priceErr); return; }
    const durErr = validateDuration(newSvc.duration_minutes);
    if (durErr) { showToast(durErr); return; }
    setSaving(true);
    const payload = {
      shop_id: shop.id,
      name: newSvc.name.trim(),
      price: Number(newSvc.price),
      duration_minutes: Number(newSvc.duration_minutes),
      category: newSvc.category,
      description: newSvc.description,
      is_active: newSvc.is_active,
      // Deposits are retired — no-show protection replaces them. Any service
      // saved/edited clears its legacy deposit flag.
      deposit_required: false,
      deposit_amount: 0,
    };
    if (editService) {
      const { error } = await supabase.from("services").update(payload).eq("id", editService.id);
      if (!error) { showToast("Service updated!"); loadData(); }
      else showToast("Error: " + error.message);
    } else {
      const { error } = await supabase.from("services").insert(payload);
      if (!error) { showToast("Service added!"); loadData(); }
      else showToast("Error: " + error.message);
    }
    setSaving(false);
    setShowServiceModal(false);
    setEditService(null);
    setNewSvc(BLANK_SVC);
  };

  const deleteService = async (id: string) => {
    // Check for upcoming appointments
    const today = new Date().toISOString().split("T")[0];
    const { count } = await supabase.from("appointments").select("id", { count: "exact", head: true })
      .eq("service_id", id).gte("date", today).in("status", ["pending", "confirmed"]);
    if (count && count > 0) {
      showToast(`Cannot delete — has ${count} upcoming booking${count > 1 ? "s" : ""}`);
      setDeleteConfirm(null);
      return;
    }
    const { error } = await supabase.from("services").delete().eq("id", id);
    if (!error) { setServices(prev => prev.filter(s => s.id !== id)); showToast("Service deleted."); }
    else showToast("Error: " + error.message);
    setDeleteConfirm(null);
  };

  if (!shop) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <p className="text-2xl mb-2">✂️</p>
        <h2 className="text-lg font-bold text-white mb-1">No shop linked</h2>
        <p className="text-sm text-[#8f8f8f]">Services will appear here once your shop is set up.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white uppercase tracking-wide">Services</h1>
          <p className="text-sm text-[#8f8f8f] mt-0.5">Manage your service menu</p>
        </div>
        <Button onClick={() => { setEditService(null); setNewSvc(BLANK_SVC); setShowServiceModal(true); }}>
          + Add Service
        </Button>
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-36 rounded-2xl bg-[#141414] animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {services.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-3xl mb-3">✂️</p>
              <p className="text-[#8f8f8f] text-sm">No services yet. Add your first service above.</p>
            </div>
          ) : categories.map(cat => {
            const catServices = grouped[cat] || [];
            if (catServices.length === 0) return null;
            return (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-sm font-semibold text-[#8f8f8f]">{cat}</h2>
                  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border", CATEGORY_COLORS[cat] ?? "text-[#8f8f8f] bg-gray-500/20 border-gray-500/30")}>
                    {catServices.length}
                  </span>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {catServices.map(svc => (
                    <Card key={svc.id} className={cn("relative", !svc.is_active && "opacity-60")}>
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h3 className="text-white font-semibold">{svc.name}</h3>
                          <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border mt-1", CATEGORY_COLORS[svc.category] ?? "")}>
                            {svc.category}
                          </span>
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-bold text-white">{formatCurrency(svc.price)}</p>
                          <p className="text-xs text-[#8f8f8f]">{svc.duration_minutes} min</p>
                        </div>
                      </div>
                      <p className="text-xs text-[#8f8f8f] mb-2 line-clamp-2">{svc.description}</p>
                      <div className="flex items-center justify-between">
                        <Switch checked={!!svc.is_active} onChange={() => toggleServiceActive(svc)} />
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => openEditService(svc)}>Edit</Button>
                          <Button variant="danger" size="sm" onClick={() => setDeleteConfirm(svc.id)}>Delete</Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Service Modal */}
      {showServiceModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setShowServiceModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-black shadow-sm border border-[#2a2a2a] rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">{editService ? "Edit Service" : "Add Service"}</h2>
                <button onClick={() => setShowServiceModal(false)} className="text-[#8f8f8f] hover:text-white">✕</button>
              </div>
              <Input label="Service Name" value={newSvc.name} onChange={e => setNewSvc(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Skin Fade" />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Price ($)" type="number" value={newSvc.price} onChange={e => setNewSvc(p => ({ ...p, price: e.target.value }))} placeholder="35" />
                <Input label="Duration (min)" type="number" value={newSvc.duration_minutes} onChange={e => setNewSvc(p => ({ ...p, duration_minutes: e.target.value }))} placeholder="45" />
              </div>
              <Select label="Category" value={newSvc.category} onChange={e => setNewSvc(p => ({ ...p, category: e.target.value }))}>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
                <option value="Other">Other</option>
              </Select>
              <div>
                <Textarea label="Description" value={newSvc.description} onChange={e => setNewSvc(p => ({ ...p, description: e.target.value.slice(0, 100) }))} rows={2} maxLength={100} placeholder="Brief description..." />
                <p className={cn("text-[11px] mt-1 text-right", newSvc.description.length >= 100 ? "text-amber-400" : "text-[#8f8f8f]")}>{newSvc.description.length}/100</p>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Switch checked={!!newSvc.is_active} onChange={v => setNewSvc(p => ({ ...p, is_active: v }))} />
                  <span className="text-sm text-[#8f8f8f]">Active</span>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowServiceModal(false)}>Cancel</Button>
                <Button className="flex-1" loading={saving} onClick={saveService}>{editService ? "Update" : "Add"} Service</Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setDeleteConfirm(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-black shadow-sm border border-[#2a2a2a] rounded-2xl p-6 w-full max-w-sm space-y-4 text-center">
              <p className="text-lg font-bold text-white">Delete Service?</p>
              <p className="text-sm text-[#8f8f8f]">This action cannot be undone.</p>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
                <Button variant="danger" className="flex-1" onClick={() => deleteService(deleteConfirm)}>Delete</Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

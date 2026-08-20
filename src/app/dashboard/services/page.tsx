"use client";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency } from "@/lib/utils";
import { validatePrice, validateDuration } from "@/lib/validation";
import { DashboardHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Sparkles, Plus, Check, Clock, Pencil, Trash2 } from "lucide-react";
import type { Service } from "@/lib/database.types";

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-24 lg:bottom-6 right-4 lg:right-6 z-[100] bg-card-raised border border-border rounded-xl px-5 py-3 text-sm text-foreground shadow-xl flex items-center gap-3">
      <Check size={15} className="text-emerald-400" />{message}
      <button onClick={onClose} className="text-grey hover:text-foreground ml-2">✕</button>
    </div>
  );
}

const BASE_CATEGORIES = ["Hair", "Beard", "Packages"];

const CATEGORY_COLORS: Record<string, string> = {
  Hair: "text-sky-300 bg-sky-500/15 border-sky-500/25",
  Beard: "text-amber-300 bg-amber-500/15 border-amber-500/25",
  Packages: "text-emerald-300 bg-emerald-500/15 border-emerald-500/25",
};
const catColor = (c: string) => CATEGORY_COLORS[c] ?? "text-grey bg-white/5 border-border";

// Curated starter menu — realistic CAD prices/durations a shop can add in one
// tap and tweak later. Grouped by the same categories the page renders.
type Template = { name: string; price: number; duration_minutes: number; category: string; description: string };
const SERVICE_TEMPLATES: Template[] = [
  // Hair
  { name: "Haircut", price: 30, duration_minutes: 30, category: "Hair", description: "Classic cut, wash & style" },
  { name: "Skin Fade", price: 35, duration_minutes: 45, category: "Hair", description: "Bald fade blended high & tight" },
  { name: "Scissor Cut", price: 35, duration_minutes: 45, category: "Hair", description: "Full scissor cut & style" },
  { name: "Buzz Cut", price: 20, duration_minutes: 20, category: "Hair", description: "One-guard all over" },
  { name: "Kids Cut (under 12)", price: 22, duration_minutes: 30, category: "Hair", description: "Cuts for the little ones" },
  { name: "Senior Cut (65+)", price: 22, duration_minutes: 30, category: "Hair", description: "A relaxed cut for seniors" },
  { name: "Line Up / Edge Up", price: 15, duration_minutes: 15, category: "Hair", description: "Sharpen the hairline" },
  { name: "Wash & Style", price: 18, duration_minutes: 20, category: "Hair", description: "Shampoo, condition & style" },
  // Beard
  { name: "Beard Trim", price: 18, duration_minutes: 20, category: "Beard", description: "Shape & tidy the beard" },
  { name: "Beard Sculpt", price: 25, duration_minutes: 30, category: "Beard", description: "Detailed line-up & shape" },
  { name: "Hot Towel Shave", price: 30, duration_minutes: 30, category: "Beard", description: "Traditional straight-razor shave" },
  { name: "Beard + Line Up", price: 25, duration_minutes: 30, category: "Beard", description: "Beard shape with a fresh line-up" },
  // Packages
  { name: "Cut + Beard", price: 50, duration_minutes: 60, category: "Packages", description: "Haircut with a full beard trim" },
  { name: "The Full Service", price: 65, duration_minutes: 75, category: "Packages", description: "Cut, beard sculpt & hot towel shave" },
  { name: "Father & Son", price: 50, duration_minutes: 60, category: "Packages", description: "Two cuts, one appointment" },
  { name: "Cut + Wash + Style", price: 40, duration_minutes: 45, category: "Packages", description: "The complete refresh" },
];

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
  const [showTemplates, setShowTemplates] = useState(false);
  const [selectedTemplates, setSelectedTemplates] = useState<Set<string>>(new Set());
  const [addingTemplates, setAddingTemplates] = useState(false);

  const [newSvc, setNewSvc] = useState(BLANK_SVC);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const loadData = useCallback(async () => {
    if (!shop) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from("services").select("*").eq("shop_id", shop.id).order("category").order("name");
    if (error) showToast("Couldn't load services — please refresh.");
    if (data) setServices(data);
    setLoading(false);
  }, [shop]);

  useEffect(() => { loadData(); }, [loadData]);

  // Render EVERY category present, not just the base three — otherwise a service
  // saved under "Other"/a custom category silently vanished from this page.
  const categories = [
    ...BASE_CATEGORIES,
    ...Array.from(new Set(services.map(s => s.category))).filter(c => !BASE_CATEGORIES.includes(c)).sort(),
  ];
  const grouped = categories.reduce((acc, cat) => {
    acc[cat] = services.filter(s => s.category === cat);
    return acc;
  }, {} as Record<string, Service[]>);
  const activeCount = services.filter(s => s.is_active).length;
  const existingNames = new Set(services.map(s => s.name.trim().toLowerCase()));

  const openAdd = () => { setEditService(null); setNewSvc(BLANK_SVC); setShowServiceModal(true); };
  const openTemplates = () => { setSelectedTemplates(new Set()); setShowTemplates(true); };

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

  const toggleTemplate = (name: string) => {
    setSelectedTemplates(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const addSelectedTemplates = async () => {
    if (!shop) return;
    const toAdd = SERVICE_TEMPLATES.filter(t => selectedTemplates.has(t.name) && !existingNames.has(t.name.toLowerCase()));
    if (toAdd.length === 0) { showToast("Pick a service or two to add first."); return; }
    setAddingTemplates(true);
    const payloads = toAdd.map(t => ({
      shop_id: shop.id, name: t.name, price: t.price, duration_minutes: t.duration_minutes,
      category: t.category, description: t.description, is_active: true, deposit_required: false, deposit_amount: 0,
    }));
    const { error } = await supabase.from("services").insert(payloads);
    setAddingTemplates(false);
    if (error) { showToast("Couldn't add those: " + error.message); return; }
    showToast(`Added ${toAdd.length} service${toAdd.length > 1 ? "s" : ""}!`);
    setShowTemplates(false);
    setSelectedTemplates(new Set());
    loadData();
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
        <h2 className="text-lg font-bold text-foreground mb-1">No shop linked</h2>
        <p className="text-sm text-grey">Services will appear here once your shop is set up.</p>
      </div>
    );
  }

  const selectableCount = SERVICE_TEMPLATES.filter(t => selectedTemplates.has(t.name) && !existingNames.has(t.name.toLowerCase())).length;

  return (
    <div className="min-h-screen bg-background px-4 sm:px-6 pb-28">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <DashboardHeader
        title="Services"
        subtitle={services.length ? `${services.length} service${services.length > 1 ? "s" : ""} · ${activeCount} live` : "Your booking menu"}
        action={
          <button onClick={openAdd}
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-full bg-foreground text-background hover:opacity-90 active:opacity-80 transition-opacity whitespace-nowrap">
            <Plus size={16} /> Add
          </button>
        }
      />

      {/* Quick "add from templates" strip — the fast path to a full menu. */}
      {!loading && services.length > 0 && (
        <button onClick={openTemplates}
          className="w-full mb-5 flex items-center gap-3 p-3.5 rounded-2xl border border-dashed border-border bg-card-raised/60 hover:border-emerald-400/50 hover:bg-card-raised transition-colors text-left">
          <span className="w-9 h-9 rounded-full bg-emerald-500/15 text-emerald-300 flex items-center justify-center flex-shrink-0"><Sparkles size={17} /></span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">Add from templates</span>
            <span className="block text-xs text-grey">Popular barbershop services, ready to tweak</span>
          </span>
        </button>
      )}

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-36 rounded-2xl bg-card-raised animate-pulse" />
          ))}
        </div>
      ) : services.length === 0 ? (
        <div className="text-center py-14 rounded-2xl border border-border bg-card">
          <p className="text-4xl mb-3">✂️</p>
          <p className="text-base font-semibold text-foreground">Build your service menu</p>
          <p className="text-sm text-grey mt-1 mb-5 max-w-xs mx-auto">Start from our ready-made barbershop menu, then tweak prices — or add your own from scratch.</p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center px-6">
            <button onClick={openTemplates}
              className="inline-flex items-center justify-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl bg-emerald-500 text-black hover:opacity-90 transition-opacity">
              <Sparkles size={16} /> Start from templates
            </button>
            <button onClick={openAdd}
              className="inline-flex items-center justify-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl border border-border text-foreground hover:bg-card-raised transition-colors">
              <Plus size={16} /> Add your own
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {categories.map(cat => {
            const catServices = grouped[cat] || [];
            if (catServices.length === 0) return null;
            return (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-sm font-semibold text-grey">{cat}</h2>
                  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border", catColor(cat))}>
                    {catServices.length}
                  </span>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {catServices.map(svc => (
                    <Card key={svc.id} className={cn("relative flex flex-col", !svc.is_active && "opacity-55")}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                          <h3 className="text-foreground font-semibold truncate">{svc.name}</h3>
                          <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium border mt-1.5", catColor(svc.category))}>
                            {svc.category}
                          </span>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-xl font-bold text-foreground tabular-nums">{formatCurrency(svc.price)}</p>
                          <p className="text-xs text-grey inline-flex items-center gap-1 justify-end"><Clock size={11} />{svc.duration_minutes} min</p>
                        </div>
                      </div>
                      {svc.description && <p className="text-xs text-grey mb-3 line-clamp-2">{svc.description}</p>}
                      <div className="flex items-center justify-between mt-auto pt-1">
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <Switch checked={!!svc.is_active} onChange={() => toggleServiceActive(svc)} />
                          <span className="text-xs text-grey">{svc.is_active ? "Live" : "Hidden"}</span>
                        </label>
                        <div className="flex gap-1.5">
                          <button onClick={() => openEditService(svc)} aria-label="Edit"
                            className="w-8 h-8 rounded-lg border border-border text-grey hover:text-foreground hover:bg-card-raised flex items-center justify-center transition-colors"><Pencil size={15} /></button>
                          <button onClick={() => setDeleteConfirm(svc.id)} aria-label="Delete"
                            className="w-8 h-8 rounded-lg border border-border text-grey hover:text-red-400 hover:border-red-500/40 flex items-center justify-center transition-colors"><Trash2 size={15} /></button>
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

      {/* Templates picker */}
      {showTemplates && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setShowTemplates(false)} />
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
            <div className="bg-card border-t sm:border border-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[88vh] flex flex-col">
              <div className="flex items-start justify-between gap-3 p-5 border-b border-border">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-foreground flex items-center gap-2"><Sparkles size={18} className="text-emerald-300" /> Add from templates</h2>
                  <p className="text-xs text-grey mt-0.5">Tap to pick — prices &amp; times are just a starting point.</p>
                </div>
                <button onClick={() => setShowTemplates(false)} className="text-grey hover:text-foreground flex-shrink-0">✕</button>
              </div>
              <div className="overflow-y-auto overscroll-contain px-4 py-3 space-y-4">
                {BASE_CATEGORIES.map(cat => {
                  const items = SERVICE_TEMPLATES.filter(t => t.category === cat);
                  if (!items.length) return null;
                  return (
                    <div key={cat}>
                      <p className="text-[11px] font-bold uppercase tracking-wider text-grey px-1 mb-2">{cat}</p>
                      <div className="space-y-2">
                        {items.map(t => {
                          const already = existingNames.has(t.name.toLowerCase());
                          const selected = selectedTemplates.has(t.name);
                          return (
                            <button key={t.name} type="button" disabled={already} onClick={() => toggleTemplate(t.name)}
                              className={cn("w-full flex items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                                already ? "border-border bg-card-raised/50 opacity-60 cursor-default"
                                  : selected ? "border-emerald-400 ring-1 ring-emerald-400 bg-emerald-500/5"
                                    : "border-border bg-card hover:border-foreground/30")}>
                              <span className={cn("w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                                already ? "border-grey bg-grey/20" : selected ? "border-emerald-400 bg-emerald-400" : "border-grey")}>
                                {(selected || already) && <Check size={12} className={already ? "text-grey" : "text-black"} />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold text-foreground truncate">{t.name}</span>
                                <span className="block text-xs text-grey truncate">{t.description}</span>
                              </span>
                              <span className="text-right flex-shrink-0">
                                <span className="block text-sm font-bold text-foreground tabular-nums">{formatCurrency(t.price)}</span>
                                <span className="block text-[11px] text-grey">{already ? "Added" : `${t.duration_minutes} min`}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-3 p-4 border-t border-border pb-[max(1rem,env(safe-area-inset-bottom))]">
                <Button variant="outline" className="flex-1" onClick={() => setShowTemplates(false)}>Cancel</Button>
                <Button className="flex-1" loading={addingTemplates} disabled={selectableCount === 0} onClick={addSelectedTemplates}>
                  {selectableCount > 0 ? `Add ${selectableCount} service${selectableCount > 1 ? "s" : ""}` : "Add services"}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Service Modal */}
      {showServiceModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setShowServiceModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-card shadow-sm border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">{editService ? "Edit Service" : "Add Service"}</h2>
                <button onClick={() => setShowServiceModal(false)} className="text-grey hover:text-foreground">✕</button>
              </div>
              <Input label="Service Name" value={newSvc.name} onChange={e => setNewSvc(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Skin Fade" />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Price ($)" type="number" value={newSvc.price} onChange={e => setNewSvc(p => ({ ...p, price: e.target.value }))} placeholder="35" />
                <Input label="Duration (min)" type="number" value={newSvc.duration_minutes} onChange={e => setNewSvc(p => ({ ...p, duration_minutes: e.target.value }))} placeholder="45" />
              </div>
              <Select label="Category" value={newSvc.category} onChange={e => setNewSvc(p => ({ ...p, category: e.target.value }))}>
                {Array.from(new Set([...categories, newSvc.category])).map(c => <option key={c} value={c}>{c}</option>)}
                <option value="Other">Other</option>
              </Select>
              <div>
                <Textarea label="Description" value={newSvc.description} onChange={e => setNewSvc(p => ({ ...p, description: e.target.value.slice(0, 100) }))} rows={2} maxLength={100} placeholder="Brief description..." />
                <p className={cn("text-[11px] mt-1 text-right", newSvc.description.length >= 100 ? "text-amber-400" : "text-grey")}>{newSvc.description.length}/100</p>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Switch checked={!!newSvc.is_active} onChange={v => setNewSvc(p => ({ ...p, is_active: v }))} />
                  <span className="text-sm text-grey">Active</span>
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
            <div className="bg-card shadow-sm border border-border rounded-2xl p-6 w-full max-w-sm space-y-4 text-center">
              <p className="text-lg font-bold text-foreground">Delete Service?</p>
              <p className="text-sm text-grey">This action cannot be undone.</p>
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

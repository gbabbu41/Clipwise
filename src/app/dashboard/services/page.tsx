"use client";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency } from "@/lib/utils";
import { validatePrice, validateDuration } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import type { Service, InventoryItem } from "@/lib/database.types";

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-surface-raised border border-border rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-gold">✓</span>{message}
      <button onClick={onClose} className="text-gray-400 hover:text-white ml-2">✕</button>
    </div>
  );
}

const CATEGORY_COLORS: Record<string, string> = {
  Hair: "text-blue-400 bg-blue-500/20 border-blue-500/30",
  Beard: "text-gold bg-gold/20 border-gold/30",
  Packages: "text-emerald-400 bg-emerald-500/20 border-emerald-500/30",
};

const BLANK_SVC = { name: "", price: "", duration_minutes: "", category: "Hair", description: "", is_active: true, deposit_required: false, deposit_amount: "" };
const BLANK_INV = { name: "", category: "", price: "", cost_price: "", quantity: "", low_stock_threshold: "" };

export default function ServicesPage() {
  const { shop } = useAuth();
  const [tab, setTab] = useState<"services" | "inventory">("services");
  const [toast, setToast] = useState("");
  const [services, setServices] = useState<Service[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [editService, setEditService] = useState<Service | null>(null);
  const [showInvModal, setShowInvModal] = useState(false);
  const [editInv, setEditInv] = useState<InventoryItem | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [newSvc, setNewSvc] = useState(BLANK_SVC);
  const [newInv, setNewInv] = useState(BLANK_INV);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const loadData = useCallback(async () => {
    if (!shop) { setLoading(false); return; }
    setLoading(true);
    const [svcRes, invRes] = await Promise.all([
      supabase.from("services").select("*").eq("shop_id", shop.id).order("category").order("name"),
      supabase.from("inventory").select("*").eq("shop_id", shop.id).order("name"),
    ]);
    if (svcRes.data) setServices(svcRes.data);
    if (invRes.data) setInventory(invRes.data);
    setLoading(false);
  }, [shop]);

  useEffect(() => { loadData(); }, [loadData]);

  const categories = ["Hair", "Beard", "Packages"];
  const grouped = categories.reduce((acc, cat) => {
    acc[cat] = services.filter(s => s.category === cat);
    return acc;
  }, {} as Record<string, Service[]>);

  const lowStock = inventory.filter(i => i.quantity <= i.low_stock_threshold);
  const margin = (item: InventoryItem) => item.price > 0 && item.cost_price ? Math.round(((item.price - item.cost_price) / item.price) * 100) : 0;

  const openEditService = (s: Service) => {
    setEditService(s);
    setNewSvc({ name: s.name, price: String(s.price), duration_minutes: String(s.duration_minutes), category: s.category, description: s.description ?? "", is_active: s.is_active, deposit_required: s.deposit_required ?? false, deposit_amount: String(s.deposit_amount ?? "") });
    setShowServiceModal(true);
  };

  const openEditInv = (i: InventoryItem) => {
    setEditInv(i);
    setNewInv({ name: i.name, category: i.category ?? "", price: String(i.price), cost_price: String(i.cost_price ?? ""), quantity: String(i.quantity), low_stock_threshold: String(i.low_stock_threshold) });
    setShowInvModal(true);
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
      deposit_required: newSvc.deposit_required,
      deposit_amount: newSvc.deposit_required ? Number(newSvc.deposit_amount) : 0,
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

  const saveInv = async () => {
    if (!shop || !newInv.name.trim()) return;
    setSaving(true);
    const payload = {
      shop_id: shop.id,
      name: newInv.name.trim(),
      category: newInv.category,
      price: Number(newInv.price),
      cost_price: Number(newInv.cost_price),
      quantity: Number(newInv.quantity),
      low_stock_threshold: Number(newInv.low_stock_threshold),
    };
    if (editInv) {
      const { error } = await supabase.from("inventory").update(payload).eq("id", editInv.id);
      if (!error) { showToast("Product updated!"); loadData(); }
      else showToast("Error: " + error.message);
    } else {
      const { error } = await supabase.from("inventory").insert(payload);
      if (!error) { showToast("Product added!"); loadData(); }
      else showToast("Error: " + error.message);
    }
    setSaving(false);
    setShowInvModal(false);
    setEditInv(null);
    setNewInv(BLANK_INV);
  };

  const deleteInv = async (id: string) => {
    const { error } = await supabase.from("inventory").delete().eq("id", id);
    if (!error) { setInventory(prev => prev.filter(i => i.id !== id)); showToast("Product removed."); }
    else showToast("Error: " + error.message);
  };

  if (!shop) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <p className="text-2xl mb-2">✂️</p>
        <h2 className="text-lg font-bold text-white mb-1">No shop linked</h2>
        <p className="text-sm text-gray-400">Services will appear here once your shop is set up.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Services & Inventory</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage your menu and stock</p>
        </div>
        <Button onClick={() => {
          setEditService(null); setNewSvc(BLANK_SVC);
          setEditInv(null); setNewInv(BLANK_INV);
          if (tab === "services") setShowServiceModal(true);
          else setShowInvModal(true);
        }}>
          + {tab === "services" ? "Add Service" : "Add Product"}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(["services","inventory"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors",
              tab === t ? "border-gold text-gold" : "border-transparent text-gray-400 hover:text-white")}>
            {t} {t === "inventory" && lowStock.length > 0 && (
              <span className="ml-1 text-xs bg-red-500/20 text-red-400 px-1.5 rounded-full">{lowStock.length} low</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-36 rounded-2xl bg-surface-raised animate-pulse" />
          ))}
        </div>
      ) : tab === "services" ? (
        <div className="space-y-6">
          {services.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-3xl mb-3">✂️</p>
              <p className="text-gray-400 text-sm">No services yet. Add your first service above.</p>
            </div>
          ) : categories.map(cat => {
            const catServices = grouped[cat] || [];
            if (catServices.length === 0) return null;
            return (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-sm font-semibold text-gray-300">{cat}</h2>
                  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border", CATEGORY_COLORS[cat] ?? "text-gray-400 bg-gray-500/20 border-gray-500/30")}>
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
                          <p className="text-xl font-bold text-gold">{formatCurrency(svc.price)}</p>
                          <p className="text-xs text-gray-400">{svc.duration_minutes} min</p>
                        </div>
                      </div>
                      <p className="text-xs text-gray-400 mb-2">{svc.description}</p>
                      {svc.deposit_required && (
                        <span className="inline-flex items-center gap-1 text-xs bg-gold/15 border border-gold/30 text-gold rounded-full px-2 py-0.5 mb-3">
                          💳 ${svc.deposit_amount} deposit required
                        </span>
                      )}
                      <div className="flex items-center justify-between">
                        <button onClick={() => toggleServiceActive(svc)}
                          className={cn("relative w-10 h-5 rounded-full transition-colors", svc.is_active ? "bg-emerald-500" : "bg-surface-raised border border-border")}>
                          <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all", svc.is_active ? "left-[22px]" : "left-0.5")} />
                        </button>
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
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Card className="py-4 px-5">
              <p className="text-xs text-gray-400">Total Products</p>
              <p className="text-2xl font-bold text-white mt-1">{inventory.length}</p>
            </Card>
            <Card className="py-4 px-5">
              <p className="text-xs text-gray-400">Low Stock</p>
              <p className="text-2xl font-bold text-red-400 mt-1">{lowStock.length}</p>
            </Card>
            <Card className="py-4 px-5">
              <p className="text-xs text-gray-400">Total Value</p>
              <p className="text-2xl font-bold text-gold mt-1">{formatCurrency(inventory.reduce((s, i) => s + i.price * i.quantity, 0))}</p>
            </Card>
          </div>

          {lowStock.length > 0 && (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
              <p className="text-sm font-semibold text-red-400 mb-1">Low Stock Alert</p>
              <p className="text-xs text-gray-400">{lowStock.map(i => i.name).join(", ")} need restocking</p>
            </div>
          )}

          {inventory.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-3xl mb-3">📦</p>
              <p className="text-gray-400 text-sm">No products yet. Add your first product above.</p>
            </div>
          ) : (
            <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-border">
                    <tr>
                      {["Product","Category","Retail","Cost","Margin","Stock","Status","Actions"].map(h => (
                        <th key={h} className="text-left text-xs font-medium text-gray-400 px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.map(item => {
                      const isLow = item.quantity <= item.low_stock_threshold;
                      return (
                        <tr key={item.id} className="border-b border-border/50 hover:bg-surface-raised/30">
                          <td className="px-4 py-3 text-sm font-medium text-white">{item.name}</td>
                          <td className="px-4 py-3 text-sm text-gray-400">{item.category}</td>
                          <td className="px-4 py-3 text-sm text-white">{formatCurrency(item.price)}</td>
                          <td className="px-4 py-3 text-sm text-gray-400">{formatCurrency(item.cost_price ?? 0)}</td>
                          <td className="px-4 py-3 text-sm text-emerald-400">{margin(item)}%</td>
                          <td className="px-4 py-3 text-sm text-white">{item.quantity}</td>
                          <td className="px-4 py-3">
                            <Badge variant={isLow ? "danger" : "success"}>{isLow ? "Low Stock" : "OK"}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <Button variant="outline" size="sm" onClick={() => openEditInv(item)}>Edit</Button>
                              <Button variant="danger" size="sm" onClick={() => deleteInv(item.id)}>Del</Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Service Modal */}
      {showServiceModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setShowServiceModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">{editService ? "Edit Service" : "Add Service"}</h2>
                <button onClick={() => setShowServiceModal(false)} className="text-gray-400 hover:text-white">✕</button>
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
              <Textarea label="Description" value={newSvc.description} onChange={e => setNewSvc(p => ({ ...p, description: e.target.value }))} rows={2} placeholder="Brief description..." />
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <button onClick={() => setNewSvc(p => ({ ...p, is_active: !p.is_active }))}
                    className={cn("relative w-10 h-5 rounded-full transition-colors", newSvc.is_active ? "bg-emerald-500" : "bg-surface-raised border border-border")}>
                    <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all", newSvc.is_active ? "left-[22px]" : "left-0.5")} />
                  </button>
                  <span className="text-sm text-gray-300">Active</span>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setNewSvc(p => ({ ...p, deposit_required: !p.deposit_required }))}
                    className={cn("relative w-10 h-5 rounded-full transition-colors", newSvc.deposit_required ? "bg-gold" : "bg-surface-raised border border-border")}>
                    <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all", newSvc.deposit_required ? "left-[22px]" : "left-0.5")} />
                  </button>
                  <span className="text-sm text-gray-300">Require deposit</span>
                </div>
                {newSvc.deposit_required && (
                  <Input label="Deposit Amount ($)" type="number" value={newSvc.deposit_amount} onChange={e => setNewSvc(p => ({ ...p, deposit_amount: e.target.value }))} placeholder="e.g. 20" />
                )}
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowServiceModal(false)}>Cancel</Button>
                <Button className="flex-1" loading={saving} onClick={saveService}>{editService ? "Update" : "Add"} Service</Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Inventory Modal */}
      {showInvModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setShowInvModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">{editInv ? "Edit Product" : "Add Product"}</h2>
                <button onClick={() => setShowInvModal(false)} className="text-gray-400 hover:text-white">✕</button>
              </div>
              <Input label="Product Name" value={newInv.name} onChange={e => setNewInv(p => ({ ...p, name: e.target.value }))} placeholder="Gold Label Pomade" />
              <Input label="Category" value={newInv.category} onChange={e => setNewInv(p => ({ ...p, category: e.target.value }))} placeholder="Styling" />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Retail Price ($)" type="number" value={newInv.price} onChange={e => setNewInv(p => ({ ...p, price: e.target.value }))} />
                <Input label="Cost Price ($)" type="number" value={newInv.cost_price} onChange={e => setNewInv(p => ({ ...p, cost_price: e.target.value }))} />
                <Input label="Quantity" type="number" value={newInv.quantity} onChange={e => setNewInv(p => ({ ...p, quantity: e.target.value }))} />
                <Input label="Low Stock Alert" type="number" value={newInv.low_stock_threshold} onChange={e => setNewInv(p => ({ ...p, low_stock_threshold: e.target.value }))} />
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowInvModal(false)}>Cancel</Button>
                <Button className="flex-1" loading={saving} onClick={saveInv}>{editInv ? "Update" : "Add"} Product</Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setDeleteConfirm(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-sm space-y-4 text-center">
              <p className="text-lg font-bold text-white">Delete Service?</p>
              <p className="text-sm text-gray-400">This action cannot be undone.</p>
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

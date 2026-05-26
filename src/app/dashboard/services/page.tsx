"use client";
import { useState } from "react";
import { mockServices, mockInventory } from "@/lib/mock-data";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";

type Service = typeof mockServices[0];
type InventoryItem = typeof mockInventory[0];

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

export default function ServicesPage() {
  const [tab, setTab] = useState<"services" | "inventory">("services");
  const [toast, setToast] = useState("");
  const [services, setServices] = useState(mockServices);
  const [inventory, setInventory] = useState(mockInventory);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [editService, setEditService] = useState<Service | null>(null);
  const [showInvModal, setShowInvModal] = useState(false);
  const [editInv, setEditInv] = useState<InventoryItem | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const [newSvc, setNewSvc] = useState({ name: "", price: "", duration_minutes: "", category: "Hair", description: "", is_active: true });
  const [newInv, setNewInv] = useState({ name: "", category: "", price: "", cost_price: "", quantity: "", low_stock_threshold: "" });

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const categories = ["Hair", "Beard", "Packages"];
  const grouped = categories.reduce((acc, cat) => {
    acc[cat] = services.filter(s => s.category === cat);
    return acc;
  }, {} as Record<string, Service[]>);

  const lowStock = inventory.filter(i => i.quantity <= i.low_stock_threshold);
  const margin = (item: InventoryItem) => Math.round(((item.price - item.cost_price) / item.price) * 100);

  const openEditService = (s: Service) => {
    setEditService(s);
    setNewSvc({ name: s.name, price: String(s.price), duration_minutes: String(s.duration_minutes), category: s.category, description: s.description, is_active: s.is_active });
    setShowServiceModal(true);
  };

  const openEditInv = (i: InventoryItem) => {
    setEditInv(i);
    setNewInv({ name: i.name, category: i.category, price: String(i.price), cost_price: String(i.cost_price), quantity: String(i.quantity), low_stock_threshold: String(i.low_stock_threshold) });
    setShowInvModal(true);
  };

  const saveService = () => {
    if (editService) {
      setServices(prev => prev.map(s => s.id === editService.id ? { ...s, ...newSvc, price: Number(newSvc.price), duration_minutes: Number(newSvc.duration_minutes) } : s));
      showToast("Service updated!");
    } else {
      const id = `svc-${Date.now()}`;
      setServices(prev => [...prev, { id, ...newSvc, price: Number(newSvc.price), duration_minutes: Number(newSvc.duration_minutes) }]);
      showToast("Service added!");
    }
    setShowServiceModal(false);
    setEditService(null);
    setNewSvc({ name: "", price: "", duration_minutes: "", category: "Hair", description: "", is_active: true });
  };

  const deleteService = (id: string) => {
    setServices(prev => prev.filter(s => s.id !== id));
    setDeleteConfirm(null);
    showToast("Service deleted.");
  };

  const saveInv = () => {
    if (editInv) {
      setInventory(prev => prev.map(i => i.id === editInv.id ? { ...i, ...newInv, price: Number(newInv.price), cost_price: Number(newInv.cost_price), quantity: Number(newInv.quantity), low_stock_threshold: Number(newInv.low_stock_threshold) } : i));
      showToast("Product updated!");
    } else {
      const id = `inv-${Date.now()}`;
      setInventory(prev => [...prev, { id, ...newInv, price: Number(newInv.price), cost_price: Number(newInv.cost_price), quantity: Number(newInv.quantity), low_stock_threshold: Number(newInv.low_stock_threshold) }]);
      showToast("Product added!");
    }
    setShowInvModal(false);
    setEditInv(null);
    setNewInv({ name: "", category: "", price: "", cost_price: "", quantity: "", low_stock_threshold: "" });
  };

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Services & Inventory</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage your menu and stock</p>
        </div>
        <Button onClick={() => { setEditService(null); setNewSvc({ name: "", price: "", duration_minutes: "", category: "Hair", description: "", is_active: true }); setShowServiceModal(tab === "services"); setShowInvModal(tab === "inventory"); }}>
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

      {tab === "services" ? (
        <div className="space-y-6">
          {categories.map(cat => (
            <div key={cat}>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-sm font-semibold text-gray-300">{cat}</h2>
                <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border", CATEGORY_COLORS[cat] ?? "text-gray-400 bg-gray-500/20 border-gray-500/30")}>
                  {grouped[cat]?.length || 0}
                </span>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {(grouped[cat] || []).map(svc => (
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
                    <p className="text-xs text-gray-400 mb-4">{svc.description}</p>
                    <div className="flex items-center justify-between">
                      <button onClick={() => setServices(prev => prev.map(s => s.id === svc.id ? { ...s, is_active: !s.is_active } : s))}
                        className={cn("relative w-10 h-5 rounded-full transition-colors", svc.is_active ? "bg-emerald-500" : "bg-surface-raised border border-border")}>
                        <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all", svc.is_active ? "left-5.5 translate-x-0.5" : "left-0.5")} />
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
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Inventory Stats */}
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
                        <td className="px-4 py-3 text-sm text-gray-400">{formatCurrency(item.cost_price)}</td>
                        <td className="px-4 py-3 text-sm text-emerald-400">{margin(item)}%</td>
                        <td className="px-4 py-3 text-sm text-white">{item.quantity}</td>
                        <td className="px-4 py-3">
                          <Badge variant={isLow ? "danger" : "success"}>{isLow ? "Low Stock" : "OK"}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => openEditInv(item)}>Edit</Button>
                            <Button variant="danger" size="sm" onClick={() => { setInventory(prev => prev.filter(i => i.id !== item.id)); showToast("Product removed."); }}>Del</Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
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
              </Select>
              <Textarea label="Description" value={newSvc.description} onChange={e => setNewSvc(p => ({ ...p, description: e.target.value }))} rows={2} placeholder="Brief description..." />
              <div className="flex items-center gap-3">
                <button onClick={() => setNewSvc(p => ({ ...p, is_active: !p.is_active }))}
                  className={cn("relative w-10 h-5 rounded-full transition-colors", newSvc.is_active ? "bg-emerald-500" : "bg-surface-raised border border-border")}>
                  <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all", newSvc.is_active ? "left-5.5 translate-x-0.5" : "left-0.5")} />
                </button>
                <span className="text-sm text-gray-300">Active</span>
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowServiceModal(false)}>Cancel</Button>
                <Button className="flex-1" onClick={saveService}>{editService ? "Update" : "Add"} Service</Button>
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
                <Button className="flex-1" onClick={saveInv}>{editInv ? "Update" : "Add"} Product</Button>
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

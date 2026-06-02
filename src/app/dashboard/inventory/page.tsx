"use client";
import { useState, useEffect, useCallback } from "react";
import { Package, Plus, AlertTriangle, TrendingDown, TrendingUp, Search, Pencil, Trash2, Check, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { InventoryItem } from "@/lib/database.types";

const CATEGORIES = ["All", "Hair Care", "Beard Care", "Styling", "Skincare", "Tools", "Other"];

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-[#141414] border border-[#1e1e1e] rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-black">✓</span>{message}
      <button onClick={onClose} className="text-[#777] hover:text-white ml-2">✕</button>
    </div>
  );
}

type BlankItem = { name: string; category: string; price: string; cost_price: string; quantity: string; low_stock_threshold: string };
const BLANK: BlankItem = { name: "", category: "Hair Care", price: "", cost_price: "", quantity: "0", low_stock_threshold: "5" };

interface EditRow {
  id: string;
  name: string;
  price: string;
  cost_price: string;
  quantity: string;
  low_stock_threshold: string;
  category: string;
}

export default function InventoryPage() {
  const { shop } = useAuth();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("All");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<BlankItem>(BLANK);
  const [saving, setSaving] = useState(false);
  const [editRow, setEditRow] = useState<EditRow | null>(null);
  const [toast, setToast] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const load = useCallback(async () => {
    if (!shop) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.from("inventory").select("*").eq("shop_id", shop.id).order("name");
    setItems((data ?? []) as InventoryItem[]);
    setLoading(false);
  }, [shop]);

  useEffect(() => { load(); }, [load]);

  const filtered = items.filter(item => {
    const matchesCat = catFilter === "All" || item.category === catFilter;
    const matchesSearch = !search || item.name.toLowerCase().includes(search.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const lowStock = items.filter(i => i.quantity <= i.low_stock_threshold);
  const totalValue = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const totalCost = items.reduce((s, i) => s + (i.cost_price ?? 0) * i.quantity, 0);

  const addItem = async () => {
    if (!shop || !form.name.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("inventory").insert({
      shop_id: shop.id,
      name: form.name.trim(),
      category: form.category,
      price: parseFloat(form.price) || 0,
      cost_price: parseFloat(form.cost_price) || null,
      quantity: parseInt(form.quantity) || 0,
      low_stock_threshold: parseInt(form.low_stock_threshold) || 5,
    });
    setSaving(false);
    if (error) { showToast("Error adding item"); return; }
    setShowAdd(false);
    setForm(BLANK);
    showToast("Product added!");
    load();
  };

  const saveEdit = async () => {
    if (!editRow) return;
    setSaving(true);
    await supabase.from("inventory").update({
      name: editRow.name,
      price: parseFloat(editRow.price) || 0,
      cost_price: parseFloat(editRow.cost_price) || null,
      quantity: parseInt(editRow.quantity) || 0,
      low_stock_threshold: parseInt(editRow.low_stock_threshold) || 5,
      category: editRow.category,
    }).eq("id", editRow.id);
    setSaving(false);
    setEditRow(null);
    showToast("Product updated!");
    load();
  };

  const adjustQty = async (id: string, delta: number) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const newQty = Math.max(0, item.quantity + delta);
    setItems(prev => prev.map(i => i.id === id ? { ...i, quantity: newQty } : i));
    await supabase.from("inventory").update({ quantity: newQty }).eq("id", id);
  };

  const deleteItem = async (id: string) => {
    await supabase.from("inventory").delete().eq("id", id);
    setDeleteId(null);
    setItems(prev => prev.filter(i => i.id !== id));
    showToast("Product deleted");
  };

  const startEdit = (item: InventoryItem) => {
    setEditRow({
      id: item.id,
      name: item.name,
      price: item.price.toString(),
      cost_price: item.cost_price?.toString() ?? "",
      quantity: item.quantity.toString(),
      low_stock_threshold: item.low_stock_threshold.toString(),
      category: item.category ?? "Other",
    });
  };

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Inventory</h1>
          <p className="text-sm text-[#777] mt-0.5">Manage products and stock levels</p>
        </div>
        <Button onClick={() => setShowAdd(true)}>
          <Plus size={16} /> Add Product
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs text-[#777]">Total Products</p>
          <p className="text-2xl font-bold text-white mt-1">{items.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-[#777]">Retail Value</p>
          <p className="text-2xl font-bold text-black mt-1">{formatCurrency(totalValue)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-[#777]">Cost Value</p>
          <p className="text-2xl font-bold text-white mt-1">{formatCurrency(totalCost)}</p>
        </Card>
        <Card className={cn("p-4", lowStock.length > 0 && "border-red-500/30")}>
          <p className="text-xs text-[#777]">Low Stock</p>
          <div className="flex items-center gap-2 mt-1">
            <p className={cn("text-2xl font-bold", lowStock.length > 0 ? "text-red-400" : "text-white")}>{lowStock.length}</p>
            {lowStock.length > 0 && <AlertTriangle size={16} className="text-red-400" />}
          </div>
        </Card>
      </div>

      {/* Low Stock Alert */}
      {lowStock.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-red-400" />
            <p className="text-sm font-semibold text-red-400">Low Stock Alert ({lowStock.length} items)</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {lowStock.map(item => (
              <span key={item.id} className="bg-red-500/20 border border-red-500/30 rounded-lg px-3 py-1 text-xs text-red-300">
                {item.name} — {item.quantity} left
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search products..."
            className="w-full bg-black shadow-sm border border-[#1e1e1e] rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-[#555] focus:outline-none focus:border-black"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCatFilter(cat)}
              className={cn("px-3 py-1.5 text-xs rounded-lg border font-medium transition-colors",
                catFilter === cat ? "bg-black/10 border-black text-black" : "border-[#1e1e1e] text-[#777] hover:text-white")}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-[#777]">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <Package size={40} className="mx-auto mb-4 text-[#999]" />
              <p className="text-white font-medium">No products found</p>
              <p className="text-sm text-[#777] mt-1">
                {items.length === 0 ? "Add your first product to get started" : "Try adjusting your filters"}
              </p>
              {items.length === 0 && (
                <Button className="mt-4" onClick={() => setShowAdd(true)}>
                  <Plus size={16} /> Add Product
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#1e1e1e]">
                    {["Product", "Category", "Retail", "Cost", "Stock", "Value", "Actions"].map(h => (
                      <th key={h} className="text-left text-xs font-medium text-[#777] px-3 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(item => {
                    const isEditing = editRow?.id === item.id;
                    const isLow = item.quantity <= item.low_stock_threshold;
                    return (
                      <tr key={item.id} className={cn("border-b border-[#1e1e1e]/50 hover:bg-[#141414]/20 transition-colors", isLow && "bg-red-500/5")}>
                        {isEditing ? (
                          <>
                            <td className="px-3 py-2">
                              <input value={editRow.name} onChange={e => setEditRow(p => p && ({ ...p, name: e.target.value }))}
                                className="w-full bg-black border border-gray-400 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none" />
                            </td>
                            <td className="px-3 py-2">
                              <select value={editRow.category} onChange={e => setEditRow(p => p && ({ ...p, category: e.target.value }))}
                                className="bg-black border border-[#1e1e1e] rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none">
                                {CATEGORIES.filter(c => c !== "All").map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <input value={editRow.price} onChange={e => setEditRow(p => p && ({ ...p, price: e.target.value }))} type="number" min="0" step="0.01"
                                className="w-20 bg-black border border-[#1e1e1e] rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none" />
                            </td>
                            <td className="px-3 py-2">
                              <input value={editRow.cost_price} onChange={e => setEditRow(p => p && ({ ...p, cost_price: e.target.value }))} type="number" min="0" step="0.01"
                                className="w-20 bg-black border border-[#1e1e1e] rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none" />
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1">
                                <input value={editRow.quantity} onChange={e => setEditRow(p => p && ({ ...p, quantity: e.target.value }))} type="number" min="0"
                                  className="w-16 bg-black border border-[#1e1e1e] rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none" />
                                <span className="text-xs text-[#777]">/ {editRow.low_stock_threshold}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <span className="text-sm text-[#777]">—</span>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1">
                                <button onClick={saveEdit} className="text-emerald-400 hover:text-emerald-300 transition-colors p-1" title="Save">
                                  <Check size={16} />
                                </button>
                                <button onClick={() => setEditRow(null)} className="text-[#777] hover:text-white transition-colors p-1" title="Cancel">
                                  <X size={16} />
                                </button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-2">
                                {isLow && <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />}
                                <span className="text-sm text-white font-medium">{item.name}</span>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <Badge variant="outline" className="text-xs">{item.category ?? "—"}</Badge>
                            </td>
                            <td className="px-3 py-3 text-sm text-black">{formatCurrency(item.price)}</td>
                            <td className="px-3 py-3 text-sm text-[#777]">{item.cost_price ? formatCurrency(item.cost_price) : "—"}</td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-2">
                                <button onClick={() => adjustQty(item.id, -1)} className="w-6 h-6 rounded-md bg-[#141414] border border-[#1e1e1e] text-white hover:border-red-400/50 hover:text-red-400 flex items-center justify-center text-xs transition-colors">
                                  <TrendingDown size={12} />
                                </button>
                                <span className={cn("text-sm font-bold w-8 text-center", isLow ? "text-red-400" : "text-white")}>
                                  {item.quantity}
                                </span>
                                <button onClick={() => adjustQty(item.id, 1)} className="w-6 h-6 rounded-md bg-[#141414] border border-[#1e1e1e] text-white hover:border-emerald-400/50 hover:text-emerald-400 flex items-center justify-center text-xs transition-colors">
                                  <TrendingUp size={12} />
                                </button>
                                <span className="text-xs text-[#999]">/ {item.low_stock_threshold}</span>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-sm text-[#999]">{formatCurrency(item.price * item.quantity)}</td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-1">
                                <button onClick={() => startEdit(item)} className="text-[#777] hover:text-white transition-colors p-1" title="Edit">
                                  <Pencil size={14} />
                                </button>
                                <button onClick={() => setDeleteId(item.id)} className="text-[#777] hover:text-red-400 transition-colors p-1" title="Delete">
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Product Modal */}
      {showAdd && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setShowAdd(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-black shadow-sm border border-[#1e1e1e] rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Add Product</h2>
                <button onClick={() => setShowAdd(false)} className="text-[#777] hover:text-white text-xl leading-none">✕</button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs text-[#777]">Product Name *</label>
                  <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. American Crew Pomade"
                    className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#555] focus:outline-none focus:border-black" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-[#777]">Category</label>
                  <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                    className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-black">
                    {CATEGORIES.filter(c => c !== "All").map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-[#777]">Retail Price ($)</label>
                  <input value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))} type="number" min="0" step="0.01" placeholder="0.00"
                    className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#555] focus:outline-none focus:border-black" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-[#777]">Cost Price ($)</label>
                  <input value={form.cost_price} onChange={e => setForm(p => ({ ...p, cost_price: e.target.value }))} type="number" min="0" step="0.01" placeholder="0.00"
                    className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#555] focus:outline-none focus:border-black" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-[#777]">Starting Qty</label>
                  <input value={form.quantity} onChange={e => setForm(p => ({ ...p, quantity: e.target.value }))} type="number" min="0" placeholder="0"
                    className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#555] focus:outline-none focus:border-black" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-[#777]">Low Stock Alert At</label>
                  <input value={form.low_stock_threshold} onChange={e => setForm(p => ({ ...p, low_stock_threshold: e.target.value }))} type="number" min="0" placeholder="5"
                    className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#555] focus:outline-none focus:border-black" />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button className="flex-1" loading={saving} disabled={!form.name.trim()} onClick={addItem}>Add Product</Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Delete Confirm */}
      {deleteId && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setDeleteId(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-black shadow-sm border border-[#1e1e1e] rounded-2xl p-6 w-full max-w-sm space-y-4">
              <h2 className="text-lg font-bold text-white">Delete Product?</h2>
              <p className="text-sm text-[#777]">This product will be permanently deleted and removed from your inventory.</p>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setDeleteId(null)}>Cancel</Button>
                <Button variant="danger" className="flex-1" onClick={() => deleteItem(deleteId)}>Delete</Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

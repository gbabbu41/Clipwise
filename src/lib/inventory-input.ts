export function inventoryInput(form: { name: string; category: string; price: string; cost_price: string; quantity: string; low_stock_threshold: string }) {
  const price = Number(form.price || 0);
  const cost_price = form.cost_price === "" ? null : Number(form.cost_price);
  const quantity = Number(form.quantity || 0);
  const low_stock_threshold = Number(form.low_stock_threshold || 0);
  if (!form.name.trim() || ![price, cost_price ?? 0, quantity, low_stock_threshold].every(n => Number.isFinite(n) && n >= 0)
    || !Number.isSafeInteger(quantity) || !Number.isSafeInteger(low_stock_threshold)) throw new Error("Enter a product name, non-negative prices, and whole stock quantities.");
  return { name: form.name.trim(), category: form.category, price, cost_price, quantity, low_stock_threshold };
}

export function requireInventoryWrite(result: { error: unknown; data: unknown[] | null }) {
  if (result.error || result.data?.length !== 1) throw new Error("The product could not be saved. It may have changed elsewhere. Refresh and try again.");
}

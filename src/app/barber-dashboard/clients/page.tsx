"use client";
import { useEffect, useState } from "react";
import { Search, Users, Phone, Calendar } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";

interface ClientRow {
  client_name: string;
  client_phone: string;
  visits: number;
  last_date: string;
  last_service: string;
  total_spent: number;
}

export default function BarberClientsPage() {
  const { accessToken } = useAuth();
  const { barber, shop } = useBarber();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    // Aggregate clients from appointments
    const shopParam = shop?.id ? `?shop_id=${shop.id}` : "";
    fetch(`/api/barber/appointments${shopParam}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => r.json())
      .then(({ appointments }) => {
        const map = new Map<string, ClientRow>();
        for (const a of appointments ?? []) {
          const key = a.client_name;
          const existing = map.get(key);
          if (!existing) {
            map.set(key, {
              client_name: a.client_name,
              client_phone: a.client_phone ?? "",
              visits: 1,
              last_date: a.date,
              last_service: a.services?.name ?? "Service",
              total_spent: a.total_amount ?? 0,
            });
          } else {
            existing.visits += 1;
            existing.total_spent += a.total_amount ?? 0;
            if (a.date > existing.last_date) {
              existing.last_date = a.date;
              existing.last_service = a.services?.name ?? existing.last_service;
            }
          }
        }
        setClients(Array.from(map.values()).sort((a, b) => b.visits - a.visits));
      })
      .finally(() => setLoading(false));
  }, [accessToken, shop?.id]);

  const filtered = clients.filter(c =>
    c.client_name.toLowerCase().includes(query.toLowerCase()) ||
    c.client_phone.includes(query)
  );

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">My Clients</h1>
        <p className="text-gray-500 text-sm mt-0.5">Everyone you've worked with at {barber ? "" : "the shop"}</p>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          placeholder="Search by name or phone..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="w-full bg-surface border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gold/50"
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1,2,3,4].map(i => <div key={i} className="bg-surface border border-border rounded-xl h-16 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-surface border border-border rounded-2xl p-10 text-center">
          <Users size={40} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400">{query ? "No clients match your search" : "No clients yet"}</p>
          <p className="text-xs text-gray-600 mt-1">{query ? "" : "Clients will appear here after appointments"}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((client, i) => (
            <div key={i} className="bg-surface border border-border rounded-xl px-4 py-3 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-gold/15 border border-gold/20 flex items-center justify-center text-gold font-semibold flex-shrink-0">
                {client.client_name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-white">{client.client_name}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  {client.client_phone && (
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                      <Phone size={11} />
                      {client.client_phone}
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-xs text-gray-500">
                    <Calendar size={11} />
                    Last: {client.last_date}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-white">{client.visits} visit{client.visits !== 1 ? "s" : ""}</p>
                <p className="text-xs text-gray-500">{client.last_service}</p>
              </div>
              <div className="text-right min-w-[60px]">
                <p className="text-sm font-medium text-gold">${client.total_spent.toFixed(0)}</p>
                <p className="text-xs text-gray-600">total</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn, friendlyDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Send, Search, MessageSquare, Plus, X, Phone } from "lucide-react";
import type { Message, Client } from "@/lib/database.types";

interface Thread {
  clientName: string;
  clientPhone?: string;
  clientId?: string;
  lastMessage: string;
  lastAt: string;
  unread: number;
  messages: Message[];
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-card-raised border border-border rounded-xl px-5 py-3 text-sm text-foreground shadow-xl flex items-center gap-3">
      <span className="text-foreground">✓</span>{message}
      <button onClick={onClose} className="text-grey hover:text-foreground ml-2">✕</button>
    </div>
  );
}

export default function MessagesPage() {
  const { shop, accessToken } = useAuth();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCompose, setShowCompose] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [composeClient, setComposeClient] = useState<Client | null>(null);
  /** Search box for the compose-modal picker (separate from the thread-list
   *  search above so they don't fight each other). */
  const [composeSearch, setComposeSearch] = useState("");
  const [composeMsg, setComposeMsg] = useState("");
  const [toast, setToast] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const buildThreads = useCallback((msgs: Message[]): Thread[] => {
    const map: Record<string, Thread> = {};
    for (const m of msgs) {
      const key = m.client_id ?? m.client_name;
      if (!map[key]) {
        map[key] = {
          clientName: m.client_name,
          clientPhone: m.client_phone,
          clientId: m.client_id,
          lastMessage: m.content,
          lastAt: m.created_at,
          unread: 0,
          messages: [],
        };
      }
      map[key].messages.push(m);
      if (m.created_at > map[key].lastAt) {
        map[key].lastMessage = m.content;
        map[key].lastAt = m.created_at;
      }
      if (m.sender === "client" && !m.is_read) map[key].unread++;
    }
    return Object.values(map).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }, []);

  const loadMessages = useCallback(async () => {
    if (!shop) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("shop_id", shop.id)
      .order("created_at", { ascending: true });
    const built = buildThreads((data ?? []) as Message[]);
    setThreads(built);
    setLoading(false);
  }, [shop, buildThreads]);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  // Realtime subscription
  useEffect(() => {
    if (!shop) return;
    const channel = supabase
      .channel(`messages:${shop.id}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `shop_id=eq.${shop.id}`,
      }, () => { loadMessages(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [shop, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeThread?.messages.length]);

  // Keep active thread in sync after reload
  useEffect(() => {
    if (!activeThread) return;
    const key = activeThread.clientId ?? activeThread.clientName;
    const updated = threads.find(t => (t.clientId ?? t.clientName) === key);
    if (updated) setActiveThread(updated);
  }, [threads]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Fire the outbound notifications for a message we just inserted. Email
   *  + SMS. The clients table is the source of truth for email/phone; we
   *  look up by id when we have one, falling back to name+shop. Both
   *  channels are fire-and-forget — a missing address/phone just means the
   *  message is in-app for that channel, not an error.
   *
   *  The reply-flow only has `clientPhone` from the active thread (which
   *  may itself be missing), so we always re-fetch from `clients` to get
   *  the most up-to-date contact info. */
  const sendNotifications = async (clientId: string | undefined, clientName: string, content: string) => {
    if (!shop) return;
    let clientEmail: string | null = null;
    let clientPhone: string | null = null;
    if (clientId) {
      const { data } = await supabase.from("clients").select("email, phone").eq("id", clientId).maybeSingle();
      clientEmail = data?.email ?? null;
      clientPhone = data?.phone ?? null;
    } else {
      const { data } = await supabase.from("clients").select("email, phone").eq("shop_id", shop.id).eq("name", clientName).maybeSingle();
      clientEmail = data?.email ?? null;
      clientPhone = data?.phone ?? null;
    }
    if (clientEmail) {
      fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken ?? ""}` },
        body: JSON.stringify({
          type: "direct_message",
          data: {
            clientName,
            clientEmail,
            shopName: shop.name,
            shopEmail: shop.email ?? "",
            content,
          },
        }),
      }).catch(() => null);
    }
    if (clientPhone) {
      fetch("/api/twilio/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken ?? ""}` },
        body: JSON.stringify({
          to: clientPhone,
          shop_id: shop.id,
          body: content,
          shopName: shop.name,
        }),
      }).catch(() => null);
    }
  };

  const sendMessage = async () => {
    if (!shop || !activeThread || !input.trim()) return;
    setSending(true);
    const trimmed = input.trim();
    const { error } = await supabase.from("messages").insert({
      shop_id: shop.id,
      client_id: activeThread.clientId ?? null,
      client_name: activeThread.clientName,
      client_phone: activeThread.clientPhone ?? null,
      sender: "shop",
      content: trimmed,
      is_read: true,
    });
    if (!error) {
      sendNotifications(activeThread.clientId, activeThread.clientName, trimmed);
      setInput("");
      await loadMessages();
    }
    setSending(false);
  };

  const markRead = async (thread: Thread) => {
    if (!shop || thread.unread === 0) return;
    await supabase
      .from("messages")
      .update({ is_read: true })
      .eq("shop_id", shop.id)
      .eq("client_name", thread.clientName)
      .eq("sender", "client")
      .eq("is_read", false);
    await loadMessages();
  };

  const openThread = (thread: Thread) => {
    setActiveThread(thread);
    markRead(thread);
  };

  /** Build the compose picker's contact list from BOTH the `clients` table
   *  (people the owner explicitly added or who've had a completed
   *  appointment) AND distinct customers from the `appointments` table.
   *  The booking flow doesn't write to `clients`, so a shop with hundreds
   *  of bookings can have an empty `clients` table — that was the cause
   *  of the "no clients found" bug. Dedupe by email → phone → name. */
  const loadClients = async () => {
    if (!shop) return;
    setLoadingClients(true);
    const [{ data: clientRows }, { data: apptRows }] = await Promise.all([
      supabase.from("clients").select("*").eq("shop_id", shop.id).order("name"),
      supabase
        .from("appointments")
        .select("client_name, client_email, client_phone, date")
        .eq("shop_id", shop.id)
        .order("date", { ascending: false }),
    ]);

    const keyOf = (c: { id?: string; email?: string | null; phone?: string | null; name?: string | null }) =>
      (c.email && `e:${c.email.toLowerCase()}`)
      || (c.phone && `p:${c.phone.replace(/\D/g, "")}`)
      || (c.name && `n:${c.name.toLowerCase()}`)
      || (c.id ?? "");

    const merged = new Map<string, Client>();
    for (const row of (clientRows ?? []) as Client[]) {
      merged.set(keyOf(row), row);
    }
    for (const a of (apptRows ?? []) as { client_name: string; client_email?: string | null; client_phone?: string | null }[]) {
      if (!a.client_name) continue;
      const k = keyOf({ name: a.client_name, email: a.client_email, phone: a.client_phone });
      if (merged.has(k)) continue;
      // Synthesize a minimal Client so the picker can render and the send
      // flow has email/phone. The synthetic id is the dedupe key — it never
      // hits the DB; the message insert just uses `client_id: null`.
      merged.set(k, {
        id: `synthetic:${k}`,
        shop_id: shop.id,
        name: a.client_name,
        email: a.client_email ?? undefined,
        phone: a.client_phone ?? undefined,
      } as unknown as Client);
    }

    setClients(Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name)));
    setLoadingClients(false);
  };

  const startCompose = () => {
    setShowCompose(true);
    setComposeClient(null);
    setComposeMsg("");
    setComposeSearch("");
    loadClients();
  };

  const sendCompose = async () => {
    if (!shop || !composeClient || !composeMsg.trim()) return;
    setSending(true);
    const trimmed = composeMsg.trim();
    // Synthetic clients (built from appointments) have no row in the
    // `clients` table — skip the FK by storing null instead of the fake id.
    const realClientId = composeClient.id.startsWith("synthetic:") ? null : composeClient.id;
    const { error } = await supabase.from("messages").insert({
      shop_id: shop.id,
      client_id: realClientId,
      client_name: composeClient.name,
      client_phone: composeClient.phone ?? null,
      sender: "shop",
      content: trimmed,
      is_read: true,
    });
    if (!error) {
      // We already have the client's email/phone here — fire both channels
      // directly instead of round-tripping through the clients lookup.
      if (composeClient.email) {
        fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken ?? ""}` },
          body: JSON.stringify({
            type: "direct_message",
            data: {
              clientName: composeClient.name,
              clientEmail: composeClient.email,
              shopName: shop.name,
              shopEmail: shop.email ?? "",
              content: trimmed,
            },
          }),
        }).catch(() => null);
      }
      if (composeClient.phone) {
        fetch("/api/twilio/send-sms", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken ?? ""}` },
          body: JSON.stringify({
            to: composeClient.phone,
            shop_id: shop.id,
            body: trimmed,
            shopName: shop.name,
          }),
        }).catch(() => null);
      }
      // Build a readable channel summary for the toast
      const channels: string[] = [];
      if (composeClient.email) channels.push("email");
      if (composeClient.phone) channels.push("SMS");
      showToast(
        channels.length
          ? `Message sent to ${composeClient.name} · ${channels.join(" + ")}`
          : `Message sent to ${composeClient.name} · No email or phone on file`
      );
      setShowCompose(false);
      await loadMessages();
      const updated = threads.find(t => t.clientId === realClientId || t.clientName === composeClient.name);
      if (updated) setActiveThread(updated);
    }
    setSending(false);
  };

  const filteredThreads = search.trim()
    ? threads.filter(t => t.clientName.toLowerCase().includes(search.toLowerCase()))
    : threads;

  const totalUnread = threads.reduce((s, t) => s + t.unread, 0);

  if (!shop) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <MessageSquare size={40} className="text-grey mb-4" />
        <h2 className="text-lg font-bold text-foreground mb-1">No shop linked</h2>
        <p className="text-sm text-grey">Messages will appear here once your shop is active.</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      {/* Thread List */}
      <div className={cn("flex flex-col border-r border-border bg-card shadow-sm", activeThread ? "hidden lg:flex w-80 flex-shrink-0" : "flex-1 lg:w-80 lg:flex-none")}>
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
              Messages
              {totalUnread > 0 && (
                <span className="bg-gold text-black text-xs font-bold rounded-full px-2 py-0.5">{totalUnread}</span>
              )}
            </h1>
            <p className="text-xs text-grey">{threads.length} conversation{threads.length !== 1 ? "s" : ""}</p>
          </div>
          <Button size="sm" onClick={startCompose}>
            <Plus size={14} /> New
          </Button>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-border">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-grey" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search conversations..."
              className="w-full bg-card-raised border border-border rounded-xl pl-8 pr-3 py-2 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-black"
            />
          </div>
        </div>

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse bg-card-raised rounded-xl" />
              ))}
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-6">
              <MessageSquare size={36} className="text-grey mb-3" />
              <p className="text-sm font-medium text-foreground mb-1">{search ? "No conversations match" : "No messages yet"}</p>
              <p className="text-xs text-grey mb-4">{search ? "Try a different search term" : "Send your first message to a client to get started"}</p>
              {!search && (
                <Button size="sm" variant="outline" onClick={startCompose}>
                  <Plus size={14} /> Send First Message
                </Button>
              )}
            </div>
          ) : (
            filteredThreads.map(thread => {
              const key = thread.clientId ?? thread.clientName;
              const isActive = (activeThread?.clientId ?? activeThread?.clientName) === key;
              return (
                <button
                  key={key}
                  onClick={() => openThread(thread)}
                  className={cn(
                    "w-full text-left px-4 py-3.5 border-b border-[#2a2a2a]/50 hover:bg-card-raised/50 transition-colors",
                    isActive && "bg-card-raised border-l-2 border-l-gold"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-black/10 flex items-center justify-center text-foreground font-bold text-sm flex-shrink-0">
                      {thread.clientName?.[0]?.toUpperCase() ?? "?"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className={cn("text-sm font-semibold truncate", thread.unread > 0 ? "text-foreground" : "text-grey")}>
                          {thread.clientName}
                        </p>
                        <span className="text-xs text-grey flex-shrink-0">
                          {friendlyDate(new Date(thread.lastAt))}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <p className="text-xs text-grey truncate">{thread.lastMessage}</p>
                        {thread.unread > 0 && (
                          <span className="bg-gold text-black text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
                            {thread.unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Chat Panel */}
      {activeThread ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Chat header */}
          <div className="px-4 py-3.5 border-b border-border flex items-center gap-3 bg-card shadow-sm">
            <button onClick={() => setActiveThread(null)} className="lg:hidden text-grey hover:text-foreground">
              ←
            </button>
            <div className="w-9 h-9 rounded-full bg-black/10 flex items-center justify-center text-foreground font-bold text-sm flex-shrink-0">
              {activeThread.clientName?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground">{activeThread.clientName}</p>
              {activeThread.clientPhone && (
                <p className="text-xs text-grey flex items-center gap-1">
                  <Phone size={10} />{activeThread.clientPhone}
                </p>
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {activeThread.messages.map(msg => (
              <div key={msg.id} className={cn("flex", msg.sender === "shop" ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm",
                  msg.sender === "shop"
                    ? "bg-gold text-black rounded-br-sm"
                    : "bg-card-raised border border-border text-foreground rounded-bl-sm"
                )}>
                  <p className="leading-relaxed">{msg.content}</p>
                  <p className={cn("text-xs mt-1", msg.sender === "shop" ? "text-white/60" : "text-grey")}>
                    {new Date(msg.created_at).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t border-border bg-card shadow-sm">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder={`Message ${activeThread.clientName}…`}
                className="flex-1 bg-card-raised border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-black"
              />
              <Button size="sm" loading={sending} onClick={sendMessage} disabled={!input.trim()}>
                <Send size={16} />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="hidden lg:flex flex-1 items-center justify-center text-center p-8">
          <div>
            <MessageSquare size={48} className="text-grey mx-auto mb-4" />
            <p className="text-lg font-semibold text-foreground mb-2">Select a conversation</p>
            <p className="text-sm text-grey mb-6">Choose a thread from the left or start a new message</p>
            <Button variant="outline" onClick={startCompose}>
              <Plus size={15} /> New Message
            </Button>
          </div>
        </div>
      )}

      {/* Compose Modal */}
      {showCompose && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setShowCompose(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-card shadow-sm border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">New Message</h2>
                <button onClick={() => setShowCompose(false)} className="text-grey hover:text-foreground">
                  <X size={18} />
                </button>
              </div>

              <div>
                <p className="text-sm font-medium text-grey mb-2">To</p>
                {composeClient ? (
                  <div className="flex items-center gap-2 p-3 bg-card-raised border border-black rounded-xl">
                    <div className="w-8 h-8 rounded-full bg-black/10 flex items-center justify-center text-foreground font-bold text-sm">
                      {composeClient.name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground font-medium truncate">{composeClient.name}</p>
                      {composeClient.email && <p className="text-xs text-grey truncate">{composeClient.email}</p>}
                      {composeClient.phone && <p className="text-xs text-grey truncate">{composeClient.phone}</p>}
                    </div>
                    <button onClick={() => setComposeClient(null)} className="text-grey hover:text-foreground">
                      <X size={14} />
                    </button>
                  </div>
                ) : (() => {
                  const q = composeSearch.trim().toLowerCase();
                  const filtered = !q ? clients : clients.filter(c =>
                    c.name.toLowerCase().includes(q) ||
                    (c.email?.toLowerCase().includes(q) ?? false) ||
                    (c.phone?.toLowerCase().includes(q) ?? false)
                  );
                  return (
                    <div className="space-y-2">
                      <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-grey" />
                        <input
                          autoFocus
                          value={composeSearch}
                          onChange={e => setComposeSearch(e.target.value)}
                          placeholder="Search by name, phone, or email…"
                          className="w-full bg-card-raised border border-border rounded-xl pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-white"
                        />
                      </div>
                      <div className="max-h-56 overflow-y-auto border border-border rounded-xl divide-y divide-border/50">
                        {loadingClients ? (
                          <p className="p-4 text-sm text-grey text-center">Loading clients…</p>
                        ) : clients.length === 0 ? (
                          <p className="p-4 text-sm text-grey text-center">No clients yet — they&apos;ll appear here after their first booking.</p>
                        ) : filtered.length === 0 ? (
                          <p className="p-4 text-sm text-grey text-center">No matches for &ldquo;{composeSearch}&rdquo;</p>
                        ) : filtered.map(c => (
                          <button
                            key={c.id}
                            onClick={() => setComposeClient(c)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-card-raised text-left transition-colors"
                          >
                            <div className="w-7 h-7 rounded-full bg-black/10 flex items-center justify-center text-foreground font-bold text-xs flex-shrink-0">
                              {c.name[0]}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-foreground truncate">{c.name}</p>
                              {c.email && <p className="text-xs text-grey truncate">{c.email}</p>}
                              {c.phone && <p className="text-xs text-grey truncate">{c.phone}</p>}
                              {!c.email && !c.phone && <p className="text-xs text-grey truncate italic">No contact info</p>}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {composeClient && (
                <div>
                  <p className="text-sm font-medium text-grey mb-2">Message</p>
                  <textarea
                    value={composeMsg}
                    onChange={e => setComposeMsg(e.target.value)}
                    rows={3}
                    placeholder="Type your message..."
                    className="w-full bg-card-raised border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-black resize-none"
                  />
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowCompose(false)}>Cancel</Button>
                <Button
                  className="flex-1"
                  loading={sending}
                  disabled={!composeClient || !composeMsg.trim()}
                  onClick={sendCompose}
                >
                  <Send size={14} /> Send
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

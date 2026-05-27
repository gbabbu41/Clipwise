"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
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
    <div className="fixed bottom-6 right-6 z-[100] bg-surface-raised border border-border rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-gold">✓</span>{message}
      <button onClick={onClose} className="text-gray-400 hover:text-white ml-2">✕</button>
    </div>
  );
}

export default function MessagesPage() {
  const { shop } = useAuth();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCompose, setShowCompose] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [composeClient, setComposeClient] = useState<Client | null>(null);
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

  const sendMessage = async () => {
    if (!shop || !activeThread || !input.trim()) return;
    setSending(true);
    const { error } = await supabase.from("messages").insert({
      shop_id: shop.id,
      client_id: activeThread.clientId ?? null,
      client_name: activeThread.clientName,
      client_phone: activeThread.clientPhone ?? null,
      sender: "shop",
      content: input.trim(),
      is_read: true,
    });
    if (!error) {
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

  const loadClients = async () => {
    if (!shop) return;
    const { data } = await supabase.from("clients").select("*").eq("shop_id", shop.id).order("name");
    setClients((data ?? []) as Client[]);
  };

  const startCompose = () => {
    loadClients();
    setShowCompose(true);
    setComposeClient(null);
    setComposeMsg("");
  };

  const sendCompose = async () => {
    if (!shop || !composeClient || !composeMsg.trim()) return;
    setSending(true);
    const { error } = await supabase.from("messages").insert({
      shop_id: shop.id,
      client_id: composeClient.id,
      client_name: composeClient.name,
      client_phone: composeClient.phone ?? null,
      sender: "shop",
      content: composeMsg.trim(),
      is_read: true,
    });
    if (!error) {
      showToast(`Message sent to ${composeClient.name}`);
      setShowCompose(false);
      await loadMessages();
      const updated = threads.find(t => t.clientId === composeClient.id || t.clientName === composeClient.name);
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
        <MessageSquare size={40} className="text-gray-600 mb-4" />
        <h2 className="text-lg font-bold text-white mb-1">No shop linked</h2>
        <p className="text-sm text-gray-400">Messages will appear here once your shop is active.</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      {/* Thread List */}
      <div className={cn("flex flex-col border-r border-border bg-surface", activeThread ? "hidden lg:flex w-80 flex-shrink-0" : "flex-1 lg:w-80 lg:flex-none")}>
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
              Messages
              {totalUnread > 0 && (
                <span className="bg-gold text-black text-xs font-bold rounded-full px-2 py-0.5">{totalUnread}</span>
              )}
            </h1>
            <p className="text-xs text-gray-500">{threads.length} conversation{threads.length !== 1 ? "s" : ""}</p>
          </div>
          <Button size="sm" onClick={startCompose}>
            <Plus size={14} /> New
          </Button>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-border">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search conversations..."
              className="w-full bg-surface-raised border border-border rounded-xl pl-8 pr-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-gold/50"
            />
          </div>
        </div>

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse bg-surface-raised rounded-xl" />
              ))}
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-6">
              <MessageSquare size={36} className="text-gray-600 mb-3" />
              <p className="text-sm font-medium text-white mb-1">No conversations yet</p>
              <p className="text-xs text-gray-500 mb-4">Start a conversation with a client</p>
              <Button size="sm" variant="outline" onClick={startCompose}>
                <Plus size={14} /> New Message
              </Button>
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
                    "w-full text-left px-4 py-3.5 border-b border-border/50 hover:bg-surface-raised/50 transition-colors",
                    isActive && "bg-surface-raised border-l-2 border-l-gold"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-gold/20 flex items-center justify-center text-gold font-bold text-sm flex-shrink-0">
                      {thread.clientName[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className={cn("text-sm font-semibold truncate", thread.unread > 0 ? "text-white" : "text-gray-300")}>
                          {thread.clientName}
                        </p>
                        <span className="text-xs text-gray-500 flex-shrink-0">
                          {new Date(thread.lastAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <p className="text-xs text-gray-500 truncate">{thread.lastMessage}</p>
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
          <div className="px-4 py-3.5 border-b border-border flex items-center gap-3 bg-surface">
            <button onClick={() => setActiveThread(null)} className="lg:hidden text-gray-400 hover:text-white">
              ←
            </button>
            <div className="w-9 h-9 rounded-full bg-gold/20 flex items-center justify-center text-gold font-bold text-sm flex-shrink-0">
              {activeThread.clientName[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white">{activeThread.clientName}</p>
              {activeThread.clientPhone && (
                <p className="text-xs text-gray-500 flex items-center gap-1">
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
                    : "bg-surface-raised border border-border text-white rounded-bl-sm"
                )}>
                  <p className="leading-relaxed">{msg.content}</p>
                  <p className={cn("text-xs mt-1", msg.sender === "shop" ? "text-black/60" : "text-gray-500")}>
                    {new Date(msg.created_at).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t border-border bg-surface">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder={`Message ${activeThread.clientName}…`}
                className="flex-1 bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-gold/50"
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
            <MessageSquare size={48} className="text-gray-700 mx-auto mb-4" />
            <p className="text-lg font-semibold text-white mb-2">Select a conversation</p>
            <p className="text-sm text-gray-500 mb-6">Choose a thread from the left or start a new message</p>
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">New Message</h2>
                <button onClick={() => setShowCompose(false)} className="text-gray-400 hover:text-white">
                  <X size={18} />
                </button>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-300 mb-2">To</p>
                {composeClient ? (
                  <div className="flex items-center gap-2 p-3 bg-surface-raised border border-gold/30 rounded-xl">
                    <div className="w-8 h-8 rounded-full bg-gold/20 flex items-center justify-center text-gold font-bold text-sm">
                      {composeClient.name[0]}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-white font-medium">{composeClient.name}</p>
                      {composeClient.phone && <p className="text-xs text-gray-500">{composeClient.phone}</p>}
                    </div>
                    <button onClick={() => setComposeClient(null)} className="text-gray-400 hover:text-white">
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="max-h-48 overflow-y-auto border border-border rounded-xl divide-y divide-border/50">
                    {clients.length === 0 ? (
                      <p className="p-4 text-sm text-gray-500 text-center">No clients found</p>
                    ) : clients.map(c => (
                      <button
                        key={c.id}
                        onClick={() => setComposeClient(c)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surface-raised text-left transition-colors"
                      >
                        <div className="w-7 h-7 rounded-full bg-gold/20 flex items-center justify-center text-gold font-bold text-xs flex-shrink-0">
                          {c.name[0]}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm text-white truncate">{c.name}</p>
                          {c.phone && <p className="text-xs text-gray-500">{c.phone}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {composeClient && (
                <div>
                  <p className="text-sm font-medium text-gray-300 mb-2">Message</p>
                  <textarea
                    value={composeMsg}
                    onChange={e => setComposeMsg(e.target.value)}
                    rows={3}
                    placeholder="Type your message..."
                    className="w-full bg-surface-raised border border-border rounded-xl px-4 py-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-gold/50 resize-none"
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

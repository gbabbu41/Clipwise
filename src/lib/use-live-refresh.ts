"use client";
import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Gmail-style live updates: subscribe to row changes on the given tables and call
 * `onChange` (debounced, so a burst of changes = one refresh). Pages refresh by
 * re-reading their data in the background — never patching rows client-side —
 * so a live update can't duplicate a row or double-count money. Pass `name: null`
 * to stay unsubscribed (e.g. before the shop is known).
 */
export function useLiveRefresh(
  name: string | null,
  tables: { table: string; filter: string }[],
  onChange: () => void,
  delayMs = 800,
) {
  const latest = useRef(onChange);
  latest.current = onChange;
  const spec = JSON.stringify(tables);
  useEffect(() => {
    if (!name) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fire = () => { clearTimeout(timer); timer = setTimeout(() => latest.current(), delayMs); };
    let ch = supabase.channel(`live:${name}`);
    for (const { table, filter } of JSON.parse(spec) as { table: string; filter: string }[]) {
      ch = ch.on("postgres_changes", { event: "*", schema: "public", table, filter }, fire);
    }
    ch.subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(ch); };
  }, [name, spec, delayMs]);
}

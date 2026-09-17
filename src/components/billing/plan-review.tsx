"use client";

import { useEffect, useRef, useId, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

// A separate review step: opening it never changes a plan. Native dialog keeps
// keyboard focus inside and restores focus on dismissal. No global Enter handler.
export function PlanReview({ title, children, confirmLabel, busy = false, onConfirm, onCancel }: {
  title: string; children: ReactNode; confirmLabel: string; busy?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} aria-labelledby={titleId}
    style={{ width: "calc(100% - 32px)" }} className="m-auto max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl border border-border bg-card p-6 text-foreground shadow-2xl backdrop:bg-black/70"
    onCancel={e => { if (busy) e.preventDefault(); else onCancel(); }}>
    <h2 id={titleId} className="text-xl font-bold">{title}</h2>
    <div className="my-5 space-y-4 text-sm text-grey leading-relaxed">{children}</div>
    <div className="flex flex-col gap-2">
      <Button loading={busy} disabled={busy} onClick={onConfirm}>{confirmLabel}</Button>
      <Button autoFocus variant="outline" disabled={busy} onClick={onCancel}>Go back</Button>
    </div>
  </dialog>;
}

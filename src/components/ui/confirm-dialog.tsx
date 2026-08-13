"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * In-app confirm / prompt dialogs — a drop-in replacement for the native
 * window.confirm() / window.prompt() browser pop-ups, which look out of place in
 * the installed (standalone) app and can't be styled or kept on-brand.
 *
 * Usage: mount <ConfirmProvider> once per portal layout, then in any child:
 *   const { confirm, prompt } = useConfirm();
 *   if (!(await confirm({ message: "Delete this?", tone: "danger" }))) return;
 *   const email = await prompt({ message: "Send to which email?", type: "email" });
 *
 * The dialog reuses the app's standard modal markup (centered backdrop + card),
 * so ModalChrome's scroll-lock and the global mobile-responsive/safe-area rules
 * apply automatically — it never leaks under the notch or off-screen.
 */

type ConfirmOpts = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: "default" | "danger";
};
type PromptOpts = {
  title?: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  type?: string;
};

type ConfirmCtx = {
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  prompt: (opts: PromptOpts) => Promise<string | null>;
};

const Ctx = createContext<ConfirmCtx | null>(null);

export function useConfirm(): ConfirmCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConfirm must be used inside a <ConfirmProvider>");
  return ctx;
}

type DialogState =
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOpts; resolve: (v: string | null) => void }
  | null;

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState>(null);
  const [value, setValue] = useState("");

  const confirm = useCallback(
    (opts: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ kind: "confirm", opts, resolve })),
    [],
  );
  const prompt = useCallback(
    (opts: PromptOpts) =>
      new Promise<string | null>((resolve) => {
        setValue(opts.defaultValue ?? "");
        setState({ kind: "prompt", opts, resolve });
      }),
    [],
  );

  const finish = useCallback((result: boolean | string | null) => {
    setState((s) => {
      if (s) (s.resolve as (v: boolean | string | null) => void)(result);
      return null;
    });
  }, []);

  // Esc / Enter keyboard support.
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(state.kind === "prompt" ? null : false);
      else if (e.key === "Enter") finish(state.kind === "prompt" ? value : true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, value, finish]);

  const onCancel = () => finish(state?.kind === "prompt" ? null : false);
  const onConfirm = () => finish(state?.kind === "prompt" ? value : true);

  return (
    <Ctx.Provider value={{ confirm, prompt }}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={onCancel}
        >
          <div
            className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {state.opts.title && <h3 className="text-lg font-bold text-foreground">{state.opts.title}</h3>}

            {state.kind === "confirm" ? (
              <p className="text-sm text-grey leading-relaxed">{state.opts.message}</p>
            ) : (
              <>
                {state.opts.message && <p className="text-sm text-grey leading-relaxed">{state.opts.message}</p>}
                {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                <input
                  autoFocus
                  type={state.opts.type ?? "text"}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={state.opts.placeholder}
                  className="w-full bg-surface border border-border rounded-xl px-4 py-2.5 text-[15px] text-foreground placeholder:text-grey focus:outline-none focus:border-grey"
                />
              </>
            )}

            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-foreground bg-surface hover:bg-surface-raised transition-colors"
              >
                {state.opts.cancelText ?? "Cancel"}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className={cn(
                  "px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors",
                  state.kind === "confirm" && state.opts.tone === "danger"
                    ? "bg-red-500 text-white hover:bg-red-600"
                    : "bg-white text-black hover:bg-white/90",
                )}
              >
                {state.opts.confirmText ?? (state.kind === "prompt" ? "Send" : "Confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

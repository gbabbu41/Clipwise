import * as React from "react";
import { cn } from "@/lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Legacy prop — kept for back-compat with existing callsites. No-op now. */
  gold?: boolean;
  /** When true, the card renders without padding so callers can place
   *  `.card-header` / `.card-body` / `.card-footer` children manually. */
  flush?: boolean;
}

// Bootstrap-style card. `<Card>` defaults to a single-section card with
// internal `.card-body` padding so existing callsites (which just dump
// content directly inside) keep their spacing. Set `flush` when you want
// to compose multiple sections (header / body / footer) yourself.
export function Card({ className, gold: _gold, flush, ...props }: CardProps) {
  return (
    <div className={cn("card", !flush && "card-body", className)} {...props} />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card-header flex items-center justify-between", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("card-title", className)} {...props} />;
}

export function CardSubtitle({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("card-subtitle", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card-text", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card-footer", className)} {...props} />;
}

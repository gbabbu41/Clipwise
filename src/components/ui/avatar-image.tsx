"use client";
import { useState, useEffect, type ReactNode } from "react";

/**
 * Renders an <img> that falls back to `fallback` when the src is missing OR the
 * image fails to load (broken URL / 403). The plain ternary pattern used across
 * the app only handled a null src, so a dead URL showed a broken-image icon.
 */
export function AvatarImage({
  src, alt, className, fallback,
}: {
  src?: string | null;
  alt: string;
  className?: string;
  fallback: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  if (!src || failed) return <>{fallback}</>;
  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}

"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";

// The hero film section — a client island (autoplay video + ultrawide blurred
// pillarbox fill + replay). Lifted from the designed page's inline script. All
// motion is guarded so a failure never blanks the hero (poster still shows).
export function HeroFilm() {
  const filmRef = useRef<HTMLVideoElement>(null);
  const bgRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = filmRef.current, bg = bgRef.current;
    if (!v || !bg) return;
    const wide = window.matchMedia("(min-aspect-ratio: 16/9)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let iv: ReturnType<typeof setInterval> | undefined;

    const sync = () => {
      if (!bg.src || bg.readyState < 2 || v.readyState < 2) return;
      if (Math.abs(bg.currentTime - v.currentTime) > 0.25) bg.currentTime = v.currentTime;
    };
    const arm = () => {
      if (!wide.matches || bg.src) return;
      bg.src = "/new/hero-film.mp4";
      bg.play().catch(() => {});
    };

    if (!reduce.matches) {
      v.src = "/new/hero-film.mp4";
      v.play().catch(() => {});
      v.addEventListener("loadeddata", arm);
      wide.addEventListener?.("change", arm);
      iv = setInterval(sync, 1000);
    }
    return () => {
      if (iv) clearInterval(iv);
      v.removeEventListener("loadeddata", arm);
      wide.removeEventListener?.("change", arm);
    };
  }, []);

  const replay = () => {
    const v = filmRef.current, bg = bgRef.current;
    if (!v) return;
    if (!v.src) v.src = "/new/hero-film.mp4";
    v.currentTime = 0;
    v.play().catch(() => {});
    if (bg?.src) { bg.currentTime = 0; bg.play().catch(() => {}); }
  };

  return (
    <section className="stage">
      <video ref={bgRef} className="filmbg" muted loop playsInline preload="none" aria-hidden tabIndex={-1} />
      <video ref={filmRef} className="film" autoPlay muted loop playsInline preload="auto" poster="/new/poster.jpg" aria-label="ClipWise" />
      <div className="scrim" /><div className="grain" />
      <div className="bar t" /><div className="bar b" />
      <div className="foot">
        <div className="cta">
          <Link className="pill w" href="/signup">Get started free</Link>
          <a className="pill g" href="#day">See the product</a>
        </div>
        <p className="micro">No credit card · 60-second setup · Interac at 15¢ flat</p>
      </div>
      <button className="ctl" onClick={replay} title="Replay" aria-label="Replay video">↻</button>
    </section>
  );
}

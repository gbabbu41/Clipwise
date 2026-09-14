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
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let iv: ReturnType<typeof setInterval> | undefined;

    const sync = () => {
      if (!bg.src || bg.readyState < 2 || v.readyState < 2) return;
      if (Math.abs(bg.currentTime - v.currentTime) > 0.25) bg.currentTime = v.currentTime;
    };
    // Arm the blurred backdrop unconditionally (not gated to ultrawide) so it
    // fills any letterbox gap on every screen instead of leaving pure black.
    const arm = () => {
      if (bg.src) return;
      bg.src = "/new/hero-film.mp4";
      bg.play().catch(() => {});
    };

    if (!reduce.matches) {
      v.src = "/new/hero-film.mp4";
      v.play().catch(() => {});
      v.addEventListener("loadeddata", arm);
      iv = setInterval(sync, 1000);
    }
    return () => {
      if (iv) clearInterval(iv);
      v.removeEventListener("loadeddata", arm);
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

  // Tap the film to play/pause — the fallback when iOS blocks autoplay (e.g. Low
  // Power Mode), so a visitor isn't stuck on a still poster.
  const toggle = () => {
    const v = filmRef.current;
    if (!v) return;
    if (!v.src) v.src = "/new/hero-film.mp4";
    if (v.paused) v.play().catch(() => {}); else v.pause();
  };

  return (
    <section className="stage">
      <div className="filmwrap" onClick={toggle}>
        <video ref={bgRef} className="filmbg" muted loop playsInline preload="none" aria-hidden tabIndex={-1} />
        <video ref={filmRef} className="film" autoPlay muted loop playsInline preload="auto" poster="/new/poster.jpg" aria-label="ClipWise" />
        <div className="scrim" /><div className="grain" />
        <div className="bar t" /><div className="bar b" />
        <button className="ctl" onClick={(e) => { e.stopPropagation(); replay(); }} title="Replay" aria-label="Replay video">↻</button>
      </div>
      <div className="foot">
        <div className="cta">
          <Link className="pill w" href="/signup">Get started free</Link>
          <a className="pill g" href="#day">See the product</a>
        </div>
        <p className="micro">No credit card · 60-second setup · Interac at 15¢ flat</p>
      </div>

      {/* Mobile text hero — replaces the video on phones (no autoplay/native-control
          issues). Darkened barbershop still behind real, legible copy. */}
      <div className="hero-m">
        <img className="hero-m-bg" src="/new/atmo-shop.jpg" alt="" />
        <div className="hero-m-veil" /><div className="grain" />
        <div className="hero-m-in">
          <p className="eyebrow">Built for Canadian barbers</p>
          <p className="hero-m-h">Smart software for your barbershop.</p>
          <p className="lead">Online booking, in-person payments, payroll and no-show protection — all in one app.</p>
          <div className="cta">
            <Link className="pill w" href="/signup">Get started free</Link>
            <a className="pill g" href="#day">See the product</a>
          </div>
          <p className="micro">No credit card · 60-second setup · Interac at 15¢ flat</p>
        </div>
      </div>
    </section>
  );
}

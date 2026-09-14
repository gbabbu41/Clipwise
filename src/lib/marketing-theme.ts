// The public marketing theme (the "new" black/emerald look), lifted verbatim from
// the designed landing page and SCOPED under `.mkt` so it can never leak into the
// dashboard / barber / admin portals (which keep their own look). Any public
// marketing page renders inside <div className="mkt"> with this CSS injected once.
//
// Self-hosted Manrope (public/new/fonts) + a fine-grain noise overlay. Keep this
// the single source of the marketing theme so every public page stays consistent.
export const MKT_CSS = `
/* Manrope — self-hosted (global @font-face; only used where font-family:Manrope is set, i.e. inside .mkt) */
@font-face{font-family:'Manrope';font-style:normal;font-weight:400;font-display:swap;src:url('/new/fonts/manrope-latin-400-normal.woff2') format('woff2')}
@font-face{font-family:'Manrope';font-style:normal;font-weight:500;font-display:swap;src:url('/new/fonts/manrope-latin-500-normal.woff2') format('woff2')}
@font-face{font-family:'Manrope';font-style:normal;font-weight:600;font-display:swap;src:url('/new/fonts/manrope-latin-600-normal.woff2') format('woff2')}
@font-face{font-family:'Manrope';font-style:normal;font-weight:700;font-display:swap;src:url('/new/fonts/manrope-latin-700-normal.woff2') format('woff2')}
@font-face{font-family:'Manrope';font-style:normal;font-weight:800;font-display:swap;src:url('/new/fonts/manrope-latin-800-normal.woff2') format('woff2')}

html{scroll-behavior:smooth}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}

.mkt{
  --bg:#000; --s1:#08080A; --s2:#0E0E11;
  --line:#17171B; --line2:#24242A;
  --t1:#F5F4F7; --t2:#9B9BA5; --t3:#66666F; --t4:#3E3E46;
  --ok:#3BD1A1; --warn:#E0B341;
  --max:1120px;
  --font:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  --grain:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background:var(--bg);color:var(--t1);font-family:var(--font);font-weight:400;
  font-size:16px;line-height:1.65;-webkit-font-smoothing:antialiased;overflow-x:hidden;min-height:100vh}
.mkt *{box-sizing:border-box}
.mkt a{color:inherit;text-decoration:none}
.mkt img{display:block;max-width:100%}
.mkt .wrap{max-width:var(--max);margin:0 auto;padding:0 26px}
.mkt section[id]{scroll-margin-top:96px}

.mkt h2{font-size:clamp(26px,3.6vw,44px);font-weight:700;letter-spacing:-.034em;line-height:1.1;margin:0;text-wrap:balance}
.mkt h2 em{font-style:normal;color:var(--t3)}
.mkt h3{font-size:17px;font-weight:600;letter-spacing:-.012em;margin:0}
.mkt .eyebrow{font-size:11px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--t3);margin:0}
.mkt .lead{font-size:17px;line-height:1.68;color:var(--t2);max-width:52ch;margin:0}
.mkt .fine{font-size:12.5px;font-weight:500;color:var(--t4);margin:0}

.mkt .pill{display:inline-block;font-size:14.5px;font-weight:600;padding:13px 26px;border-radius:999px;
  transition:transform .16s,background .16s,border-color .16s;text-align:center}
.mkt .pill.w{background:#fff;color:#000}.mkt .pill.w:hover{transform:translateY(-1px)}
.mkt .pill.g{color:#D6D6DC;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.05)}
.mkt .pill.g:hover{border-color:rgba(255,255,255,.34)}
.mkt :focus-visible{outline:2px solid var(--ok);outline-offset:3px}

/* nav */
.mkt .navbar{position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:60;
  width:min(1120px,calc(100% - 36px));display:flex;align-items:center;gap:26px;height:56px;
  padding:0 10px 0 20px;border-radius:999px;background:rgba(16,16,18,.55);
  backdrop-filter:blur(22px) saturate(180%);border:1px solid rgba(255,255,255,.09);
  box-shadow:0 10px 40px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.10)}
.mkt .navbar .brand{font-weight:800;letter-spacing:-.045em;font-size:16px;color:var(--t1)}
.mkt .navbar ul{display:flex;gap:24px;list-style:none;margin:0 auto;padding:0;font-size:13.5px;font-weight:500;color:var(--t2)}
.mkt .navbar ul a:hover{color:#fff}
.mkt .navbar .right{display:flex;align-items:center;gap:14px}
.mkt .navbar .login{font-size:13.5px;font-weight:600;color:var(--t2)}
.mkt .navbar .login:hover{color:#fff}
.mkt .navbar .go{font-size:13.5px;font-weight:600;background:#fff;color:#000;padding:9px 18px;border-radius:999px;white-space:nowrap}
@media(max-width:900px){.mkt .navbar ul{display:none}.mkt .navbar{justify-content:space-between;gap:12px}}

/* hero film */
.mkt .stage{position:relative;width:100%;height:100svh;min-height:460px;overflow:hidden;background:#000;
  display:flex;align-items:flex-end;isolation:isolate}
.mkt .film{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:0;background:transparent;
  filter:brightness(.84) contrast(1.04)}
.mkt .filmbg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1;
  transform:scale(1.14);filter:blur(64px) brightness(.30) saturate(.7);opacity:0;pointer-events:none;
  transition:opacity .5s ease}
.mkt .stage::before{content:'';position:absolute;inset:0;z-index:0;background:#000}
@media (min-aspect-ratio:16/9){.mkt .filmbg{opacity:1}}
.mkt .scrim{position:absolute;inset:0;z-index:1;pointer-events:none;
  background:radial-gradient(125% 78% at 50% 48%,transparent 40%,rgba(0,0,0,.55) 100%),
    linear-gradient(180deg,rgba(0,0,0,.6) 0%,transparent 18%,transparent 60%,rgba(0,0,0,.94) 100%)}
.mkt .grain{position:absolute;inset:0;z-index:2;pointer-events:none;opacity:.075;mix-blend-mode:screen;
  background-image:var(--grain);background-size:200px 200px}
.mkt .bar{position:absolute;left:0;right:0;height:clamp(26px,5.2vh,64px);background:#000;z-index:3;
  pointer-events:none;box-shadow:0 0 30px 12px rgba(0,0,0,.9)}
.mkt .bar.t{top:0}.mkt .bar.b{bottom:0}
.mkt .foot{position:relative;z-index:6;width:100%;max-width:var(--max);margin:0 auto;
  padding:0 26px clamp(52px,9vh,96px);display:flex;align-items:flex-end;justify-content:space-between;
  gap:20px;flex-wrap:wrap}
.mkt .cta{display:flex;gap:11px;flex-wrap:wrap}
.mkt .micro{font-size:12.5px;color:var(--t2);margin:0}
.mkt .ctl{position:absolute;right:26px;bottom:clamp(52px,9vh,96px);z-index:6;width:38px;height:38px;
  border-radius:999px;display:grid;place-items:center;cursor:pointer;background:rgba(255,255,255,.06);
  border:1px solid rgba(255,255,255,.13);backdrop-filter:blur(10px);color:rgba(255,255,255,.7);
  font-size:14px;font-family:var(--font)}
.mkt .ctl:hover{background:rgba(255,255,255,.14);color:#fff}

/* proof strip */
.mkt .proof{border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:#000}
.mkt .proof .wrap{display:flex;gap:34px;flex-wrap:wrap;padding-block:22px}
.mkt .proof span{font-size:12.5px;font-weight:500;color:var(--t3)}
.mkt .proof b{color:var(--t1);font-weight:600}

/* sections */
.mkt section.blk{padding-block:clamp(76px,10vw,124px);position:relative}
.mkt .head{display:flex;flex-direction:column;gap:16px;max-width:58ch;margin-bottom:56px}
.mkt .two{display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:center}
.mkt .two.flip>*:first-child{order:2}
@media(max-width:900px){.mkt .two{grid-template-columns:1fr;gap:40px}.mkt .two.flip>*:first-child{order:0}}
.mkt .copy{display:flex;flex-direction:column;gap:18px}
.mkt .bul{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:16px}
.mkt .bul li{font-size:14.5px;color:var(--t2);line-height:1.55;padding-left:18px;position:relative}
.mkt .bul li:before{content:'';position:absolute;left:0;top:8px;width:4px;height:4px;border-radius:50%;background:var(--t4)}
.mkt .bul b{color:var(--t1);font-weight:600;display:block;margin-bottom:2px}

/* device frame */
.mkt .dev{position:relative;width:min(300px,78vw);margin:0 auto;border-radius:40px;padding:9px;
  background:linear-gradient(160deg,#2b2b31,#0b0b0e 55%);
  box-shadow:0 50px 100px rgba(0,0,0,.85),0 0 0 1px rgba(255,255,255,.06)}
.mkt .dev img{border-radius:32px;width:100%}
.mkt .dev::after{content:'';position:absolute;inset:9px;border-radius:32px;pointer-events:none;
  background:linear-gradient(155deg,rgba(255,255,255,.15),transparent 34%)}
.mkt .devs{display:flex;justify-content:center;align-items:flex-end;gap:0}
.mkt .devs .dev{width:min(250px,44vw)}
.mkt .devs .dev.a{transform:rotate(-5deg) translateY(26px);margin-right:-30px;z-index:1}
.mkt .devs .dev.b{z-index:3;width:min(278px,48vw)}
.mkt .devs .dev.c{transform:rotate(5deg) translateY(26px);margin-left:-30px;z-index:1}
@media(max-width:640px){
  .mkt .devs .dev{width:28vw}
  .mkt .devs .dev.b{width:32vw}
  .mkt .devs .dev.a{margin-right:-22px}
  .mkt .devs .dev.c{margin-left:-22px}
  .mkt .devs .dev{border-radius:26px;padding:6px}
  .mkt .devs .dev img,.mkt .devs .dev::after{border-radius:20px}
  .mkt .devs .dev::after{inset:6px}
}

/* problem / no-show band */
.mkt .band{position:relative;overflow:hidden;background:#000}
.mkt .band img.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.30;z-index:0}
.mkt .band .veil{position:absolute;inset:0;z-index:1;
  background:linear-gradient(180deg,#000 0%,rgba(0,0,0,.55) 30%,rgba(0,0,0,.55) 70%,#000 100%)}
.mkt .band .wrap{position:relative;z-index:2}
.mkt .band .grain{opacity:.06}

/* booking rail */
.mkt .rail{display:grid;grid-template-columns:repeat(4,1fr);gap:22px}
.mkt .step .sn{font-size:10.5px;font-weight:700;letter-spacing:.2em;color:var(--t4);margin:0 0 14px}
.mkt .step .fr{border-radius:16px;overflow:hidden;border:1px solid var(--line2);background:#000;
  box-shadow:0 24px 60px rgba(0,0,0,.8)}
.mkt .step p{font-size:13px;color:var(--t3);line-height:1.55;margin:12px 0 0}
@media(max-width:880px){.mkt .rail{grid-template-columns:repeat(2,1fr);gap:30px 20px}}
@media(max-width:480px){.mkt .rail{grid-template-columns:1fr;gap:34px}}

/* rate table */
.mkt .rates{border-top:1px solid var(--line);margin-top:36px}
.mkt .rate{display:flex;justify-content:space-between;align-items:baseline;gap:16px;
  padding:15px 0;border-bottom:1px solid var(--line)}
.mkt .rate .l{font-size:14px;font-weight:500;color:var(--t2)}
.mkt .rate .l em{font-style:normal;display:block;font-size:12px;color:var(--t4);margin-top:2px}
.mkt .rate .v{font-size:17px;font-weight:700;color:var(--t1);font-variant-numeric:tabular-nums;flex:none}

/* figures */
.mkt .figs{display:grid;grid-template-columns:repeat(3,1fr);gap:52px}
.mkt .fig .n{font-size:clamp(40px,5.6vw,58px);font-weight:700;letter-spacing:-.045em;line-height:1;margin:0 0 14px}
.mkt .fig p{font-size:13.5px;color:var(--t3);line-height:1.55;margin:6px 0 0}
@media(max-width:760px){.mkt .figs{grid-template-columns:1fr;gap:36px}}

/* pricing tiers */
.mkt .tiers{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;align-items:start}
.mkt .tier{border-top:1px solid var(--line);padding:28px 0 0;display:flex;flex-direction:column}
.mkt .tier.hi{border:1px solid var(--line2);border-radius:16px;background:var(--s1);padding:28px 24px}
.mkt .tn{font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--t3);margin:0 0 16px}
.mkt .pr{display:flex;align-items:baseline;gap:3px;margin-bottom:20px}
.mkt .pr .p{font-size:36px;font-weight:700;letter-spacing:-.045em;font-variant-numeric:tabular-nums;line-height:1}
.mkt .pr .u{font-size:12.5px;font-weight:500;color:var(--t4)}
.mkt .tier ul{list-style:none;margin:0 0 24px;padding:0;display:flex;flex-direction:column;gap:10px;flex:1}
.mkt .tier li{font-size:13px;font-weight:500;color:var(--t2);padding-left:15px;position:relative;line-height:1.5}
.mkt .tier li:before{content:'';position:absolute;left:0;top:7px;width:3px;height:3px;border-radius:50%;background:var(--t4)}
.mkt .tier .pill{text-align:center;width:100%}
@media(max-width:820px){.mkt .tiers{grid-template-columns:1fr;gap:24px}}

/* close */
.mkt .close{position:relative;overflow:hidden;background:#000;padding-block:clamp(86px,12vw,136px)}
.mkt .close img.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.22;z-index:0}
.mkt .close .veil{position:absolute;inset:0;z-index:1;background:linear-gradient(180deg,#000,rgba(0,0,0,.4) 45%,#000)}
.mkt .close .wrap{position:relative;z-index:2;display:flex;flex-direction:column;gap:20px;align-items:flex-start;max-width:640px}

/* our footer, fitted to the new theme */
.mkt .site-footer{border-top:1px solid var(--line);background:#000}
.mkt .site-footer .wrap{padding-block:48px 56px}
.mkt .fg{display:grid;grid-template-columns:1.6fr repeat(3,1fr);gap:28px}
.mkt .fg h5{color:var(--t1);font-size:13px;font-weight:700;margin:0 0 12px}
.mkt .fg a{display:block;padding:4px 0;color:var(--t2);font-size:13.5px}
.mkt .fg a:hover{color:var(--t1)}
.mkt .fg .fabout{color:var(--t3);font-size:13px;line-height:1.6;margin:12px 0 0;max-width:32ch}
.mkt .fb{display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-top:34px;padding-top:22px;border-top:1px solid var(--line);font-size:12px;color:var(--t4)}
@media(max-width:860px){.mkt .fg{grid-template-columns:1fr 1fr}}
@media(max-width:520px){.mkt .fg{grid-template-columns:1fr}}

@media (prefers-reduced-motion:reduce){.mkt *{transition:none!important}}
`;

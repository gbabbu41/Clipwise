// Homepage-only refinement. Keep shared marketing pages and app portals unchanged.
const HOME_PAGE_CSS = `
.mkt:has(.home-content) .home-content{--s1:#000;--t2:#b8b8c2;--t3:#a2a2ad;--t4:#92929f;--line:#222227;--line2:#303037;--cta-accent:#73608F;--cta-accent-ink:#F4F1E8}
/* Closing "Get started" button — the ONE place this color is set. Change
   --cta-accent (and --cta-accent-ink for the text) above to try another
   color; delete this rule (or set --cta-accent back to #fff / #000 ink) to
   revert to the plain white button used everywhere else PublicClose renders. */
.mkt .home-content .public-close .pill.w{background:var(--cta-accent);color:var(--cta-accent-ink)}
.mkt .home-content section[id]{scroll-margin-top:28px}
.mkt .home-content section.blk{padding-block:clamp(64px,8vw,104px)}
.mkt .home-content h2 em{color:#dedee3}
.mkt .home-content .head{margin-bottom:44px}
.mkt .home-content .eyebrow{color:#a2a2ad}
.mkt .home-content .proof .wrap{justify-content:space-between;gap:16px 24px}
.mkt .home-content .dev{background:#101013;border:1px solid #303037;box-shadow:none}
.mkt .home-content .dev::after{display:none}
.mkt .home-content .dev img,.mkt .home-content .step img{height:auto}
.mkt .home-content .grain{display:none}
.mkt .home-content .step .sn{color:#6487b8;font-weight:700;letter-spacing:.15em}
.mkt .home-content .step .fr{box-shadow:none;border-color:#303037}
.mkt .home-content .step p{font-size:14px}
.mkt .home-content .fig{border-top:1px solid var(--line);padding-top:26px}
.mkt .home-content .fig p{font-size:14px;line-height:1.7}
.mkt .home-content .tiers{align-items:stretch;gap:24px}
.mkt .home-content .tier,.mkt .home-content .tier.hi{border:0;border-top:1px solid #303037;border-radius:0;background:#000;padding:28px 0 0;min-width:0}
.mkt .home-content .tier.hi{border-top-color:#6487b8}
.mkt .home-content .tier.hi .tn{color:#6487b8}
.mkt .home-content .tn{font-size:12px;margin-bottom:14px}
.mkt .home-content .plan-for{color:var(--t3);font-size:13px;line-height:1.6;min-height:42px;margin:0 0 22px}
.mkt .home-content .pr{gap:7px;margin-bottom:14px}
.mkt .home-content .tier li{font-size:14px}
.mkt .home-content .tier .pill{margin-top:auto}
.mkt .home-content :focus-visible{outline-color:#6487b8}
.mkt:has(.home-content) .site-footer{--t2:#b8b8c2;--t3:#a2a2ad;--t4:#92929f}
.mkt:has(.home-content) .site-footer a:hover{color:#6487b8}
.mkt:has(.home-content) .site-footer a:focus-visible{outline-color:#6487b8}
.mkt:has(.home-content) .site-footer .fg a{display:flex;align-items:center;min-height:44px;width:fit-content}
@media(max-width:900px){.mkt .home-content .two{gap:36px}}
@media(max-width:640px){
 .mkt .home-content .head{margin-bottom:32px}
 .mkt .home-content .lead{font-size:16px}
 .mkt .home-content .proof .wrap{display:grid;grid-template-columns:1fr 1fr;gap:12px 18px}
 .mkt .home-content .proof span:last-child{grid-column:1/-1}
 .mkt .home-content .step{max-width:300px;width:100%;margin-inline:auto}
 .mkt .home-content .plan-for{min-height:0}
 .mkt .home-content .close .cta{width:100%}
 .mkt .home-content .close .pill{flex:1;white-space:nowrap}
}
`;

export function HomePageStyles() {
  return <style dangerouslySetInnerHTML={{ __html: HOME_PAGE_CSS }} />;
}

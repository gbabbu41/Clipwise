// Visual scope only: public booking routes. No shared Button or portal CSS edits.
const CSS = `
.public-booking{background:#000;color:#f5f4f7;min-height:100dvh}
.public-booking .sl{--bg:#000;--bg2:#000;--panel:#0b0b0d;--raised:#141417;--ink2:#b8b8c2;--ink3:#a2a2ad;--em:#6487b8;--em2:#6487b8;--em-deep:#303037;--em-ink:#000;--gold:#dedee3}
.public-booking .sl-aurora,.public-booking .sl-grain,.public-booking .sl-vignette,.public-booking .sl-dot,.public-booking .sl-final-glow,.public-booking .sl-scroll{display:none}
.public-booking .sl-hero{min-height:0;padding:72px 22px 48px}.public-booking .sl-title{background:none;color:#fff;font-size:clamp(36px,7vw,62px);text-transform:none}
.public-booking .sl-logo{box-shadow:none;border-radius:22px}.public-booking .sl-logo-fb,.public-booking .sl-barber-ph{background:#17171c}.public-booking .sl-barber-ph span{color:#fff}
.public-booking .sl-btn-primary,.public-booking .sl-btn-primary:hover{background:#fff;color:#000;box-shadow:none}.public-booking .sl-btn-ghost{background:#000;backdrop-filter:none}
.public-booking .sl-eyebrow{background:none;border:0;backdrop-filter:none;padding:0}.public-booking .sl-stats{gap:20px}.public-booking .sl-stat{background:none;border:0;border-top:1px solid var(--line);border-radius:0;padding:20px 8px}
.public-booking .sl-srv,.public-booking .sl-barber,.public-booking .sl-review,.public-booking .sl-visit-addr,.public-booking .sl-visit-contact{background:#000;border-radius:12px;box-shadow:none}
.public-booking .sl-srv-price{color:#fff}.public-booking .sl-rv{opacity:1;transform:none;transition:none}.public-booking .sl-final{margin-top:36px;padding-top:56px}
.public-booking .sl-sticky-in{background:#000;backdrop-filter:none;box-shadow:none;border-radius:16px}
.public-booking .btn-primary{--bs-btn-bg:#fff;--bs-btn-border-color:#fff;--bs-btn-color:#000;background:#fff;color:#000;border-color:#fff;box-shadow:none}
.public-booking .btn-primary:hover:not(:disabled){background:#dedee3;color:#000;border-color:#dedee3}
.public-booking :focus-visible{outline:2px solid #6487b8;outline-offset:3px}
.public-booking .text-gold{color:#6487b8}.public-booking .accent-gold{accent-color:#6487b8}
.public-booking .cw-book-cine.bg-black{background:#000}
.public-booking .cw-book-cine .bg-black{background-color:#000}
.public-booking .cw-book-cine .bg-white,.public-booking .cw-book-cine .bg-gold,.public-booking .cw-book-cine .bg-emerald-400,.public-booking .cw-book-cine .bg-emerald-500{background-color:#fff}
.public-booking .cw-book-cine .cw-cat.bg-white{background:#101013;color:#fff;border-color:#6487b8}
.public-booking .cw-book-cine [class~="hover:bg-white/90"]:hover,.public-booking .cw-book-cine [class~="hover:bg-gold/90"]:hover,.public-booking .cw-book-cine [class~="hover:bg-[#eaeaea]"]:hover{background:#dedee3}
.public-booking .cw-book-cine [class~="bg-gold/10"],.public-booking .cw-book-cine [class~="bg-gold/15"],.public-booking .cw-book-cine [class~="bg-gold/20"],.public-booking .cw-book-cine [class~="bg-emerald-500/10"],.public-booking .cw-book-cine [class~="bg-emerald-500/20"]{background:rgba(100,135,184,.12)}
.public-booking .cw-book-cine [class~="hover:bg-gold/20"]:hover,.public-booking .cw-book-cine [class~="hover:bg-gold/40"]:hover{background:rgba(100,135,184,.2)}
.public-booking .cw-book-cine .border-gold,.public-booking .cw-book-cine [class~="border-gold/50"],.public-booking .cw-book-cine [class~="border-gold/40"],.public-booking .cw-book-cine [class~="border-gold/30"],.public-booking .cw-book-cine [class~="border-emerald-500/40"],.public-booking .cw-book-cine [class~="border-emerald-500/30"],.public-booking .cw-book-cine [class~="border-emerald-500/25"]{border-color:#6487b8}
.public-booking .cw-book-cine [class~="focus:border-gold"]:focus,.public-booking .cw-book-cine [class~="focus:border-gold/50"]:focus{border-color:#6487b8}
.public-booking .cw-book-cine [class~="ring-gold/30"],.public-booking .cw-book-cine [class~="focus:ring-gold/30"]:focus,.public-booking .cw-book-cine [class~="focus:ring-gold/50"]:focus{--tw-ring-color:rgba(100,135,184,.45)}
.public-booking .cw-book-cine .text-gold,.public-booking .cw-book-cine .text-emerald-400{color:#6487b8}
.public-booking .cw-book-cine .border-t-gold{border-top-color:#6487b8}
@media(max-width:640px){.public-booking .sl-hero{padding-top:44px}.public-booking .sl-stats{gap:12px}.public-booking .sl-stat{min-width:100px}}
`;
export function PublicBookingIdentity() { return <style dangerouslySetInnerHTML={{ __html: CSS }} />; }

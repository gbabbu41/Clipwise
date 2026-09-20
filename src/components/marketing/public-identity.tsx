// Only rendered by public marketing/auth shells. No portal-wide CSS changes.
const CSS = `
.mkt.public-site{--s1:#000;--t2:#b8b8c2;--t3:#a2a2ad;--t4:#92929f;--line:#242429;--line2:#34343b;--accent:#6487b8}
.mkt.public-site .navbar{position:relative;top:auto;left:auto;transform:none;margin:0 auto;height:auto;min-height:70px;padding:26px 10px 0 20px;justify-content:space-between;gap:24px;background:#000;backdrop-filter:none;border:0;border-radius:0;box-shadow:none}
.mkt.public-site .navbar .brand{font-size:19px}.mkt.public-site .navbar ul{gap:23px;font-size:12px}.mkt.public-site .navbar .right{gap:16px}.mkt.public-site .navbar .login{font-size:12px}
.mkt.public-site .navbar .go{display:inline-flex;align-items:center;justify-content:center;min-height:44px;font-size:12px;padding:11px 17px}
.mkt.public-site .navbar ul,.mkt.public-site .navbar .login{color:#e4e4e9}
.mkt.public-site .mobmenu{background:#000;backdrop-filter:none;border-color:#29292f}.mkt.public-site .mobmenu a{color:#e4e4e9}
.mkt.public-site .navbar ul a:hover,.mkt.public-site .navbar .login:hover,.mkt.public-site .mobmenu a:hover,.mkt.public-site .site-footer a:hover{color:var(--accent)}
.mkt.public-site :focus-visible{outline:2px solid #6487b8;outline-offset:4px}
.mkt.public-site .doc,.mkt.public-site .dir{padding-top:72px}
.mkt.public-site .site-footer .fg a{display:flex;align-items:center;min-height:44px;width:fit-content}
.mkt.public-site h2 em{color:#dedee3}.mkt.public-site .grain{display:none}
.mkt.public-site .authwrap{padding-block:48px}.mkt.public-site .authcard{background:#000;border:0;padding:18px 0;border-radius:0}
.mkt.public-site .authcard input,.mkt.public-site .authcard select{font-size:16px;min-height:48px;border-radius:10px;background:#0b0b0d}
.mkt.public-site .authcard input:focus{border-color:#6487b8}
.mkt.public-site .prose{gap:30px}.mkt.public-site .prose p{color:var(--t2)}
.mkt.public-site .prose section{scroll-margin-top:28px;padding-top:24px;border-top:1px solid var(--line)}
.mkt.public-site .legal-index{font-size:14px;border-block:1px solid var(--line);padding:18px 0;margin:24px 0}
.mkt.public-site .legal-index summary{cursor:pointer;color:#fff;min-height:28px}.mkt.public-site .legal-index ul{display:grid;gap:8px;padding:16px 0 0;list-style:none}
.mkt .public-intro{padding:76px 0 48px;max-width:760px}.mkt .public-intro h1{font-size:clamp(36px,5.6vw,64px);line-height:1.08;letter-spacing:-.045em;margin:18px 0 22px;text-wrap:balance}
.mkt .public-intro .cta{margin-top:28px}.mkt .public-section{padding:64px 0;border-top:1px solid var(--line)}
.mkt .public-section .head{margin-bottom:32px}.mkt .public-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:36px}
.mkt .public-feature{display:flex;flex-direction:column;gap:14px;min-width:0;padding:18px;margin:-18px;border-radius:16px;border:1px solid transparent;background:transparent;transition:background .25s,border-color .25s}.mkt .public-feature:hover{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.10);backdrop-filter:blur(16px) saturate(160%);-webkit-backdrop-filter:blur(16px) saturate(160%)}.mkt .public-feature .number{font-size:12px;color:#6487b8;letter-spacing:.12em}.mkt .public-feature p{color:var(--t2);font-size:15px;margin:0;line-height:1.7}
.mkt .public-link{font-size:14px;font-weight:600;display:inline-flex;align-items:center;gap:8px;min-height:44px;width:fit-content;margin-top:auto}.mkt .public-link:hover{color:#6487b8}
.mkt .public-split{display:grid;grid-template-columns:1.1fr .9fr;align-items:center;gap:64px}.mkt .public-split .copy{max-width:520px}
.mkt .public-phone{width:min(280px,78vw);margin:0 auto;padding:8px;border:1px solid #303037;background:#101013;border-radius:32px}.mkt .public-phone img{width:100%;height:auto;border-radius:25px}
.mkt .public-faq{max-width:780px}.mkt .public-faq details{padding:22px 0;border-bottom:1px solid var(--line)}.mkt .public-faq summary{font-weight:600;cursor:pointer;font-size:16px;min-height:28px}.mkt .public-faq p{color:var(--t2);font-size:15px;line-height:1.75;margin:14px 0 0}
.mkt .public-close{padding:76px 0;border-top:1px solid var(--line)}.mkt .public-close .wrap{display:flex;justify-content:space-between;align-items:center;gap:28px}.mkt .public-close p{color:var(--t2);margin:16px 0 0}
.mkt .public-prices{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:32px}.mkt .public-price{display:flex;flex-direction:column;border-top:1px solid var(--line2);padding-top:24px}.mkt .public-price.featured{border-top-color:#6487b8}.mkt .public-price.featured .eyebrow{color:#6487b8}
.mkt .public-price .amount{font-size:40px;letter-spacing:-.04em;margin:14px 0 8px}.mkt .public-price .amount span{font-size:13px;color:var(--t3);letter-spacing:0;margin-left:6px}.mkt .public-price .audience{font-size:14px;color:var(--t2);min-height:48px;margin:0 0 22px}.mkt .public-price ul{list-style:none;padding:0;margin:0 0 24px;display:flex;flex-direction:column;gap:12px;flex:1}.mkt .public-price li{font-size:14px;color:var(--t2)}.mkt .public-price .pill{margin-top:auto}
.mkt .public-price details{font-size:13px;color:var(--t3);margin:0 0 24px}.mkt .public-price summary{cursor:pointer;min-height:30px}.mkt .public-price details p{margin:8px 0}
.mkt .compact-pricing{display:flex;align-items:center;justify-content:space-between;gap:24px}.mkt .compact-pricing p{color:var(--t2);margin:16px 0}
.mkt .skip-public{position:absolute;top:8px;left:20px;transform:translateY(-200%);z-index:100;background:#fff;color:#000;padding:10px 16px;border-radius:8px}.mkt .skip-public:focus{transform:none}
@media(max-width:900px){.mkt .public-split{gap:36px}.mkt .public-grid{gap:24px}.mkt .public-prices{gap:24px}}
@media(max-width:760px){.mkt.public-site .navbar{padding-top:22px;min-height:66px;gap:12px}.mkt .public-intro{padding:48px 0 36px}.mkt .public-section{padding:48px 0}.mkt .public-grid,.mkt .public-split,.mkt .public-prices{grid-template-columns:1fr;gap:32px}.mkt .public-feature+.public-feature{border-top:1px solid var(--line);padding-top:28px}.mkt .public-close .wrap,.mkt .compact-pricing{align-items:flex-start;flex-direction:column}.mkt .public-price .audience{min-height:0}.mkt.public-site .doc,.mkt.public-site .dir{padding-top:48px}.mkt .public-intro .lead{font-size:16px}}
`;
export function PublicIdentity() { return <style dangerouslySetInnerHTML={{ __html: CSS }} />; }

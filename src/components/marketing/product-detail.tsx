import Link from "next/link";
import { MarketingShell } from "./shell";
import { PRODUCT_PAGES, PublicClose, PublicFAQ } from "./public-content";

export function ProductDetail({ page }: { page: keyof typeof PRODUCT_PAGES }) {
  const data = PRODUCT_PAGES[page];
  return <MarketingShell><main id="public-main">
    <div className="wrap"><header className="public-intro"><p className="eyebrow">{data.eyebrow}</p><h1>{data.title}</h1><p className="lead">{data.description}</p><div className="cta"><Link className="pill w" href="/signup">Get started free ↗</Link><Link className="pill g" href="/pricing">View pricing</Link></div></header></div>
    <section className="public-section"><div className="wrap public-split"><div className="copy"><h2>{data.imageTitle}</h2><p className="lead">{data.imageText}</p></div><div className="public-phone"><img src={`/new/${data.image}`} alt={data.imageAlt} width={data.image.startsWith("book") ? 520 : 640} height={data.image.startsWith("book") ? 1016 : 1280} /></div></div></section>
    <section className="public-section"><div className="wrap public-grid">{data.items.map((item, i) => <article className="public-feature" key={item.title}><span className="number">0{i + 1}</span><h3>{item.title}</h3><p>{item.text}</p><Link className="public-link" href={item.href}>{item.link} →</Link></article>)}</div></section>
    <section className="public-section"><div className="wrap"><div className="head"><p className="eyebrow">Good to know</p><h2>A little more detail.</h2></div><PublicFAQ items={[...data.faq]} /></div></section><PublicClose />
  </main></MarketingShell>;
}

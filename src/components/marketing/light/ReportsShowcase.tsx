"use client";

import { useState } from "react";
import styles from "./page.module.css";

const sample = {
  week: { labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], values: [246, 318, 286, 402, 495, 438, 174] },
  month: { labels: ["Week 1", "Week 2", "Week 3", "Week 4"], values: [2180, 2359, 2490, 2710] },
};
const cad = (value: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(value);

export function ReportsShowcase({ headingId }: { headingId?: string }) {
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [barber, setBarber] = useState("all");
  const data = sample[period];
  const factor = barber === "maya" ? .56 : barber === "leo" ? .44 : 1;
  const values = data.values.map(value => Math.round(value * factor));
  const total = values.reduce((sum, value) => sum + value, 0);
  return <div className={styles.reportsShowcase}>
    <div className={styles.reportIntro}>
      <p className={styles.panelEyebrow}>REPORTS & ANALYTICS</p>
      <h3 id={headingId}>See the patterns.<br />Plan your next move.</h3>
      <p>Choose a reporting period and focus on the whole shop or one barber. See how sales, services, and your team are performing.</p>
      <ul><li>Revenue trends and barber comparisons</li><li>Service mix and busy payment hours</li><li>Export filtered appointment records as CSV</li></ul>
      <p className={styles.reportDisclaimer}>Interactive illustration · Fictional figures in CAD</p>
    </div>
    <div className={styles.reportDemo}>
      <div className={styles.reportControls}>
        <label>Period<select value={period} onChange={event => setPeriod(event.target.value as "week" | "month")}><option value="week">This week</option><option value="month">This month</option></select></label>
        <label>Team<select value={barber} onChange={event => setBarber(event.target.value)}><option value="all">Whole shop</option><option value="maya">Maya</option><option value="leo">Leo</option></select></label>
      </div>
      <div className={styles.reportSummary} aria-live="polite"><span>Sample sales<strong>{cad(total)}</strong></span><span>{barber === "all" ? "Whole shop" : barber === "maya" ? "Maya" : "Leo"}<small>{period === "week" ? "Sample week" : "Sample month"}</small></span></div>
      <div className={styles.reportBars} role="img" aria-label={`Sample sales: ${data.labels.map((label, index) => `${label} ${cad(values[index])}`).join(", ")}`}>
        {values.map((value, index) => <div key={data.labels[index]}><span>{cad(value)}</span><div className={styles.reportBarTrack}><i style={{ height: `${value / Math.max(...values) * 100}%` }} /></div><b>{data.labels[index]}</b></div>)}
      </div>
      <div className={styles.reportMix}><h4>Service mix <span>Sample share of sales</span></h4>{[["Haircuts", 62], ["Haircut & beard", 26], ["Beard trims", 12]].map(([label, value]) => <div key={label}><span>{label}</span><meter min={0} max={100} value={Number(value)} aria-label={`${label}: ${value}%`} /><b>{value}%</b></div>)}</div>
    </div>
  </div>;
}

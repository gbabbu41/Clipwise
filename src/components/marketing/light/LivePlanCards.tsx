"use client";

import { useEffect, useState } from "react";
import { formatPlanPrice, type PlanRow } from "@/lib/plans";
import { marketingFor } from "@/lib/plan-marketing";
import styles from "./page.module.css";

type LoadState = { plans: PlanRow[] | null; failed: boolean };
const STANDARD_PLANS = new Set(["starter", "pro", "premium"]);

export function LivePlanCards() {
  const [state, setState] = useState<LoadState>({ plans: null, failed: false });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
    setState({ plans: null, failed: false });
    fetch("/api/plans", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Plans unavailable");
        const payload: { plans?: PlanRow[] } = await response.json();
        if (!Array.isArray(payload.plans)) throw new Error("Invalid plan response");
        setState({ plans: payload.plans.filter(plan => plan.is_active), failed: false });
      })
      .catch(() => { if (!controller.signal.aborted || timedOut) setState({ plans: [], failed: true }); })
      .finally(() => window.clearTimeout(timeout));
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [attempt]);

  if (state.plans === null) return <p className={styles.livePlansMessage} role="status">Loading current plans…</p>;
  if (state.failed || state.plans.length === 0) return (
    <p className={styles.livePlansMessage} role="status">
      Current plan details are unavailable. <button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button>
    </p>
  );

  return (
    <div className={styles.planGrid}>
      {state.plans.map(plan => {
        const marketing = marketingFor(plan.id);
        const knownPlan = STANDARD_PLANS.has(plan.id);
        const included = marketing
          ? marketing.yes.filter(item => !/21-day free trial|\b\d+ chairs?\b/i.test(item))
          : plan.highlights;
        const audience = plan.id === "starter" ? "For an independent shop"
          : plan.id === "pro" ? "For a growing shop"
            : plan.id === "premium" ? "For an established team"
              : plan.description || "Plan details shown below";
        const limit = plan.barber_limit == null ? "Unlimited chairs"
          : plan.barber_limit === 1 ? "1 chair" : `Up to ${plan.barber_limit} chairs`;
        const trial = marketing?.yes.some(item => /21-day free trial/i.test(item));
        const signupHref = knownPlan ? `/signup?plan=${encodeURIComponent(plan.id)}` : "mailto:support@clipwise.ca?subject=ClipWise%20plan%20inquiry";
        const cta = marketing?.cta ?? "Ask about this plan";

        return (
          <article className={`${styles.plan} ${plan.id === "pro" ? styles.planFeatured : ""}`} key={plan.id}>
            <h3>{plan.name}</h3>
            <p className={styles.planAudience}>{audience}</p>
            <p className={styles.price}>{formatPlanPrice(plan.price_cents)}<span>{plan.price_cents > 0 ? "/ month" : ""}</span></p>
            <p className={styles.chairLimit}>{limit}</p>
            <p className={styles.planSectionLabel}>Included</p>
            <ul className={styles.planIncluded}>
              {included.map(item => <li key={item}>{item}</li>)}
            </ul>
            {marketing && marketing.no.length > 0 && <>
              <p className={styles.planSectionLabel}>Not included</p>
              <ul className={styles.planExcluded}>{marketing.no.map(item => <li key={item}>{item}</li>)}</ul>
            </>}
            {trial && <p className={styles.trial}>21-day trial · no card required</p>}
            <a href={signupHref} className={styles.planButton}>{cta}<span aria-hidden="true">→</span></a>
          </article>
        );
      })}
    </div>
  );
}

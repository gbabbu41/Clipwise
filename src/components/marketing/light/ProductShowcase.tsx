"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { BarChart3, CalendarDays, CreditCard, Globe2, Mail, UserRound } from "lucide-react";
import styles from "./page.module.css";
import { ReportsShowcase } from "./ReportsShowcase";

const tabs = [
  { id: "calendar", label: "Calendar", icon: CalendarDays, href: "/online-booking", action: "Explore online booking" },
  { id: "payments", label: "Payments", icon: CreditCard, href: "/payments", action: "Explore payments" },
  { id: "reports", label: "Reports", icon: BarChart3, href: "/features", action: "Explore ClipWise features" },
  { id: "booking-site", label: "Booking site", icon: Globe2, href: "/online-booking", action: "Explore online booking" },
  { id: "clients", label: "Client profiles", icon: UserRound, href: "/features", action: "Explore ClipWise features" },
  { id: "follow-ups", label: "Follow-ups", icon: Mail, href: "/features", action: "Explore ClipWise features" },
] as const;

type TabId = typeof tabs[number]["id"];

const appointments = [
  { time: "9:00 AM", name: "Alex", service: "Skin Fade", barber: "Maya", tone: "blue" },
  { time: "9:15 AM", name: "Jordan", service: "Haircut & Beard", barber: "Leo", tone: "sand" },
  { time: "10:00 AM", name: "Sam", service: "Buzz Cut", barber: "Maya", tone: "green" },
  { time: "10:30 AM", name: "Taylor", service: "Skin Fade", barber: "Leo", tone: "violet" },
  { time: "11:00 AM", name: "Riley", service: "Haircut", barber: "Maya", tone: "blue" },
  { time: "11:15 AM", name: "Morgan", service: "Beard Trim", barber: "Leo", tone: "sand" },
  { time: "12:00 PM", name: "Casey", service: "Skin Fade", barber: "Maya", tone: "violet" },
];

const calendarSlots = [
  { label: "9:00", maya: { time: "9:00", name: "Alex", service: "Skin Fade", tone: "blue" }, leo: { time: "9:15", name: "Jordan", service: "Haircut & Beard", tone: "sand" } },
  { label: "10:00", maya: { time: "10:00", name: "Sam", service: "Buzz Cut", tone: "green" }, leo: { time: "10:30", name: "Taylor", service: "Skin Fade", tone: "violet" } },
  { label: "11:00", maya: { time: "11:00", name: "Riley", service: "Haircut", tone: "blue" }, leo: { time: "11:15", name: "Morgan", service: "Beard Trim", tone: "sand" } },
  { label: "12:00", maya: { time: "12:00", name: "Casey", service: "Skin Fade", tone: "violet" }, leo: null },
];

function PanelContent({ id, headingId }: { id: TabId; headingId?: string }) {
  if (id === "calendar") return (
    <>
      <div className={styles.panelHeading}><div><p className={styles.panelEyebrow}>Fade Mechanic · Sample Tuesday, October 6</p><h3 id={headingId}>Team calendar</h3></div><span className={styles.panelCount}>7 appointments</span></div>
      <div className={styles.scheduleGrid} aria-label="Illustrative calendar schedule for Maya and Leo">
        <div className={styles.scheduleHeader}><span>Time</span><span>Maya</span><span>Leo</span></div>
        {calendarSlots.map(slot => (
          <div className={styles.scheduleRow} key={slot.label}>
            <time>{slot.label}</time>
            {[slot.maya, slot.leo].map((booking, index) => booking ? (
              <div className={`${styles.scheduleBooking} ${styles[booking.tone]}`} key={`${slot.label}-${index}`}><time>{booking.time}</time><strong>{booking.name}</strong><span>{booking.service}</span></div>
            ) : <div className={styles.scheduleEmpty} key={`${slot.label}-${index}`} aria-hidden="true" />)}
          </div>
        ))}
      </div>
      <div className={styles.appointmentList}>
        {appointments.map(appointment => (
          <div className={styles.appointmentRow} key={appointment.time}>
            <time>{appointment.time}</time>
            <span className={`${styles.appointmentMark} ${styles[appointment.tone]}`} aria-hidden="true" />
            <div className={styles.appointmentInfo}><strong>{appointment.name}</strong><span>{appointment.service} <i>with {appointment.barber}</i></span></div>
            <span className={styles.appointmentStatus}>Confirmed</span>
          </div>
        ))}
      </div>
    </>
  );

  if (id === "payments") return (
    <div className={styles.paymentsShowcase}>
      <div className={styles.paymentsStory}>
        <p className={styles.panelEyebrow}>THE PAYMENTS PAGE</p>
        <h3 id={headingId}>Know what’s paid.<br />See what’s still owed.</h3>
        <p>A dedicated Payments page to track unpaid appointments and look into each transaction.</p>
        <dl>
          <div><dt>Track unpaid appointments</dt><dd>See the outstanding total, find who still owes, and access payment-link actions from the unpaid list.</dd></div>
          <div><dt>Open any transaction</dt><dd>Check its service, barber, payment method, status, tax, amount, and date in a dedicated detail view.</dd></div>
          <div><dt>Separate views. Less searching.</dt><dd>Switch between all transactions, card, cash, unpaid, and refunds. Review collected totals by period.</dd></div>
        </dl>
      </div>
      <figure className={styles.paymentsDemoImage}>
        <img src="/marketing-preview/payments-demo-edited.png" width={1536} height={1024} alt="Edited ClipWise app screenshots with demo names: complete Payments screen, unpaid tracking, and individual transaction details" loading="lazy" />
      </figure>
    </div>
  );

  if (id === "reports") return <ReportsShowcase headingId={headingId} />;

  if (id === "booking-site") return (
    <div className={styles.productFeatureShowcase}>
      <div className={styles.productFeatureStory}>
        <p className={styles.panelEyebrow}>YOUR SHOP, IN THE BROWSER</p>
        <h3 id={headingId}>A booking page that looks like your shop.</h3>
        <p>Give clients a branded place to browse services and book from their phone or computer. No ClipWise app download is needed.</p>
        <dl>
          <div><dt>Show your shop</dt><dd>Share your story, services, prices and shop details on a page you can send to clients.</dd></div>
          <div><dt>Book in a browser</dt><dd>Clients choose a service, barber and available time, then confirm their appointment.</dd></div>
          <div><dt>Optional tip at checkout</dt><dd>When online payment is available, clients can add a tip before confirming. Tips can be turned off in booking settings.</dd></div>
        </dl>
      </div>
      <figure className={styles.productFeatureImage}>
        <Image src="/marketing-preview/shop-mobile.png" width={368} height={751} alt="Fade Mechanic's branded ClipWise shop page with services and Book now buttons" loading="lazy" />
        <figcaption>Fade Mechanic · sample shop page</figcaption>
      </figure>
    </div>
  );

  if (id === "clients") return (
    <div className={styles.productFeatureShowcase}>
      <div className={styles.productFeatureStory}>
        <p className={styles.panelEyebrow}>CLIENT PROFILES</p>
        <h3 id={headingId}>Remember the details behind every cut.</h3>
        <p>Keep visit history and practical preferences with a client profile, so the team can pick up where the last appointment left off.</p>
        <dl>
          <div><dt>Hair Profile</dt><dd>Save top and sides guard numbers, fade type, beard style, products and style notes.</dd></div>
          <div><dt>Shared with the team</dt><dd>Saved profiles are visible to barbers at the shop, alongside client history and notes.</dd></div>
          <div><dt>Useful context, at a glance</dt><dd>Review past appointments and client details from the client record.</dd></div>
        </dl>
      </div>
      <div className={styles.hairProfileDemo} aria-label="Illustration of a saved client Hair Profile">
        <div className={styles.hairProfileTop}><span className={styles.hairProfileAvatar}>JM</span><span><strong>Jordan M.</strong><small>Client profile · sample data</small></span><span className={styles.hairProfileLabel}>HAIR PROFILE</span></div>
        <div className={styles.hairProfileFields}>
          <div><small>TOP · GUARD #</small><strong>4</strong></div><div><small>SIDES · GUARD #</small><strong>1.5</strong></div>
          <div><small>FADE TYPE</small><strong>Mid fade</strong></div><div><small>BEARD</small><strong>Shape up</strong></div>
        </div>
        <div className={styles.hairProfileNote}><small>STYLE NOTES</small><p>Deep part on the left. Leave length on top; textured finish.</p></div>
        <p className={styles.hairProfileDisclaimer}>Illustrative profile · Sample details</p>
      </div>
    </div>
  );

  return (
    <div className={styles.productFeatureShowcase}>
      <div className={styles.productFeatureStory}>
        <p className={styles.panelEyebrow}>AFTER THE APPOINTMENT</p>
        <h3 id={headingId}>Keep the conversation going.</h3>
        <p>Send a review request after a visit, or follow up when a client misses an appointment.</p>
        <dl>
          <div><dt>Review requests</dt><dd>After a visit is completed, an email can invite the client to review the shop. A next-day reminder covers eligible visits that were not marked complete.</dd></div>
          <div><dt>No-show follow-up</dt><dd>When a no-show fee is not charged, the shop can send a warm email with a link to book again.</dd></div>
          <div><dt>Card on file, when enabled</dt><dd>Shops can require a card for no-show protection. For pay-at-shop bookings, the saved card is used if a no-show fee applies.</dd></div>
        </dl>
      </div>
      <div className={styles.followupDemo} aria-label="Illustration of customer follow-up emails">
        <div className={styles.followupEmail}>
          <div className={styles.followupEmailHeader}><span>CLIPWISE</span><span>Sample email</span></div>
          <p className={styles.followupEmailEyebrow}>AFTER YOUR VISIT</p><strong>How was your visit, Jordan?</strong>
          <p>Thanks for visiting Fade Mechanic. Your feedback helps the shop and other clients.</p>
          <span className={styles.followupEmailButton}>Leave a review</span>
        </div>
        <div className={styles.followupEmailSecondary}>
          <div className={styles.followupEmailHeader}><span>FADE MECHANIC</span><span>Sample email</span></div>
          <p className={styles.followupEmailEyebrow}>MISSED APPOINTMENT</p><strong>We missed you, Jordan.</strong>
          <p>Life happens. Choose a time that works and book again.</p>
          <span className={styles.followupEmailButton}>Book again</span>
        </div>
        <p className={styles.hairProfileDisclaimer}>Illustrative email previews · Sample copy</p>
      </div>
    </div>
  );
}

export function ProductShowcase() {
  const [activeTab, setActiveTab] = useState<TabId>("calendar");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const mobileTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number, refs: typeof tabRefs) {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index + tabs.length - 1) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    setActiveTab(tabs[nextIndex].id);
    refs.current[nextIndex]?.focus();
  }

  return (
    <section id="product" className={styles.product} aria-labelledby="product-title">
      <div className={styles.sectionHead}>
        <p className={styles.eyebrow}>Made for the pace of the shop</p>
        <h2 id="product-title">Your day, at a glance.</h2>
        <p className={styles.sectionIntro}>A clear view of appointments, payments and how your shop is doing.</p>
      </div>
      <div className={styles.showcase}>
        <p className={styles.demoNotice}>Product preview · Sample data and app screenshots</p>
        <div className={styles.showcaseDesktop}>
          <div className={styles.showcaseTabs} role="tablist" aria-label="Product examples">
          {tabs.map(({ id, label, icon: Icon }, index) => (
              <button key={id} ref={node => { tabRefs.current[index] = node; }} id={`showcase-tab-${id}`} type="button" role="tab" aria-selected={activeTab === id} aria-controls="showcase-panel-active" tabIndex={activeTab === id ? 0 : -1} onClick={() => setActiveTab(id)} onKeyDown={event => onTabKeyDown(event, index, tabRefs)}>
                <Icon size={17} strokeWidth={1.8} aria-hidden="true" />{label}
              </button>
            ))}
          </div>
          <section id="showcase-panel-active" className={styles.showcasePanel} role="tabpanel" aria-labelledby={`showcase-tab-${activeTab}`}>
            <PanelContent id={activeTab} />
          </section>
          <a className={styles.panelAction} href={tabs.find(tab => tab.id === activeTab)!.href}>{tabs.find(tab => tab.id === activeTab)!.action}<span aria-hidden="true">→</span></a>
        </div>
        <div className={styles.showcaseMobile}>
          <div className={styles.showcaseTabs} role="tablist" aria-label="Product examples">
            {tabs.map(({ id, label, icon: Icon }, index) => (
              <button key={id} ref={node => { mobileTabRefs.current[index] = node; }} id={`showcase-mobile-tab-${id}`} type="button" role="tab" aria-selected={activeTab === id} aria-controls="showcase-panel-mobile-active" tabIndex={activeTab === id ? 0 : -1} onClick={() => setActiveTab(id)} onKeyDown={event => onTabKeyDown(event, index, mobileTabRefs)}>
                <Icon size={16} strokeWidth={1.8} aria-hidden="true" />{label}
              </button>
            ))}
          </div>
          <section id="showcase-panel-mobile-active" className={styles.showcasePanel} role="tabpanel" aria-labelledby={`showcase-mobile-tab-${activeTab}`}>
            <PanelContent id={activeTab} headingId={`mobile-panel-title-${activeTab}`} />
            <a className={styles.panelAction} href={tabs.find(tab => tab.id === activeTab)!.href}>{tabs.find(tab => tab.id === activeTab)!.action}<span aria-hidden="true">→</span></a>
          </section>
        </div>
      </div>
    </section>
  );
}

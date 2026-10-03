"use client";

import { useRef, useState } from "react";
import { BarChart3, CalendarDays, CreditCard } from "lucide-react";
import styles from "./page.module.css";

const tabs = [
  { id: "calendar", label: "Calendar", icon: CalendarDays, href: "https://clipwise.ca/online-booking", action: "Explore online booking" },
  { id: "payments", label: "Payments", icon: CreditCard, href: "https://clipwise.ca/payments", action: "Explore payments" },
  { id: "reports", label: "Reports", icon: BarChart3, href: "https://clipwise.ca/features", action: "Explore ClipWise features" },
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

const transactions = [
  { time: "12:06 PM", name: "Alex", service: "Skin Fade", method: "Card", amount: 42.5 },
  { time: "11:42 AM", name: "Jordan", service: "Haircut & Beard", method: "Cash", amount: 36 },
  { time: "11:18 AM", name: "Sam", service: "Buzz Cut", method: "Card", amount: 28 },
  { time: "10:54 AM", name: "Taylor", service: "Skin Fade", method: "Card", amount: 42.5 },
];

const dailySales = [
  { day: "Mon", amount: 246, height: 49 },
  { day: "Tue", amount: 318, height: 64 },
  { day: "Wed", amount: 286, height: 58 },
  { day: "Thu", amount: 402, height: 81 },
  { day: "Fri", amount: 495, height: 100 },
  { day: "Sat", amount: 438, height: 88 },
  { day: "Sun", amount: 174, height: 35 },
];

const money = (amount: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(amount);

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
    <>
      <div className={styles.panelHeading}><div><p className={styles.panelEyebrow}>Sample day · CAD</p><h3 id={headingId}>Payments received</h3></div><span className={styles.panelTotal}>{money(149)}</span></div>
      <div className={styles.paymentBreakdown} aria-label="Demo payment breakdown: 113 dollars by card and 36 dollars cash">
        <span><i className={styles.cardSegment} />Card <b>{money(113)}</b></span><span><i className={styles.cashSegment} />Cash <b>{money(36)}</b></span>
      </div>
      <div className={styles.transactionList}>
        {transactions.map(transaction => (
          <div className={styles.transactionRow} key={`${transaction.time}-${transaction.name}`}>
            <span className={styles.transactionTime}>{transaction.time}</span>
            <div className={styles.transactionInfo}><strong>{transaction.name}</strong><span>{transaction.service}</span></div>
            <span className={styles.transactionMethod}>{transaction.method}</span>
            <b className={styles.transactionAmount}>{money(transaction.amount)}</b>
          </div>
        ))}
      </div>
    </>
  );

  return (
    <>
      <div className={styles.panelHeading}><div><p className={styles.panelEyebrow}>Sample week · CAD</p><h3 id={headingId}>Sales by day</h3></div><span className={styles.panelTotal}>{money(2359)}</span></div>
      <div className={styles.salesChart} role="img" aria-label="Illustrative weekly sales: Monday 246 dollars, Tuesday 318, Wednesday 286, Thursday 402, Friday 495, Saturday 438, Sunday 174 Canadian dollars">
        {dailySales.map(day => <div className={styles.chartColumn} key={day.day}><span>{money(day.amount)}</span><div className={styles.chartTrack}><i style={{ height: `${day.height * 1.2}px` }} /></div><b>{day.day}</b></div>)}
      </div>
      <p className={styles.chartFootnote}>A simple view of sales across the week.</p>
    </>
  );
}

export function ProductShowcase() {
  const [activeTab, setActiveTab] = useState<TabId>("calendar");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index + tabs.length - 1) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    setActiveTab(tabs[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <section id="product" className={styles.product} aria-labelledby="product-title">
      <div className={styles.sectionHead}>
        <p className={styles.eyebrow}>Made for the pace of the shop</p>
        <h2 id="product-title">Your day, at a glance.</h2>
        <p className={styles.sectionIntro}>A clear view of appointments, payments and how your shop is doing.</p>
      </div>
      <div className={styles.showcase}>
        <p className={styles.demoNotice}>Illustrative demo data</p>
        <div className={styles.showcaseDesktop}>
          <div className={styles.showcaseTabs} role="tablist" aria-label="Product examples">
          {tabs.map(({ id, label, icon: Icon }, index) => (
              <button key={id} ref={node => { tabRefs.current[index] = node; }} id={`showcase-tab-${id}`} type="button" role="tab" aria-selected={activeTab === id} aria-controls="showcase-panel-active" tabIndex={activeTab === id ? 0 : -1} onClick={() => setActiveTab(id)} onKeyDown={event => onTabKeyDown(event, index)}>
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
          {tabs.map(({ id, href, action }) => (
            <section className={styles.showcasePanel} key={id} aria-labelledby={`mobile-panel-title-${id}`}>
              <PanelContent id={id} headingId={`mobile-panel-title-${id}`} />
              <a className={styles.panelAction} href={href}>{action}<span aria-hidden="true">→</span></a>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}

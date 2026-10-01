const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const req = Module.createRequire(path.join(root, 'package.json'));
const ts = req('typescript');

function load(file) {
  const filename = path.join(root, file);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.require = id => id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`) : req(id);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename);
  return loaded.exports;
}

const { parseAppointmentNotification, humanizeNotificationMessage } = load('src/lib/notification-presentation.ts');
const moved = parseAppointmentNotification({
  type: 'booking', title: 'Appointment rescheduled',
  message: 'CW Test Customer: Oct 6, 2026 at 11:00 AM → Dec 1, 2026 at 10:00 AM · with Gill',
});
assert.equal(moved.clientName, 'CW Test Customer');
assert.equal(moved.event, 'Appointment rescheduled');
assert.deepEqual(moved.previous, { date: 'Oct 6, 2026', time: '11:00 AM' });
assert.deepEqual(moved.current, { date: 'Dec 1, 2026', time: '10:00 AM' });
assert.equal(moved.barber, 'Gill');
const { NotificationContent } = load('src/components/appointment-notification-content.tsx');
const html = req('react-dom/server').renderToStaticMarkup(req('react').createElement(NotificationContent, {
  summary: moved, title: 'Appointment rescheduled', message: '', icon: null,
  createdAt: '2026-09-30T12:00:00Z', ageLabel: 'Just now', isRead: false,
}));
assert.match(html, /rescheduled · with Gill/);
assert.equal((html.match(/with Gill/g) ?? []).length, 1);
const genericMessage = 'Stock is low for Beard Balm. Current quantity: 2. Reorder when ready.';
const genericHtml = req('react-dom/server').renderToStaticMarkup(req('react').createElement(NotificationContent, {
  title: 'Inventory update', message: genericMessage, icon: req('react').createElement(req('lucide-react').Package, { size: 14 }),
  createdAt: '2026-09-30T12:00:00Z', ageLabel: 'Just now', isRead: true,
}));
assert.match(genericHtml, /Inventory update/);
assert.match(genericHtml, new RegExp(genericMessage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

const customerMoved = parseAppointmentNotification({
  type: 'booking', title: 'Appointment rescheduled',
  message: 'CW Test Customer rescheduled to 2026-10-06 at 13:30 (was 2026-10-01 at 10:00 AM) · with Gill',
});
assert.equal(customerMoved.current.date, load('src/lib/utils.ts').prettyDate('2026-10-06'));
assert.equal(customerMoved.current.time, '1:30 PM');
assert.equal(customerMoved.previous.time, '10:00 AM');

const richBooking = parseAppointmentNotification({
  type: 'booking', title: 'New booking · $16',
  message: 'Cw test booking booked Skin Fade with Gill & paid for October 5 at 9:00 AM',
});
assert.equal(richBooking.clientName, 'Cw test booking');
assert.equal(richBooking.service, 'Skin Fade');
assert.equal(richBooking.barber, 'Gill');
assert.equal(richBooking.amount, '$16');
assert.equal(richBooking.payment, 'Paid');
assert.deepEqual(richBooking.current, { date: 'October 5', time: '9:00 AM' });
const bookingHtml = req('react-dom/server').renderToStaticMarkup(req('react').createElement(NotificationContent, {
  summary: richBooking, title: 'New booking · $16', message: '', icon: null,
  createdAt: '2026-09-30T12:00:00Z', ageLabel: 'Just now', isRead: false,
}));
assert.match(bookingHtml, /New booking · \$16 · with Gill/);
assert.match(bookingHtml, /Skin Fade · Paid/);

// Loyalty / promo discounts ride at the end of new-booking alerts (price-breakdown
// discountSummary) — they must become their own line, never part of the time.
const pointsBooking = parseAppointmentNotification({
  type: 'booking', title: 'New booking · $15.93',
  message: 'Cw test booking booked Skin Fade with Gill & paid for Monday · October 5 at 9:00 AM · 423 pts −$21.15',
});
assert.equal(pointsBooking.amount, '$15.93');
assert.equal(pointsBooking.service, 'Skin Fade');
assert.equal(pointsBooking.payment, 'Paid');
assert.deepEqual(pointsBooking.current, { date: 'Monday · October 5', time: '9:00 AM' });
assert.equal(pointsBooking.discount, '423 pts −$21.15');
const pointsHtml = req('react-dom/server').renderToStaticMarkup(req('react').createElement(NotificationContent, {
  summary: pointsBooking, title: 'New booking · $15.93', message: '', icon: null,
  createdAt: '2026-09-30T12:00:00Z', ageLabel: 'Just now', isRead: false,
}));
assert.match(pointsHtml, /Skin Fade · Paid · 423 pts −\$21\.15/);
assert.doesNotMatch(pointsHtml, /9:00 AM · 423/);

const inShopDiscount = parseAppointmentNotification({
  type: 'booking', title: 'New booking — needs approval',
  message: 'Baljit — Haircut with Gill on Tuesday · October 6 at 10:15 AM · tap to approve · 200 pts −$10.00 · promo SAVE10 −$3.00',
});
assert.equal(inShopDiscount.barber, 'Gill');
assert.equal(inShopDiscount.current.time, '10:15 AM');
assert.equal(inShopDiscount.discount, '200 pts −$10.00 · promo SAVE10 −$3.00');

const promoOnly = parseAppointmentNotification({
  type: 'booking', title: 'New booking',
  message: 'Client Five — Beard Trim on Tomorrow · October 2 at 1:00 PM · promo −$2.50',
});
assert.equal(promoOnly.current.time, '1:00 PM');
assert.equal(promoOnly.discount, 'promo −$2.50');

// Must agree with what the server actually writes.
const { discountSummary } = load('src/lib/price-breakdown.ts');
const written = discountSummary({ loyalty_points: 423, loyalty_discount: 21.15, promo_code: 'SAVE10', promo_discount: 5 });
const roundTrip = parseAppointmentNotification({
  type: 'booking', title: 'New booking · $9.50',
  message: `Client Six booked Skin Fade with Gill (card saved) for October 5 at 9:00 AM · ${written}`,
});
assert.equal(roundTrip.discount, written);
assert.equal(roundTrip.current.time, '9:00 AM');
assert.equal(richBooking.discount, undefined);

const approvalBooking = parseAppointmentNotification({
  type: 'booking', title: 'New booking — needs approval',
  message: 'New client — Beard Trim with Lee on Monday · October 5 at 10:00 AM · tap to approve',
});
assert.equal(approvalBooking.clientName, 'New client');
assert.equal(approvalBooking.service, 'Beard Trim');
assert.equal(approvalBooking.barber, 'Lee');
assert.equal(approvalBooking.payment, undefined);
assert.equal(approvalBooking.amount, undefined);

const noBarberBooking = parseAppointmentNotification({
  type: 'booking', title: 'New booking',
  message: 'Client Two — Skin Fade on Tomorrow · September 19 at 9:00 AM',
});
assert.equal(noBarberBooking.service, 'Skin Fade');
assert.equal(noBarberBooking.barber, undefined);

const simpleBooking = parseAppointmentNotification({
  type: 'booking', title: 'New booking',
  message: 'Client Three booked & paid for September 27 at 9:00 AM',
});
assert.equal(simpleBooking.payment, 'Paid');
assert.equal(simpleBooking.service, undefined);

for (const [verb, expected] of [
  ['(card saved)', 'card saved'],
  ['(card on hold)', 'card on hold'],
  ['(pay at shop · card on file)', 'pay at shop · card on file'],
]) {
  const cardBooking = parseAppointmentNotification({
    type: 'booking', title: 'New booking · $48.10',
    message: `Client Four booked Cut with Gill ${verb} for October 5 at 1:30pm`,
  });
  assert.equal(cardBooking.payment, expected);
  assert.equal(cardBooking.current.time, '1:30 PM');
}

const cancelled = parseAppointmentNotification({
  type: 'cancellation', title: 'Appointment cancelled',
  message: "CW Test Customer cancelled their appointment with Gill (was 2026-10-06 at 11:00 AM)",
});
assert.equal(cancelled.clientName, 'CW Test Customer');
assert.equal(cancelled.event, 'Appointment cancelled by customer');
assert.equal(cancelled.barber, 'Gill');
assert.equal(cancelled.current.time, '11:00 AM');

const serviceCancelled = parseAppointmentNotification({
  type: 'cancellation', title: 'Appointment Cancelled',
  message: "Chris O'Neil's Skin Fade on 2026-10-06 at 9:00 AM was cancelled by customer.",
});
assert.equal(serviceCancelled.clientName, "Chris O'Neil");
assert.equal(serviceCancelled.service, 'Skin Fade');
assert.equal(serviceCancelled.event, 'Appointment cancelled by customer');

const malformedTime = parseAppointmentNotification({
  type: 'booking', title: 'Appointment rescheduled',
  message: 'Fixture: Oct 6, 2026 at 11:00 AM extra → Dec 1, 2026 at 10:00 AM',
});
assert.equal(malformedTime.previous.time, '11:00 AM extra');

assert.equal(parseAppointmentNotification({ type: 'system', title: 'Plan updated', message: 'Your account is ready.' }), null);
assert.equal(parseAppointmentNotification({ type: 'booking', title: 'Appointment rescheduled', message: 'Legacy update without recognized fields' }), null);
const paymentReceived = parseAppointmentNotification({ type: 'booking', title: 'Payment received', message: "Charged CW Client's card $40.25 on completion (Oct 5, 2026)." });
assert.equal(paymentReceived.clientName, 'CW Client');
assert.equal(paymentReceived.amount, '$40.25');
assert.equal(paymentReceived.payment, 'Card charged on completion');
assert.equal(paymentReceived.current.date, 'Oct 5, 2026');
const waitlist = parseAppointmentNotification({ type: 'booking', title: 'Waitlist request', message: 'CW Client is waiting for a spot on Mon, Oct 5' });
assert.equal(waitlist.clientName, 'CW Client');
assert.equal(waitlist.event, 'Waiting for a spot');
assert.equal(waitlist.current.date, 'Mon, Oct 5');
assert.equal(humanizeNotificationMessage('Legacy event on 2026-10-06'), `Legacy event on ${load('src/lib/utils.ts').prettyDate('2026-10-06')}`);
console.log('PASS notification presentation: reschedule/cancel templates, timezone-safe raw date, 12h time, discount line, safe fallback');

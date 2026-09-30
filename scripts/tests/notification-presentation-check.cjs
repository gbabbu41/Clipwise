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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  return loaded.exports;
}

const { parseAppointmentNotification } = load('src/lib/notification-presentation.ts');
const moved = parseAppointmentNotification({
  type: 'booking', title: 'Appointment rescheduled',
  message: 'CW Test Customer: Oct 6, 2026 at 11:00 AM → Dec 1, 2026 at 10:00 AM · with Gill',
});
assert.equal(moved.clientName, 'CW Test Customer');
assert.equal(moved.event, 'Appointment rescheduled');
assert.deepEqual(moved.previous, { date: 'Oct 6, 2026', time: '11:00 AM' });
assert.deepEqual(moved.current, { date: 'Dec 1, 2026', time: '10:00 AM' });
assert.equal(moved.barber, 'Gill');

const customerMoved = parseAppointmentNotification({
  type: 'booking', title: 'Appointment rescheduled',
  message: 'CW Test Customer rescheduled to 2026-10-06 at 13:30 (was 2026-10-01 at 10:00 AM) · with Gill',
});
assert.equal(customerMoved.current.date, load('src/lib/utils.ts').prettyDate('2026-10-06'));
assert.equal(customerMoved.current.time, '1:30 PM');
assert.equal(customerMoved.previous.time, '10:00 AM');

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
console.log('PASS notification presentation: reschedule/cancel templates, timezone-safe raw date, 12h time, safe fallback');

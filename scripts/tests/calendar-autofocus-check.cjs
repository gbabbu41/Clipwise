const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), appReq = Module.createRequire(path.join(root, 'package.json')), ts = appReq('typescript');
const filename = path.join(root, 'src/lib/calendar-autofocus.ts'), m = new Module(filename, module);
m.filename = filename; m.require = appReq;
m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { calendarLandingHour, fullDayCalendarWindow, calendarFocusTop, calendarHourOffset, startCalendarAutofocus } = m.exports;
assert.equal(calendarHourOffset(12, 7, 24, 17 * 62), 5 * 62);
assert.equal(calendarHourOffset(12, 0, 24, 24 * 62), 12 * 62);
assert.equal(calendarHourOffset(6.5, 6, 24, 18 * 62), 31);
assert.equal(calendarHourOffset(2, 7, 24, 1054), 0);
assert.equal(calendarHourOffset(25, 7, 24, 1054), 1054);
assert.equal(calendarHourOffset(NaN, 7, 24, 1054), 0);

// Exercise the actual grid-start selector, not a parallel test implementation.
const viewSource = fs.readFileSync(path.join(root, 'src/components/calendar-view.tsx'), 'utf8');
const viewAst = ts.createSourceFile('calendar.tsx', viewSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let gridExpression;
function findGrid(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(viewAst) === 'gridStartHour') gridExpression = node.initializer.getText(viewAst);
  ts.forEachChild(node, findGrid);
}
findGrid(viewAst); assert(gridExpression);
const gridCode = ts.transpileModule('const action = ' + gridExpression, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + ';return action;';
function earliest(appointments = [], extra = {}) {
  const env = { view: 'day', appointments, weeklyHours: [], dismissedFreed: new Set(), parseTime: Number, timeToMinutes: t => Number(t) * 60,
    apptDuration: a => a.duration || 30, freesSlot: a => ['cancelled', 'no-show'].includes(a.status), hourOfDb: Number,
    blocksFor: () => [], unavailBandsFor: () => [], ...extra };
  return new Function(...Object.keys(env), gridCode)(...Object.values(env))(['2026-10-01'], ['b']);
}
const early = { id: 'early', date: '2026-10-01', barber_id: 'b', time_slot: '6', status: 'confirmed' };
assert.equal(earliest(), undefined);
assert.equal(earliest([early]), 6);
assert.equal(earliest([{ ...early, status: 'cancelled' }]), 6);
assert.equal(earliest([{ ...early, status: 'no-show' }]), 6);
assert.equal(earliest([{ ...early, status: 'cancelled' }], { view: 'multiday' }), undefined, 'unrendered multiday reminder does not unlock empty hours');
assert.equal(earliest([{ ...early, status: 'cancelled' }], { dismissedFreed: new Set(['early']) }), undefined);
assert.equal(earliest([{ ...early, status: 'cancelled' }, { ...early, id: 'replacement' }]), 6);
assert.equal(earliest([{ ...early, time_slot: '6.75', status: 'cancelled', duration: 60 }, { ...early, id: 'replacement', time_slot: '7' }]), 7, 'hidden rebooked reminder must not expose empty early rail');
assert.equal(earliest([{ ...early, barber_id: 'other' }]), undefined);
assert.equal(earliest([], { blocksFor: () => [{ startMin: 330 }] }), 5.5);
assert.equal(earliest([], { unavailBandsFor: () => [{ startMin: 360, fullDay: false }] }), 6);
assert.equal(earliest([], { unavailBandsFor: () => [{ startMin: 0, fullDay: true }] }), undefined);

const modalSource = fs.readFileSync(path.join(root, 'src/components/dashboard/add-appointment-modal.tsx'), 'utf8');
const slotStart = modalSource.indexOf('  const slotStatuses ='), slotEnd = modalSource.indexOf('  const anyFree', slotStart);
const slotCode = ts.transpileModule(modalSource.slice(slotStart, slotEnd), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + ';return slotStatuses;';
const slotEnv = { useMemo: fn => fn(), date: '2099-01-01', formatDateForDb: () => '2026-01-01', TIME_OPTIONS: ['23.5', '23.75'], timeToMinutes: t => Number(t) * 60, slotDuration: 30, avail: null };
const slots = new Function(...Object.keys(slotEnv), slotCode)(...Object.values(slotEnv));
assert.equal(slots.get('23.5').disabled, false, 'ending exactly at midnight fits');
assert.equal(slots.get('23.75').disabled, true, 'overnight tail rejected even before availability loads');

const routeSource = fs.readFileSync(path.join(root, 'src/app/api/book/in-person/route.ts'), 'utf8');
const boundaryStart = routeSource.indexOf('  const startMin = timeToMinutes(b.time_slot);');
const boundaryEnd = routeSource.indexOf('  // Resolve barber', boundaryStart);
const boundaryCode = ts.transpileModule(routeSource.slice(boundaryStart, boundaryEnd), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const boundary = new Function('b', 'charge', 'timeToMinutes', 'NextResponse', boundaryCode);
const response = { json: (body, options) => ({ ...body, ...options }) };
assert.equal(boundary({ time_slot: 1410 }, { duration: 30 }, Number, response), undefined);
assert.equal(boundary({ time_slot: 1425 }, { duration: 30 }, Number, response).status, 400);
assert.equal(boundary({ time_slot: NaN }, { duration: 30 }, Number, response).status, 400);
assert.equal(calendarLandingHour(true, 22.5, [5, 9]), 22.5);
assert.equal(calendarLandingHour(false, 22.5, []), 7);
assert.equal(calendarLandingHour(false, 22.5, [9, 10]), 7);
assert.equal(calendarLandingHour(false, 22.5, [6.5, 9]), 6.5);
assert.equal(calendarLandingHour(false, 22.5, [0, 6]), 0);
assert.equal(calendarLandingHour(false, 22.5, [NaN, -1, 25]), 7);
// Morning starts are near the top, not centred several hours earlier.
assert.equal(calendarFocusTop(7 * 62 + 400 / 2 - 8, 400, 1488), 426);
// Default top is 7 AM (no empty pre-dawn hours); bottom stays midnight.
const dayWindow = fullDayCalendarWindow();
assert.equal(dayWindow.winStart, 7); assert.equal(dayWindow.winEnd, 24);
assert.deepEqual(dayWindow.hours, Array.from({ length: 17 }, (_, i) => i + 7));
// Extends earlier ONLY for an early appointment/shift (floored); never later than 7.
assert.equal(fullDayCalendarWindow(6).winStart, 6);
assert.equal(fullDayCalendarWindow(5.5).winStart, 5);
assert.equal(fullDayCalendarWindow(9).winStart, 7);
assert.equal(fullDayCalendarWindow(0).winStart, 0);
for (const hour of [0, 7, 12, 21.99, 22, 23.99, 24]) {
  assert.equal(calendarFocusTop(hour * 62, 400, 24 * 62), Math.max(0, Math.min(1088, hour * 62 - 200)));
}
class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  fire(type) { for (const fn of [...(this.listeners.get(type) || [])]) fn(); }
  count() { return [...this.listeners.values()].reduce((n, set) => n + set.size, 0); }
}
let clock, queued, id, host, scroller, el, doc, win, target, ready, writes, rect;
function reset() {
  clock = 0; queued = new Map(); id = 0; writes = []; target = 929; ready = true;
  global.performance = { now: () => clock };
  global.requestAnimationFrame = fn => { queued.set(++id, fn); return id; };
  global.cancelAnimationFrame = n => queued.delete(n);
  doc = global.document = new Target(); doc.hidden = false; win = global.window = new Target();
  host = new Target(); scroller = new Target(); let scrollTop = 0;
  rect = { top: 100, left: 0, width: 390, height: 400 };
  el = { closest: () => host, isConnected: true, clientHeight: 400, scrollHeight: 930,
    addEventListener: (...args) => scroller.addEventListener(...args), removeEventListener: (...args) => scroller.removeEventListener(...args),
    getBoundingClientRect: () => rect,
    get scrollTop() { return scrollTop; }, set scrollTop(v) { writes.push(v); scrollTop = v; scroller.fire('scroll'); } };
}
function tick(delta = 16) { clock += delta; const work = [...queued.values()]; queued.clear(); work.forEach(fn => fn(clock)); }
function settle() { for (let i = 0; i < 8; i++) tick(); }
function begin() { return startCalendarAutofocus(el, () => ready ? target : null); }
// A 7am–10pm grid at 62px/hour, including the late-night boundary.
for (const [hour, expected] of [[7, 0], [12, 110], [21.99, 530], [22, 530], [23, 530]]) {
  const point = (Math.max(7, Math.min(22, hour)) - 7) * 62;
  assert.equal(calendarFocusTop(point, 400, 930), expected);
}
assert.equal(calendarFocusTop(100, 1000, 930), 0);
reset(); begin(); settle(); assert.deepEqual(writes, [530]); target = 400; settle(); assert.deepEqual(writes, [530]);
assert.equal(host.count() + scroller.count() + doc.count() + win.count() + queued.size, 0);
for (const event of ['touchstart', 'touchmove', 'pointerdown', 'wheel', 'keydown', 'scroll']) {
  reset(); begin(); tick(); (event === 'scroll' ? scroller : host).fire(event); settle(); assert.equal(writes.length, 0, event); assert.equal(queued.size, 0);
}
reset(); begin(); host.fire('scroll'); settle(); assert.equal(writes.length, 1); // date-rail auto-scroll cannot cancel the timeline
reset(); ready = false; begin(); settle(); assert.equal(writes.length, 0); ready = true; settle(); assert.equal(writes.length, 1);
reset(); ready = false; begin(); host.fire('touchstart'); ready = true; settle(); assert.equal(writes.length, 0);
reset(); begin(); tick(); rect.top += 20; tick(); rect.top += 10; tick(); assert.equal(writes.length, 0); settle(); assert.equal(writes.length, 1);
for (const end of ['hidden', 'pagehide', 'detach', 'cleanup', 'timeout']) {
  reset(); const stop = begin(); tick();
  if (end === 'hidden') { doc.hidden = true; doc.fire('visibilitychange'); doc.hidden = false; }
  if (end === 'pagehide') win.fire('pagehide');
  if (end === 'detach') el.isConnected = false;
  if (end === 'cleanup') stop();
  if (end === 'timeout') tick(6000);
  settle(); assert.equal(writes.length, 0, end); assert.equal(queued.size + host.count() + doc.count() + win.count(), 0, end);
}
reset(); target = 0; begin(); settle(); assert.equal(writes.length, 0); // non-today already at top: no write
reset(); doc.hidden = true; begin(); doc.hidden = false; settle(); assert.equal(writes.length, 0); assert.equal(queued.size, 0);
reset(); el.clientHeight = 0; begin(); settle(); assert.equal(writes.length, 0); el.clientHeight = 400; settle(); assert.equal(writes.length, 1);
// A full-day late-night focus leaves the timeline entirely under user control.
reset(); el.scrollHeight = 24 * 62; target = 23.99 * 62; begin(); settle();
assert.deepEqual(writes, [1088]); el.scrollTop = 500; settle(); assert.deepEqual(writes, [1088, 500]);
const source = fs.readFileSync(path.join(root, 'src/components/calendar-view.tsx'), 'utf8');
assert.equal((source.match(/data-calendar-time-grid data-start-hour/g) || []).length, 2);
assert.equal((source.match(/data-focus-key=\{focusKey\}/g) || []).length, 2);
assert(!source.includes('lastProgScrollRef')); assert(!source.includes('[50, 400]'));
assert(source.includes('onAnimationComplete')); assert(source.includes('el.dataset.focusKey !== focusKey'));
assert.equal((source.match(/const \{ winStart, winEnd, hours \} = fullDayCalendarWindow\(/g) || []).length, 2);
assert(!source.includes('Math.max(winEnd, 22)'));
assert(source.includes('const multiDayCount = 3;'));
assert(source.includes('data-landing-align={anyToday ? "center" : "start"}'));
assert(source.includes('!focusStateRef.current.hoursReady'));
assert(source.includes('aria-label="Scroll to current time"'));
assert(source.includes('const currentH = shopHour;'));
for (const file of ['src/app/dashboard/layout-client.tsx', 'src/app/barber-dashboard/layout.tsx']) {
  const layout = fs.readFileSync(path.join(root, file), 'utf8');
  assert(layout.includes('fixed inset-0 h-[100dvh] flex flex-col overflow-hidden'));
  assert(layout.includes('contained={isCalendar}'));
}
console.log('PASS calendar one-shot focus, late-night bounds, user takeover without grace period, loading/animation geometry, background/detach cleanup and day/multiday integration');

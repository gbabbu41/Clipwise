const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'src/components/calendar-view.tsx'), 'utf8');
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const helperExports = {};
new Function('exports', compile(fs.readFileSync(path.join(root, 'src/lib/calendar-workflow.ts'), 'utf8')))(helperExports);
const { calendarEditTotals, requestCalendarAddContext } = helperExports;
const appt = { id: 'fixture', service_id: 'cut', duration_minutes: 60, total_amount: 80, date: '2026-10-01' };
const services = [{ id: 'cut', duration_minutes: 30, price: 40 }, { id: 'beard', duration_minutes: 15, price: 20 }];
assert.deepEqual(calendarEditTotals(appt, ['cut'], services, 30), { changed: false, duration: 60, price: 80 });
assert.deepEqual(calendarEditTotals(appt, ['cut', ''], services, 30), { changed: false, duration: 60, price: 80 });
assert.deepEqual(calendarEditTotals(appt, ['cut', 'beard'], services, 30), { changed: true, duration: 45, price: 60 });
assert.equal(calendarEditTotals({ ...appt, duration_minutes: null }, ['cut'], services, 45).duration, 45);
global.CustomEvent = class { constructor(type, { detail }) { this.type = type; this.detail = detail; } };
global.window = { dispatchEvent(event) { assert.equal(event.type, 'cw-calendar-add-context'); event.detail.date = '2026-10-01'; event.detail.barberId = 'barber'; } };
assert.deepEqual(requestCalendarAddContext('shop'), { shopId: 'shop', date: '2026-10-01', barberId: 'barber' });
global.window.dispatchEvent = () => {};
assert.deepEqual(requestCalendarAddContext('other-shop'), { shopId: 'other-shop' });

// Execute the actual action factory with synthetic HTTP responses; no real writes.
const ast = ts.createSourceFile('calendar.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const factory = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === 'makeApptActions');
const exportsObject = {};
new Function('exports', compile(factory.getText(ast)))(exportsObject);
const response = (ok, data) => ({ ok, json: async () => data });
let patched, busy;
const options = { shop: { id: 'shop' }, accessToken: 'fixture-token', patch: (id, fields) => { patched = fields; }, setBusy: value => { busy = value; }, toast() {}, onDone() {}, confirm: async () => false };

// Execute the actual save handler so failures must preserve edit mode/draft.
const start = source.indexOf('  const saveEdit = async () => {');
const end = source.indexOf('  const duration = apptDuration(appt);', start);
const handlerSource = compile(source.slice(start, end));
function editor(action) {
  const state = { mode: true, saving: false, error: '', ref: { current: false } };
  const draft = { client_name: 'Fixture', client_phone: '', client_email: '', date: '2026-10-02', time: '9:00 AM', barber_id: 'barber', service_ids: ['cut'] };
  const env = { editSavingRef: state.ref, busy: '', editForm: draft, contactLocked: true, appt, services, svcById: id => services.find(s => s.id === id), actions: { edit: action }, setEditSaving: v => { state.saving = v; }, setEditError: v => { state.error = v; }, setEditMode: v => { state.mode = v; } };
  const save = new Function(...Object.keys(env), `${handlerSource}; return saveEdit;`)(...Object.values(env));
  return { state, draft, save };
}
(async () => {
  const actions = exportsObject.makeApptActions(options);
  global.fetch = async () => response(false, { error: 'Slot already booked' });
  assert.equal((await actions.edit(appt, { date: '2026-10-02' })).ok, false);
  assert.equal(patched, undefined); assert.equal(busy, '');
  global.fetch = async () => { throw new Error('offline'); };
  assert.equal((await actions.edit(appt, { date: '2026-10-02' })).ok, false);
  global.fetch = async () => response(false, { blocked: true });
  assert.equal((await actions.edit(appt, { date: '2026-10-02' })).ok, false);
  global.fetch = async () => response(true, { applied: { date: '2026-10-02' } });
  assert.equal((await actions.edit(appt, { date: '2026-10-02' })).ok, true);
  assert.equal(patched.date, '2026-10-02');
  assert.equal((await exportsObject.makeApptActions({ ...options, accessToken: null }).edit(appt, {})).ok, false);
  let finish, calls = 0;
  const pending = editor(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const saving = pending.save();
  await pending.save(); assert.equal(calls, 1); assert.equal(pending.state.mode, true); assert.equal(pending.state.saving, true);
  finish({ ok: false, error: 'Conflict—choose another time' }); await saving;
  assert.equal(pending.state.mode, true); assert.equal(pending.state.saving, false); assert.match(pending.state.error, /Conflict/); assert.equal(pending.draft.date, '2026-10-02');
  const failed = editor(async () => { throw new Error('offline'); }); await failed.save(); assert.equal(failed.state.mode, true); assert.match(failed.state.error, /connection/);
  const success = editor(async () => ({ ok: true })); await success.save(); assert.equal(success.state.mode, false);
  // Run the actual snapshot-commit block: no partial data on any failed read,
  // and an old response cannot clear an error belonging to the latest request.
  const loadStart = source.indexOf('    try {\n      const [{ data: appts');
  const loadEnd = source.indexOf('  }, [shop, currentDate', loadStart);
  const loadCode = compile(`async function snapshot() { ${source.slice(loadStart, loadEnd)} }`);
  async function snapshot(failIndex, stale = false, reject = false) {
    const state = { appointments: ['previous'], error: 'previous error', loading: true };
    const results = [0, 1, 2, 3].map(index => ({ data: [index], error: index === failIndex ? { message: 'offline' } : null }));
    const chain = { select() { return this; }, eq() { return this; }, order() { return Promise.resolve(results[1]); } };
    const env = { q: reject ? Promise.reject(new Error('offline')) : Promise.resolve(results[0]), blocksQ: Promise.resolve(results[2]), fullOffQ: Promise.resolve(results[3]), supabase: { from: () => chain }, shop: { id: 'shop' }, seq: 1, loadSeqRef: { current: stale ? 2 : 1 }, setAppointments: v => { state.appointments = v; }, setBarbers: v => { state.barbers = v; }, setBlocks: v => { state.blocks = v; }, setFullDayOff: v => { state.timeOff = v; }, setLoadError: v => { state.error = v; }, setLoading: v => { state.loading = v; } };
    await new Function(...Object.keys(env), `${loadCode}; return snapshot();`)(...Object.values(env));
    return state;
  }
  for (let index = 0; index < 4; index++) {
    const failedRead = await snapshot(index);
    assert.deepEqual(failedRead.appointments, ['previous']); assert.equal(failedRead.barbers, undefined); assert.match(failedRead.error, /couldn't refresh/); assert.equal(failedRead.loading, false);
  }
  assert.deepEqual((await snapshot(-1, false, true)).appointments, ['previous']);
  const staleRead = await snapshot(-1, true); assert.equal(staleRead.error, 'previous error'); assert.equal(staleRead.loading, true);
  const goodRead = await snapshot(-1); assert.deepEqual(goodRead.appointments, [0]); assert.deepEqual(goodRead.timeOff, [3]); assert.equal(goodRead.error, '');
  // Exercise the actual weekly-hours query and mapping without a live database.
  const hoursStart = source.indexOf('    if (!shop || barbers.length === 0) { setSchedules');
  const hoursEnd = source.indexOf('    // Recurring breaks', hoursStart);
  const hoursCode = compile(`function readHours() { ${source.slice(hoursStart, hoursEnd)} }`);
  for (const error of [null, { message: 'unavailable' }]) {
    const rows = [{ barber_id: 'one', day_of_week: 1, start_time: '06:00', end_time: '18:00' }, { barber_id: 'one', day_of_week: 2, start_time: '05:00', end_time: '18:00' }];
    const state = {}, calls = [];
    const query = { select(value) { calls.push(['select', value]); return this; }, in(key, ids) { calls.push(['in', key, ids]); return this; }, eq(key, value) { calls.push(['eq', key, value]); return this; }, then(callback) { callback({ data: error ? null : rows, error }); } };
    const env = { shop: { id: 'shop' }, barbers: [{ id: 'one' }], currentDate: new Date('2026-09-21T12:00:00'), supabase: { from: () => query }, setSchedules: value => { state.schedules = value; }, setWeeklyHours: value => { state.week = value; }, setHoursReady: value => { state.ready = value; } };
    new Function(...Object.keys(env), `${hoursCode}; readHours();`)(...Object.values(env));
    assert(calls.some(call => call[0] === 'in' && call[1] === 'barber_id' && call[2][0] === 'one'));
    assert(!calls.some(call => call[0] === 'eq' && call[1] === 'day_of_week'));
    assert.equal(state.ready, true); assert.equal(state.week.length, error ? 0 : 2);
    if (!error) assert.equal(state.schedules.get('one').start, '06:00');
  }
  assert.match(source, /apptsErr \|\| barbersErr \|\| blocksErr \|\| timeOffErr/);
  assert.match(source, /seq === loadSeqRef.current\) setLoadError/);
  assert.match(source, /Retry calendar/);
  assert.match(source, /if \(embedded \|\| !shop\) return/);
  assert.match(source, /detail.shopId !== shop.id/);
  console.log('PASS calendar workflow: booked totals, mobile context, save failures/conflicts/override rejection, retained drafts, duplicate-save guard, success, loading-state guards');
})().catch(error => { console.error(error); process.exitCode = 1; });

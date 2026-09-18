const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'src/components/waitlist-assign-sheet.tsx'), 'utf8');
const handler = source.slice(source.indexOf('  const book = async'), source.indexOf('\n  return (', source.indexOf('  const book = async')));
const ok = () => new Response(JSON.stringify({ ok: true, appointment_id: 'saved' }));
function setup(fetcher = async () => ok(), overrides = {}) {
  const state = { busy: false, uncertain: false, errors: [], done: [], closed: 0, calls: [] };
  const env = { barberId: 'barber', slot: '10:00 AM', busy: false, services: [], serviceId: 'service', accessToken: 'valid', request: { id: 'waiter' }, onBook: null,
    bookingInFlight: { current: false }, bookingBlocked: { current: false },
    setBusy: value => { state.busy = value; }, setUncertain: value => { state.uncertain = value; }, setErr: value => state.errors.push(value), onDone: value => state.done.push(value), close: () => state.closed++,
    fetch: async (...args) => { state.calls.push(args); return fetcher(...args); }, ...overrides };
  return { state, env, book: new Function(...Object.keys(env), `${handler}; return book;`)(...Object.values(env)) };
}
(async () => {
  for (const fetcher of [async () => { throw Error('offline'); }, async () => new Response('{}', { status: 503 }), async () => new Response('broken'), async () => new Response('{}'), async () => new Response('null')]) {
    const p = setup(fetcher); await p.book(); assert.equal(p.state.busy, false); assert.equal(p.state.uncertain, true); assert.equal(p.env.bookingInFlight.current, false); assert.equal(p.state.closed, 0); assert.deepEqual(p.state.done, []); assert.match(p.state.errors.at(-1), /may already be booked/);
    await p.book(); assert.equal(p.state.calls.length, 1, 'uncertain result must not resubmit');
  }
  let release; const p = setup(() => new Promise(resolve => { release = resolve; })); const pending = p.book(); await p.book(); assert.equal(p.state.calls.length, 1); assert.equal(p.state.busy, true); release(ok()); await pending;
  assert.equal(p.state.busy, false); assert.equal(p.state.closed, 1); assert.deepEqual(p.state.done, ['Booked · waitlist cleared']); await p.book(); assert.equal(p.state.calls.length, 1, 'successful closing sheet must not resubmit');
  assert.equal(p.state.calls[0][1].headers.Authorization, 'Bearer valid'); assert.deepEqual(JSON.parse(p.state.calls[0][1].body), { waitlist_id: 'waiter', barber_id: 'barber', time_slot: '10:00 AM', service_id: 'service' });
  const denied = setup(async () => new Response(JSON.stringify({ error: 'That slot was just taken' }), { status: 409 })); await denied.book(); assert.equal(denied.state.busy, false); assert.equal(denied.state.uncertain, false); assert.equal(denied.state.closed, 0); await denied.book(); assert.equal(denied.state.calls.length, 2);
  for (const result of [null, 'Select a service', undefined, Error('offline')]) {
    let calls = 0; const p = setup(undefined, { onBook: async () => { calls++; if (result instanceof Error) throw result; return result; } }); await p.book(); assert.equal(p.state.busy, false);
    if (result === null) { assert.equal(p.state.closed, 1); assert.deepEqual(p.state.done, ['Assigned · added to the schedule']); }
    else { assert.equal(p.state.closed, 0); assert.equal(p.state.uncertain, typeof result !== 'string'); }
    if (typeof result !== 'string') { await p.book(); assert.equal(calls, 1); }
  }
  for (const overrides of [{ barberId: null }, { slot: null }, { services: [{}], serviceId: null }]) { const p = setup(undefined, overrides); await p.book(); assert.equal(p.state.calls.length, 0); }
  // Exercise both actual walk-in callbacks; uncertain replies must reach the
  // shared sheet as exceptions, not false success or ordinary retryable errors.
  for (const [file, name] of [['src/app/dashboard/waitlist/page.tsx', 'seatWalkin'], ['src/app/barber-dashboard/waitlist/page.tsx', 'seatMine']]) {
    const page = fs.readFileSync(path.join(root, file), 'utf8'); const start = page.indexOf(`  const ${name} = async`); const end = page.indexOf('\n  };', start) + 5;
    const callback = ts.transpileModule(page.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    for (const response of [ok(), new Response('{}', { status: 503 }), new Response('{}'), new Response('broken'), new Response(JSON.stringify({ error: 'Taken' }), { status: 409 })]) {
      let notices = 0; const env = { seatEntry: { id: 'waiter', client_name: 'Fixture' }, shop: { id: 'shop' }, accessToken: 'valid', fetch: async () => response, barbers: [], setConfirmedNotice: () => { notices++; }, setTimeout: () => 0 };
      const run = new Function(...Object.keys(env), `${callback}; return ${name};`)(...Object.values(env));
      if (response.status === 409) assert.equal(await run({ barberId: 'barber', slot: '10:00 AM', serviceId: null }), 'Taken');
      else {
        const body = await response.clone().text();
        if (body.includes('appointment_id')) assert.equal(await run({ barberId: 'barber', slot: '10:00 AM', serviceId: null }), null);
        else { await assert.rejects(() => run({ barberId: 'barber', slot: '10:00 AM', serviceId: null }), /Unconfirmed/); assert.equal(notices, 0); }
      }
    }
  }
  assert.match(source, /disabled=\{!slot \|\| busy \|\| uncertain\}/);
  assert.match(source, /const close = \(\) => \{ if \(bookingInFlight.current\) return/);
  console.log('PASS waitlist form: duplicate/success guards, retryable rejection, uncertain network/server/malformed lock, recovered busy state, both walk-in callbacks and unchanged payload');
})().catch(error => { console.error(error); process.exitCode = 1; });

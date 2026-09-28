// Reporting evidence: ledger rows LINKED to a report's bookings (own payment id,
// or a tip/balance carrying the booking id on another payment id) are loaded from
// any date, shop-scoped, and used only as lookup — never as counted income.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const req = Module.createRequire(path.join(root, 'package.json'));
const ts = req('typescript');
function load(file, mocks = {}) {
  const filename = path.join(root, file);
  const m = new Module(filename, module);
  m.filename = filename;
  m.require = id => { if (id.startsWith('./')) id = `@/lib/${id.slice(2)}`; return mocks[id] ?? (id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`, mocks) : req(id)); };
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return m.exports;
}
const { collectedTotals } = load('src/lib/revenue.ts');
const { analyticsRevenueBuckets, analyticsPeriod } = load('src/lib/analytics-period.ts');
const cents = n => Math.round(n * 100) / 100;
const appt = o => ({ client_name: 'C', payment_status: 'captured', payment_method: 'card', status: 'completed', tax_amount: 0, tip_amount: 0, gift_applied: 0, balance_due: null, ...o });
const row = o => ({ client_name: 'C', amount: 0, tax: 0, tip: 0, payment_method: 'card', refunded: false, source: 'completion', ...o });
const zero = t => ['gross', 'net', 'fees', 'tax', 'tips', 'cash'].every(k => t[k] === 0);

(async () => {
  // 1. Midnight boundary: paid 23:59:58, capture row saved 00:00:03 next day.
  {
    const a = appt({ id: 'a1', total_amount: 74.75, tax_amount: 9.75, payment_intent_id: 'pi_cap', paid_at: '2026-09-04T23:59:58' });
    const cap = row({ id: 'r1', appointment_id: 'a1', payment_intent_id: 'pi_cap', amount: 35, tax: 5.25, created_at: '2026-09-05T00:00:03' });
    assert.equal(cents(collectedTotals([a], []).gross), 74.75, 'without evidence: booking-amount fallback (the bug)');
    const dayD = collectedTotals([a], [], undefined, null, [cap]);
    const dayD1 = collectedTotals([], [cap], undefined, null, [cap]);
    assert.equal(cents(dayD.gross), 40.25, 'day D resolves the capture from evidence');
    assert.equal(cents(dayD1.gross), 0, 'day D+1: the capture row is not income on its own');
    assert.equal(cents(dayD.tax), 9.75, 'tax rule unchanged');
  }
  // 2. Prepaid booking (weekly email): charged 10 days before the appointment week.
  {
    const a = appt({ id: 'a2', total_amount: 74.75, tax_amount: 9.75, payment_intent_id: 'pi_pre', paid_at: '2026-08-25T10:00:00' });
    const pre = row({ id: 'r2', appointment_id: 'a2', payment_intent_id: 'pi_pre', amount: 35, tax: 5.25, created_at: '2026-08-25T10:00:02' });
    assert.equal(cents(collectedTotals([a], [], undefined, null, [pre]).gross), 40.25);
  }
  // 3. Separate tip on another payment id, saved on another day → counted once, on its own day.
  {
    const a = appt({ id: 'a3', total_amount: 35, tip_amount: 5.25, payment_intent_id: 'pi_svc', paid_at: '2026-08-07T20:19:30' });
    const svc = row({ id: 'r3', appointment_id: 'a3', payment_intent_id: 'pi_svc', amount: 35, created_at: '2026-08-07T20:19:30' });
    const tip = row({ id: 'r4', appointment_id: 'a3', payment_intent_id: 'pi_tip', amount: 0, tip: 5.25, created_at: '2026-08-08T09:00:00' });
    const day1 = collectedTotals([a], [svc], undefined, null, [svc, tip]);
    const day2 = collectedTotals([], [tip], undefined, null, [svc, tip]);
    assert.equal(cents(day1.gross), 35); assert.equal(cents(day1.tips), 0, 'tip not counted on the booking day');
    assert.equal(cents(day2.gross), 5.25); assert.equal(cents(day2.tips), 5.25);
    // Fallback booking (no own charge row) also drops the separately-paid tip.
    const cashA = { ...a, id: 'a3c', payment_method: 'cash', payment_status: 'paid', payment_intent_id: null };
    const cashTip = { ...tip, id: 'r4c', appointment_id: 'a3c' };
    assert.equal(cents(collectedTotals([cashA], [], undefined, null, [cashTip]).gross), 35);
  }
  // 4. Balance on another payment id, collected on another day → each counted once on its own day.
  {
    const a = appt({ id: 'a4', total_amount: 74.75, tax_amount: 9.75, balance_due: 0, payment_method: 'cash', payment_status: 'paid', payment_intent_id: null, paid_at: '2026-09-04T12:00:00' });
    const bal = row({ id: 'r5', appointment_id: 'a4', payment_intent_id: 'pi_bal', source: 'balance', amount: 30, tax: 4.5, created_at: '2026-09-06T12:00:00' });
    const day1 = collectedTotals([a], [], undefined, null, [bal]);
    const day3 = collectedTotals([], [bal], undefined, null, [bal]);
    assert.equal(cents(day1.gross), 40.25, 'booking day excludes the later balance');
    assert.equal(cents(day1.cash), 40.25);
    assert.equal(cents(day3.gross), 34.5, 'balance counted on its own day');
    assert.equal(cents(day1.gross + day3.gross), 74.75, 'no double count across windows');
    const both = collectedTotals([a], [bal]);                     // one window holding both
    assert.equal(cents(both.gross), 74.75); assert.equal(cents(both.gross - both.fees), cents(both.net));
  }
  // 5. Evidence alone is never income.
  {
    const ev = [row({ id: 'e1', payment_intent_id: 'pi_x', amount: 50, tax: 7.5 }), row({ id: 'e2', source: 'balance', appointment_id: 'zz', payment_intent_id: 'pi_y', amount: 20 }),
                row({ id: 'e3', source: 'pos', payment_intent_id: 'pi_z', amount: 30 }), row({ id: 'e4', appointment_id: 'zz', payment_intent_id: 'pi_t', tip: 9 })];
    assert(zero(collectedTotals([], [], { pi_x: { gross: 57.5, fee: 2, net: 55.5 } }, null, ev)), 'evidence-only → all zero');
    // A row present in both window and evidence counts once.
    const w = row({ id: 'w1', source: 'pos', payment_intent_id: 'pi_w', amount: 10 });
    assert.equal(cents(collectedTotals([], [w], undefined, null, [w]).gross), 10);
  }
  // 6. Analytics chart uses the same evidence → bars sum to the headline.
  {
    const now = new Date(); const iso = new Date(now.getFullYear(), 0, 15, 23, 59, 58).toISOString();
    const a = appt({ id: 'a6', total_amount: 74.75, tax_amount: 9.75, payment_intent_id: 'pi_c6', paid_at: iso, created_at: iso });
    const cap = row({ id: 'r6', appointment_id: 'a6', payment_intent_id: 'pi_c6', amount: 35, tax: 5.25, created_at: '1999-01-01T00:00:00Z' });
    const sum = analyticsRevenueBuckets([a], [], analyticsPeriod('year', now), undefined, [cap]).daily.reduce((s, d) => s + d.revenue, 0);
    assert.equal(cents(sum), cents(collectedTotals([a], [], undefined, null, [cap]).gross));
    assert.equal(cents(sum), 40.25);
  }
  // 7. loadLinkedEvidence: every read is shop-scoped, bounded to the given ids, chunked; failures → [].
  {
    const reads = [];
    let fail = false;
    const db = { from(table) {
      const q = { filters: [], select(c) { q.cols = c; return q; }, eq(k, v) { q.filters.push(['eq', k, v]); return q; }, in(k, v) { q.filters.push(['in', k, v]); return q; },
        then(r, j) { reads.push({ table, filters: q.filters }); return Promise.resolve(fail ? { data: null, error: { message: 'x' } } : { data: [{ id: `${reads.length}` }], error: null }).then(r, j); } };
      return q;
    } };
    const { loadLinkedEvidence } = load('src/lib/revenue-evidence.ts');
    const appts = Array.from({ length: 150 }, (_, i) => ({ id: `ap${i}`, payment_intent_id: i % 2 ? `pi${i}` : null }));
    const res = await loadLinkedEvidence(db, 'shop_A', appts);
    assert.equal(reads.length, 3, '150 ids → 2 chunks; 75 PIs → 1 chunk');
    for (const r of reads) {
      assert.equal(r.table, 'transactions');
      assert(r.filters.some(f => f[0] === 'eq' && f[1] === 'shop_id' && f[2] === 'shop_A'), 'every read scoped to the shop');
      const inf = r.filters.find(f => f[0] === 'in');
      assert(['appointment_id', 'payment_intent_id'].includes(inf[1]) && inf[2].length <= 100);
    }
    assert.equal(res.ok, true); assert.equal(res.rows.length, 3);
    fail = true;
    assert.deepEqual(await loadLinkedEvidence(db, 'shop_A', appts), { ok: false, rows: [] }, 'failed read is reported, not hidden as "no evidence"');
    assert.deepEqual(await loadLinkedEvidence(db, null, appts), { ok: false, rows: [] }, 'no shop → not verified');
    assert.deepEqual(await loadLinkedEvidence(db, 'shop_A', []), { ok: true, rows: [] }, 'nothing to verify → ok');
    const thrower = { from() { const q = { select() { return q; }, eq() { return q; }, in() { return q; }, then(_r, j) { return Promise.reject(new Error('offline')).then(null, j); } }; return q; } };
    assert.deepEqual(await loadLinkedEvidence(thrower, 'shop_A', appts), { ok: false, rows: [] }, 'thrown read → not verified');
  }
  // 8. Barbers: no shop-transaction reads added for them.
  {
    const dash = fs.readFileSync(path.join(root, 'src/app/dashboard/page.tsx'), 'utf8');
    assert(/evidenceKey = shop\?\.id && profile\?\.role !== "barber"/.test(dash), 'Dashboard evidence is owner-only');
    assert(/profile\?\.role === "barber"\) \{ router\.push\("\/barber-dashboard"\)/.test(fs.readFileSync(path.join(root, 'src/app/dashboard/layout-client.tsx'), 'utf8')), 'barbers are redirected off owner screens');
    const barberFiles = fs.readdirSync(path.join(root, 'src/app/barber-dashboard'), { recursive: true }).filter(f => /\.tsx?$/.test(f));
    for (const f of barberFiles) assert(!fs.readFileSync(path.join(root, 'src/app/barber-dashboard', f), 'utf8').includes('loadLinkedEvidence'), `barber portal does not load shop evidence (${f})`);
    const cron = fs.readFileSync(path.join(root, 'src/app/api/cron/reminders/route.ts'), 'utf8');
    assert(/loadLinkedEvidence\(supabaseAdmin, shop\.id,/.test(cron), 'weekly email evidence scoped to its shop');
  }
  // 9. Evidence-read FAILURE: never a silent recalculation without it.
  {
    const { evidenceView } = load('src/lib/revenue-evidence.ts');
    const good = { key: 'shop_A|a1', rows: [{ id: 'r1' }] };
    assert.deepEqual(evidenceView('shop_A|a1', good, null), { rows: good.rows, stale: false, unavailable: false }, 'verified');
    assert.deepEqual(evidenceView('shop_A|a1', good, 'shop_A|a1'), { rows: good.rows, stale: true, unavailable: false }, 'reload failed → previous valid result, marked stale');
    assert.deepEqual(evidenceView('shop_A|a1,a2', good, 'shop_A|a1,a2'), { rows: good.rows, stale: false, unavailable: true }, 'no valid result for this window → unavailable');
    assert.deepEqual(evidenceView('shop_A|a1,a2', good, null), { rows: good.rows, stale: false, unavailable: false }, 'loading → previous same-shop rows');
    assert.deepEqual(evidenceView('shop_B|b1', good, null).rows, [], "another shop's rows are never reused");
    assert.deepEqual(evidenceView('shop_A|a1', null, 'shop_A|a1'), { rows: [], stale: false, unavailable: true }, 'first load failed → unavailable');
    // The unverified recalculation that failure must NOT present as a figure (the midnight case):
    const a = appt({ id: 'a9', total_amount: 74.75, tax_amount: 9.75, payment_intent_id: 'pi_9' });
    assert.equal(cents(collectedTotals([a], [], undefined, null, evidenceView('shop_A|a9', null, 'shop_A|a9').rows).gross), 74.75, 'what would have shown without evidence');
    // Wiring: each screen honours stale/unavailable with its existing error pattern.
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');
    const dash = read('src/app/dashboard/page.tsx');
    assert(/\{loadError \|\| evidence\.unavailable \? null :/.test(dash), 'Dashboard hides collected figures when unavailable');
    assert(dash.includes('collected figures are unavailable') && dash.includes('collected figures may be out of date') && /setEvidenceRetry\(\(v\) => v \+ 1\)/.test(dash), 'Dashboard banner + Retry');
    const an = read('src/app/dashboard/analytics/page.tsx');
    assert(/const dataReady = [^;]*!evidence\.unavailable;/.test(an) && an.includes('revenue figures are unavailable') && an.includes('revenue figures may be out of date'), 'Analytics withholds / flags revenue figures');
    assert(/collected: evidence\.ok \? [^:]+ : "Unavailable"/.test(read('src/app/api/cron/reminders/route.ts')), 'weekly email sends "Unavailable" instead of an unverified figure');
  }
  console.log('PASS linked evidence: evidence-read failure → stale or unavailable (never silent), midnight boundary, prepaid, separate tip + balance on other payment ids, never counted, shop-scoped chunked reads, chart = headline, barbers excluded');
})().catch(e => { console.error(e); process.exitCode = 1; });

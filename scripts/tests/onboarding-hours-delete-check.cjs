const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/app/onboarding/page.tsx'), 'utf8');
const start = source.indexOf('  const handleNext ='), end = source.indexOf('  // Shared "advance this step"', start);
const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
async function run(failAt, open = true, throws = false) {
  const state = { calls: [], advances: 0, error: '', saving: false };
  const env = { resumeReady: true, stepSaveInFlight: { current: false }, step: 2, createdBarberIds: ['one','two'], createdShopId: 'shop',
    hours: [{ open, start: '9 AM', end: '5 PM' }], toDbTime: value => value === '9 AM' ? '09:00:00' : '17:00:00',
    setError: value => { state.error = value; }, setSaving: value => { state.saving = value; }, setStep: () => { state.advances++; },
    supabase: { from: table => ({ delete: () => ({ eq: async (key, id) => { state.calls.push({ op: 'delete', table, key, id }); if (id === failAt && throws) throw Error('Connection failed; review hours before retrying.'); return { error: id === failAt ? { message: 'private database detail' } : null }; } }),
      insert: async rows => { state.calls.push({ op: 'insert', table, rows }); return { error: null }; } }) } };
  await new Function(...Object.keys(env), `${code}; return handleNext;`)(...Object.values(env))();
  assert.equal(state.saving, false); assert.equal(env.stepSaveInFlight.current, false);
  return state;
}
(async () => {
  for (const open of [true,false]) {
    const first = await run('one', open);
    assert.equal(first.advances, 0, 'a rejected deletion must not advance hours');
    assert.deepEqual(first.calls, [{ op: 'delete', table: 'time_slots', key: 'barber_id', id: 'one' }], 'a rejected delete must prevent new slots and later barber writes');
    assert.match(first.error, /Couldn't replace/); assert.doesNotMatch(first.error, /private/);
    const thrown = await run('one', open, true); assert.equal(thrown.advances,0); assert.equal(thrown.calls.length,1); assert.match(thrown.error,/Connection failed/);
  }
  const second = await run('two'); assert.equal(second.advances,0); assert.equal(second.calls.length,3); assert.equal(second.calls[2].id,'two');
  const success = await run(null); assert.equal(success.advances,1); assert.equal(success.error,'');
  assert.deepEqual(success.calls.filter(call=>call.op==='insert').map(call=>call.rows), ['one','two'].map(id=>[{day_of_week:0,start_time:'09:00:00',end_time:'17:00:00',is_available:true,barber_id:id}]));
  const closed = await run(null,false); assert.equal(closed.advances,1); assert.equal(closed.calls.length,2);
  console.log('PASS onboarding hours: rejected deletes stop inserts/later writes/advancement, all-closed failure, partial failure visibility, preserved successful payloads and busy cleanup');
})().catch(error=>{ console.error(error); process.exitCode=1; });

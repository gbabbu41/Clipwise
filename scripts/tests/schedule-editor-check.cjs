const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), appReq = Module.createRequire(path.join(root, 'package.json')), ts = appReq('typescript');
const React = appReq('react'), renderer = appReq('react-test-renderer'), { act } = renderer;
const cache = {};
function load(relative) { if (cache[relative]) return cache[relative]; const filename = path.join(root, relative), m = new Module(filename, module); m.filename = filename; m.require = id => id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`) : appReq(id); m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename); return cache[relative] = m.exports; }
const { ScheduleEditor } = load('src/components/schedule-editor.tsx');
const response = (hour, ok = true) => ({ ok, json: async () => ok ? { slots: [{ day_of_week: 1, start_time: hour, end_time: '17:00', is_available: true }], breaks: [], timeOff: [], canRequestTimeOff: true, canBlockHours: true } : { error: 'Save failed' } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const props = barberId => ({ barberId, barberName: 'Barber', accessToken: 'token' });
let tree;
(async () => {
  const first = deferred(), second = deferred(); let reads = 0;
  global.fetch = async () => (++reads === 1 ? first.promise : second.promise);
  await act(async () => { tree = renderer.create(React.createElement(ScheduleEditor, props('first'))); });
  await act(async () => { tree.update(React.createElement(ScheduleEditor, props('second'))); });
  await act(async () => { second.resolve(response('11:00')); });
  assert.match(JSON.stringify(tree.toJSON()), /11:00 AM/);
  await act(async () => { first.resolve(response('09:00')); });
  assert.match(JSON.stringify(tree.toJSON()), /11:00 AM/); assert.doesNotMatch(JSON.stringify(tree.toJSON()), /9:00 AM.*→/);
  global.fetch = async () => response(null, false);
  await act(async () => { tree.root.findAllByType('button').find(b => b.children.includes('Quick fill: Mon–Fri 9–6')).props.onClick(); });
  assert.match(JSON.stringify(tree.toJSON()), /11:00 AM/); assert.match(JSON.stringify(tree.toJSON()), /Save failed/);
  // Editing a manual draft and failing to save must retain it with a visible warning.
  await act(async () => { tree.root.findAllByType('button').find(b => b.findAllByType('span').some(s => s.children.includes('MON'))).props.onClick(); });
  const selects = tree.root.findAllByType('select');
  await act(async () => { selects[0].props.onChange({ target: { value: '10:00 AM' } }); });
  await act(async () => { await tree.root.findAllByType('button').find(b => b.children.includes('Save')).props.onClick(); });
  assert.match(JSON.stringify(tree.toJSON()), /Unsaved changes/); assert.match(JSON.stringify(tree.toJSON()), /10:00 AM/);
  await act(async () => { tree.unmount(); });
  console.log('PASS stale schedule loads ignored, failed quick actions preserve saved hours, manual failed drafts retained and marked unsaved');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { if (tree) tree.unmount(); });

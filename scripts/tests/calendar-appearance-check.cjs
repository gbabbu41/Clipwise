const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync('src/lib/calendar-appearance.ts', 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const compiledModule = { exports: {} };
vm.runInNewContext(js, { module: compiledModule, exports: compiledModule.exports, Math });
const { calendarBarberTint, calendarStatusTone } = compiledModule.exports;

assert.equal(calendarBarberTint(undefined, ['one', 'two']), '126, 132, 140', 'missing barber identity uses a neutral fallback');
assert.equal(calendarBarberTint('unknown', ['one', 'two']), '126, 132, 140', 'unknown barber identity uses a neutral fallback');
const roster = ['one', 'two', 'three', 'four'];
const assignments = Object.fromEntries(roster.map(id => [id, calendarBarberTint(id, roster)]));
assert.equal(new Set(Object.values(assignments)).size, 4, 'the first four roster members get distinct tints');
for (const id of roster) {
  assert.equal(calendarBarberTint(id, [...roster].reverse()), assignments[id], `tint is independent of roster order for ${id}`);
  assert.match(assignments[id], /^\d{1,3}, \d{1,3}, \d{1,3}$/);
}
assert.equal(calendarBarberTint('one'), calendarBarberTint('one'), 'hash fallback is stable without a roster');
for (const [status, tone] of [['confirmed', 'confirmed'], ['completed', 'completed'], ['pending', 'pending'], ['cancelled', 'cancelled'], ['no-show', 'no-show'], ['legacy-status', 'neutral']]) {
  assert.equal(calendarStatusTone(status), tone, `${status} maps to its explicit appointment state`);
}
console.log('PASS stable barber tint and explicit status-tone mappings');

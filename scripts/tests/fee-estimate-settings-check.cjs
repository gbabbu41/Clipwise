const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const req = Module.createRequire(path.join(root, 'package.json'));
const ts = req('typescript');
const { NextRequest } = req('next/server');

// Loader that also resolves the relative imports inside src/lib (./supabase-admin, ./revenue).
function load(file, mocks = {}) {
  const filename = path.join(root, file);
  const m = new Module(filename, module);
  m.filename = filename;
  m.require = id => {
    if (id.startsWith('./')) id = `@/lib/${id.slice(2)}`;
    if (mocks[id]) return mocks[id];
    return id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`, mocks) : req(id);
  };
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return m.exports;
}

let stored, upserts, audits;
const db = { from(table) {
  let patch;
  const q = {
    select() { return q; }, eq() { return q; }, maybeSingle() { return q; },
    upsert(v) { patch = v; return q; },
    then(resolve, reject) { return Promise.resolve().then(() => {
      if (patch) { upserts.push(patch); stored = patch.data; return { data: null, error: null }; }
      return { data: table === 'platform_settings' ? { data: stored } : null, error: null };
    }).then(resolve, reject); },
  };
  return q;
} };
let admin;
const mocks = {
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/admin-auth': { requireSuperAdmin: async () => admin },
  '@/lib/admin-audit': { logAdminAction: async (_a, entry) => { audits.push(entry); } },
};
const settings = load('src/lib/platform-settings.ts', mocks);
const route = load('src/app/api/admin/settings/route.ts', { ...mocks, '@/lib/platform-settings': settings });
const { estimateStripeFee, DEFAULT_CARD_FEE_ESTIMATE } = load('src/lib/revenue.ts');
const put = async body => {
  settings.invalidatePlatformSettingsCache();
  return route.PUT(new NextRequest('https://clipwise.ca/api/admin/settings', { method: 'PUT', body: JSON.stringify(body) }));
};

(async () => {
  // Estimate math: default = Stripe standard CA rate (unchanged numbers), rate applied only when valid.
  assert.deepEqual(DEFAULT_CARD_FEE_ESTIMATE, { percent: 2.9, fixed: 0.3 });
  assert.equal(estimateStripeFee(115), 3.64);
  assert.equal(estimateStripeFee(100), 3.2, 'no float drift on 2.9%');
  assert.equal(estimateStripeFee(40.25, { percent: 3.7, fixed: 0.3 }), 1.79);
  assert.equal(estimateStripeFee(115, { percent: 50, fixed: 0.3 }), estimateStripeFee(115), 'out-of-range % → default');
  assert.equal(estimateStripeFee(0, { percent: 3, fixed: 1 }), 0);

  // Only the super-admin may change it.
  stored = {}; upserts = []; audits = []; admin = null;
  let r = await put({ est_card_fee_percent: 3.7 });
  assert.equal(r.status, 403); assert.equal(upserts.length, 0);

  // Valid values persist (rounded to cents), other settings untouched, change is audited.
  admin = { id: 'admin', email: 'admin@clipwise.ca' };
  stored = { platform_name: 'ClipWise', signups_enabled: false };
  r = await put({ est_card_fee_percent: 3.456, est_card_fee_fixed: 0.3 });
  assert.equal(r.status, 200);
  assert.equal(stored.est_card_fee_percent, 3.46); assert.equal(stored.est_card_fee_fixed, 0.3);
  assert.equal(stored.signups_enabled, false, 'other settings preserved');
  assert.equal(audits.at(-1).action, 'settings.update');
  assert.deepEqual(settings.cardFeeEstimateRate(await settings.getPlatformSettings(true)), { percent: 3.46, fixed: 0.3 });

  // Invalid values are rejected server-side and nothing is saved.
  for (const bad of [{ est_card_fee_percent: 11 }, { est_card_fee_percent: -1 }, { est_card_fee_percent: '3' }, { est_card_fee_percent: null },
    { est_card_fee_fixed: 2.5 }, { est_card_fee_fixed: -0.01 }, { est_card_fee_percent: 3, est_card_fee_fixed: 'x' }]) {
    const before = upserts.length;
    r = await put(bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(upserts.length, before, 'nothing half-saved');
  }
  assert.equal(stored.est_card_fee_percent, 3.46, 'previous valid value kept');

  // Omitted keys keep the current value (e.g. flipping a toggle).
  r = await put({ maintenance_mode: true });
  assert.equal(r.status, 200); assert.equal(stored.est_card_fee_percent, 3.46);

  // A malformed stored value never produces a nonsense estimate.
  assert.deepEqual(settings.cardFeeEstimateRate({ ...settings.DEFAULT_PLATFORM_SETTINGS, est_card_fee_percent: 'x', est_card_fee_fixed: 99 }), { percent: 2.9, fixed: 0.3 });

  console.log('PASS fee estimate settings: super-admin only, validated + audited, nothing half-saved, defaults on bad data, estimate-only math');
})().catch(error => { console.error(error); process.exitCode = 1; });

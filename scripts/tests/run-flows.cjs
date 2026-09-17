const { execFileSync } = require('node:child_process');
const path = require('node:path');
for (const file of ['billing-flow-check.cjs', 'trial-safety-check.cjs', 'subscription-confirm-check.cjs', 'billing-route-guards-check.cjs', 'plan-prompts-check.cjs']) {
  execFileSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
}

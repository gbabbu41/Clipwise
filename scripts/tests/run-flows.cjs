const { execFileSync } = require('node:child_process');
const path = require('node:path');
execFileSync(process.execPath, [path.join(__dirname, 'calendar-workflow-check.cjs')], { stdio: 'inherit' });
execFileSync(process.execPath, [path.join(__dirname, 'manage-booking-check.cjs')], { stdio: 'inherit' });
execFileSync(process.execPath, [path.join(__dirname, 'waitlist-auth-check.cjs')], { stdio: 'inherit' });
execFileSync(process.execPath, [path.join(__dirname, 'pos-resource-guards-check.cjs')], { stdio: 'inherit' });
execFileSync(process.execPath, [path.join(__dirname, 'reschedule-slots-check.cjs')], { stdio: 'inherit' });
execFileSync(process.execPath, [path.join(__dirname, 'waitlist-removal-check.cjs')], { stdio: 'inherit' });
execFileSync(process.execPath, [path.join(__dirname, 'waitlist-loading-check.cjs')], { stdio: 'inherit' });
for (const file of ['billing-flow-check.cjs', 'trial-safety-check.cjs', 'subscription-confirm-check.cjs', 'billing-route-guards-check.cjs', 'plan-prompts-check.cjs', 'portal-revenue-check.cjs', 'analytics-check.cjs', 'earnings-inventory-check.cjs', 'schedule-guards-check.cjs', 'payments-ui-fees-check.cjs', 'dashboard-report-check.cjs', 'schedule-editor-check.cjs', 'subscription-cancel-check.cjs', 'subscription-webhook-check.cjs', 'subscription-reconcile-check.cjs', 'add-location-safety-check.cjs', 'trial-lifecycle-check.cjs', 'calendar-autofocus-check.cjs']) {
  execFileSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
}

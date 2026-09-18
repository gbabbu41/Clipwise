// Headless layout fixture built with the application's actual shell classes and
// production CSS. No login, network requests, or customer data. Not an iOS test.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const cssDir = path.join(root, '.next/static/css');
const css = fs.readdirSync(cssDir).filter(file => file.endsWith('.css')).map(file => fs.readFileSync(path.join(cssDir, file), 'utf8')).join('\n');
const source = read('src/components/calendar-view.tsx');
const calendarClass = source.match(/<div data-no-swipe className=\{cn\("([^"]+)"/)[1];
const controlClass = source.match(/<div className="(shrink-0 border-b border-border px-4[^"]+)"/)[1];
const scrollClasses = [...source.matchAll(/ref=\{attachScroll\} data-focus-key=\{focusKey\} className="([^"]+)"/g)].map(match => match[1]);
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const portal of ['dashboard/layout-client.tsx', 'barber-dashboard/layout.tsx']) {
      const template = read(`src/app/${portal}`).match(/<main className=\{`([^`]+)`\}/)[1];
      const shellClass = new Function('isCalendar', `return \`${template}\`;`)(true);
      for (const width of [390, 1280]) for (const banner of [0, 84]) for (const scrollClass of scrollClasses) {
        const page = await browser.newPage({ viewport: { width, height: 844 } });
        await page.setContent(`<style>${css}</style><div class="portal min-h-[100lvh]"><main class="${shellClass}"><div style="height:${banner}px">${banner ? 'Banner' : ''}</div><div class="cw-swipe-clip flex-1 min-h-0 overflow-hidden"><div class="cw-swipe-root h-full"><div class="${calendarClass}"><div id="controls" class="${controlClass}">Date · Today · Now · View</div><div class="relative flex-1 min-h-0 overflow-hidden"><div class="h-full w-full"><div class="flex flex-col h-full min-h-0"><div id="days" class="shrink-0" style="height:64px">Selected date / day headings</div><div id="timeline" class="${scrollClass}"><div style="height:1488px">24-hour grid</div></div></div></div></div></div></div></div></main></div>`);
        const measure = () => page.evaluate(() => {
          const controls = document.querySelector('#controls').getBoundingClientRect(), days = document.querySelector('#days').getBoundingClientRect(), timeline = document.querySelector('#timeline');
          return { controls: controls.top, days: days.top, bottom: timeline.getBoundingClientRect().bottom, height: timeline.clientHeight, content: timeline.scrollHeight, scroll: timeline.scrollTop };
        });
        const before = await measure();
        assert(before.height > 200); assert(before.content > before.height); assert(before.bottom <= 844);
        await page.locator('#timeline').evaluate(el => { el.scrollTop = 1000; });
        const down = await measure(); assert(down.scroll > 0); assert.equal(down.controls, before.controls); assert.equal(down.days, before.days);
        await page.locator('#timeline').evaluate(el => { el.scrollTop = 0; });
        assert.equal((await measure()).scroll, 0);
        await page.setViewportSize({ width, height: 640 });
        assert((await measure()).bottom <= 640);
        await page.close();
      }
    }
    console.log('PASS calendar shell layout: owner/barber, Day/3-Day, phone/desktop, banner/no banner, two-way scroll and viewport resize; controls/headings remain stationary');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

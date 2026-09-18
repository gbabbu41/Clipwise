// Headless layout fixture built with the application's actual shell classes and
// production CSS. No login, network requests, or customer data. Not an iOS test.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const ts = require('typescript'), React = require('react'), { renderToStaticMarkup } = require('react-dom/server'), icons = require('lucide-react');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const cssDir = path.join(root, '.next/static/css');
const css = fs.readdirSync(cssDir).filter(file => file.endsWith('.css')).map(file => fs.readFileSync(path.join(cssDir, file), 'utf8')).join('\n');
const source = read('src/components/calendar-view.tsx');
const calendarClass = source.match(/<div data-no-swipe className=\{cn\("([^"]+)"/)[1];
const controlClass = source.match(/data-calendar-toolbar className="([^"]+)"/)[1];
const scrollClasses = [...source.matchAll(/ref=\{attachScroll\} data-focus-key=\{focusKey\} className="([^"]+)"/g)].map(match => match[1]);
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    // Render the actual toolbar JSX, not a text placeholder: Today + Now +
    // barber/view/profile controls exposed the wrapping regression.
    const ast = ts.createSourceFile('calendar.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let toolbar;
    function find(node) {
      if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(p => p.name?.getText(ast) === 'data-calendar-toolbar')) toolbar = node;
      ts.forEachChild(node, find);
    }
    find(ast);
    const compiled = ts.transpileModule(`const render = () => (${toolbar.getText(ast)});`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
    for (const width of [320, 375, 390, 430, 768, 1024, 1280]) for (const both of [false, true]) {
      const env = new Proxy({ React, ...icons, backLabel: 'Month', titleText: 'September 28–30, 2026', view: 'multiday', isMobile: width < 768, profile: { role: 'shop_owner' }, barbers: [{ id: 'one' }, { id: 'two' }], dayBarberId: 'one', viewMenu: false, viewPicker: false, multiDayCount: 3, multiDays: [new Date('2026-09-28T12:00:00')], currentDate: new Date('2026-09-27T12:00:00'), shopToday: both ? '2026-09-28' : '2026-09-30', onToday: false, pageTitle: 'Calendar', formatDateForDb: d => d.toISOString().slice(0, 10), cn: (...args) => args.filter(x => typeof x === 'string').join(' '), BarberAvatar: () => React.createElement('span', { style: { display: 'block', width: 28, height: 28 } }), HeaderControls: () => React.createElement(React.Fragment, null, React.createElement('button', { className: 'cwd-icobtn max-lg:hidden' }, 'B'), React.createElement('button', { className: 'cwd-avatar max-lg:hidden' }, 'P')) }, { has: () => true, get: (target, key) => target[key] });
      const Toolbar = new Function('env', `with (env) { ${compiled}; return render; }`)(env);
      const html = renderToStaticMarkup(React.createElement(Toolbar));
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      await page.setContent(`<style>${css}</style><div style="width:${width >= 1024 ? width - 256 : width}px">${html}</div>`);
      const bounds = await page.evaluate(() => {
        const bar = document.querySelector('[data-calendar-toolbar]'), r = bar.getBoundingClientRect();
        const buttons = [...bar.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 0).map(b => { const p = b.getBoundingClientRect(); return { top: p.top, bottom: p.bottom, right: p.right }; });
        return { height: r.height, right: r.right, buttons, titleWidth: bar.querySelector('h2').getBoundingClientRect().width };
      });
      assert(bounds.height < 70, `toolbar wrapped at ${width}px`);
      assert(bounds.titleWidth > 20, `date squeezed out at ${width}px`);
      for (const button of bounds.buttons) assert(button.right <= bounds.right + 1, `control clipped at ${width}px`);
      assert(Math.max(...bounds.buttons.map(b => b.top)) < Math.min(...bounds.buttons.map(b => b.bottom)), `controls not on one line at ${width}px`);
      await page.close();
    }
    console.log('PASS actual calendar toolbar JSX: 320–1280px, Today alone and Today + Now, all controls fit one row');
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

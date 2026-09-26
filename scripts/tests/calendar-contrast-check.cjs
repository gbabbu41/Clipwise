// Render actual Day timeline JSX with isolated data; no API calls or booking writes.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const ts = require('typescript'), React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const { chromium } = require('playwright'), icons = require('lucide-react');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'src/components/calendar-view.tsx'), 'utf8');
const ast = ts.createSourceFile('calendar.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = {};
function visit(node) {
  if (ts.isVariableDeclaration(node) && ['renderDayView', 'renderWeekStrip', 'apptBlock'].includes(node.name.getText(ast))) declarations[node.name.getText(ast)] = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
const compiled = ts.transpileModule(Object.entries(declarations).map(([name, value]) => `const ${name} = ${value};`).join('\n') + '\nreturn renderDayView;', { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
const cssDir = path.join(root, '.next/static/css');
const css = fs.readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(cssDir, f), 'utf8')).join('\n');
const font = fs.readFileSync(path.join(root, 'src/app/fonts/manrope-latin-variable.woff2')).toString('base64');
const fontCss = `@font-face{font-family:FixtureManrope;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:200 800}html{--font-body:FixtureManrope}body{font-family:FixtureManrope,sans-serif}`;
function contrast(a,b) {
  const lum = c => { const v = c.match(/[\d.]+/g).map(Number).slice(-3).map(x => c.startsWith('color(') ? x : x/255); return v.map(x => x<=.04045 ? x/12.92 : ((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0); };
  const x=lum(a),y=lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    for (const width of [390,1280]) for (const theme of ['light','dark']) {
      const barbers = [{id:'one',name:'Alex'},{id:'two',name:'Morgan'}];
      const values = {
        React, Array, Math, Date, String, Fragment:React.Fragment, ...icons, cn:(...x)=>x.filter(Boolean).join(' '), currentDate:new Date('2026-09-26T12:00:00'), shopToday:'2026-09-26', shopHour:19.5,
        formatDateForDb:d=>d.toISOString().slice(0,10), addDays:(d,n)=>new Date(d.getTime()+n*86400000), isToday:d=>d.getDate()===26, STRIP_RANGE:3,
        appointments:[{id:'appt',date:'2026-09-26',time_slot:'16:00',barber_id:'one',client_name:'Jamie · Haircut',status:'confirmed',payment_status:'paid',services:{name:'Haircut'}}],
        freesSlot:()=>false, forceBarberId:null, barberFilter:width<768?'one':'all', profile:{role:'shop_owner'}, isMobile:width<768, barbers, dayBarberId:'one',dayAllCols:barbers,dayPage:0,dayPerPage:2,dayLayout:'timeline',
        fullDayCalendarWindow:()=>({winStart:15,winEnd:24,hours:Array.from({length:9},(_,i)=>i+15)}),gridStartHour:()=>15,dayColH:0,ROW_PX:62,
        scheduledBarbers:barbers,unscheduledCount:0,dismissedFreed:new Set(),schedules:new Map(barbers.map(b=>[b.id,{}])),landingFor:()=>15,
        blocksFor:()=>[],windowEmpties:()=>[],unavailBandsFor:id=>id==='two'?[{startMin:0,endMin:1440,fullDay:true,label:'Closed'}]:[{startMin:1080,endMin:1140,fullDay:false,label:'Break'}],
        layoutColumn:rows=>rows.map(a=>({a,lane:0,lanes:1})),parseTime:t=>Number(t.slice(0,2))+Number(t.slice(3,5))/60,apptDuration:()=>60,isDimmed:()=>false,flashIds:new Set(),rangeLabel:()=> '4:00 – 5:00 PM',paymentTag:()=>({segments:[{text:'Paid',className:'text-grey'}]}),
        BarberAvatar:()=>React.createElement('span',null,'A'),
      };
      const env = new Proxy(values,{has:()=>true,get:(o,k)=>o[k]});
      const Timeline = new Function('env',`with(env){${compiled}}`)(env);
      const html = renderToStaticMarkup(React.createElement(Timeline));
      const page = await browser.newPage({viewport:{width,height:844}});
      await page.setContent(`<html data-theme="${theme}"><style>${css}${fontCss}</style><main class="portal bg-background text-foreground" style="height:844px"><header style="padding:20px;font-size:24px;font-weight:700">Calendar</header>${html}</main></html>`);
      await page.evaluate(()=>document.fonts.ready);
      const colors = await page.evaluate(()=>{const label=document.querySelector('.cw-time-label'),gutter=document.querySelector('.cw-time-gutter'),grid=document.querySelector('[data-calendar-time-grid]');return {label:getComputedStyle(label).color,gutter:getComputedStyle(gutter).backgroundColor,grid:getComputedStyle(grid).backgroundColor,line:getComputedStyle(document.querySelector('.cw-time-row')).borderBottomColor}});
      assert(contrast(colors.label,colors.gutter)>=4.5,`${theme} hour-label contrast`);
      assert.notEqual(colors.gutter,colors.grid,'gutter must remain distinct');assert.notEqual(colors.line,colors.grid,'hour separators must remain visible');
      assert.equal(await page.getByText('Jamie · Haircut',{exact:true}).count(),1);
      const band=page.getByText('Break',{exact:true});assert(await band.isVisible());assert.match(await band.evaluate(el=>getComputedStyle(el.parentElement).backgroundImage),/repeating-linear-gradient/);
      if(width>768){const closed=page.getByText('Closed',{exact:true});assert(await closed.isVisible());assert.match(await closed.evaluate(el=>getComputedStyle(el.parentElement).backgroundImage),/repeating-linear-gradient/);}
      assert(await page.locator('.bg-red-500').count()>=2,'red now-line/dot remain');
      if(process.env.CALENDAR_SCREENSHOT_DIR){fs.mkdirSync(process.env.CALENDAR_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.CALENDAR_SCREENSHOT_DIR,`calendar-contrast-${theme}-${width}.png`)});}
      console.log(`PASS ${theme} ${width}: hour-label contrast ${contrast(colors.label,colors.gutter).toFixed(2)}:1; distinct grid/gutter, booked event, hatched break/closed overlays and red now-line retained`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});

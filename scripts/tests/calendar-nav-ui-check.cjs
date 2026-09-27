const fs=require('fs'),path=require('path'),http=require('http'),{chromium}=require('playwright');
const assert=require('assert/strict');const root=process.cwd(),dir=path.join(root,'.playwright-mcp/full-calendar');
const css=fs.readdirSync('.next/static/css').filter(x=>x.endsWith('.css')).map(x=>fs.readFileSync('.next/static/css/'+x,'utf8')).join('\n')+fs.readFileSync('src/app/globals.css','utf8').slice(fs.readFileSync('src/app/globals.css','utf8').indexOf('/* Calendar clearance belongs'));
const font=fs.readFileSync('src/app/fonts/manrope-latin-variable.woff2').toString('base64');
(async()=>{const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html; charset=utf-8');res.end(req.url==='/bundle.js'?fs.readFileSync(path.join(dir,'bundle.js')):`<html data-theme="dark"><style>${css}@font-face{font-family:ManropeFixture;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:200 800}html{--font-body:ManropeFixture}body{font-family:ManropeFixture,sans-serif}</style><div id="root"></div><script src="/bundle.js"></script></html>`)});await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});const report=[];try{

for(const theme of ['dark','light']) for(const width of [390,1280]) {
 const page=await browser.newPage({viewport:{width,height:844},reducedMotion:'reduce'});
 await page.clock.setFixedTime(new Date('2026-09-26T22:58:00Z')); await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.waitForTimeout(900);
 for(const view of ['Day','3-Day']) {
  if(view==='3-Day'){await page.getByRole('button',{name:/Calendar view:/}).click();await page.getByRole('button',{name:'3-Day',exact:true}).click();await page.waitForTimeout(500);}
  const sc=page.locator('[data-calendar-scroll]'),nav=page.getByRole('navigation',{name:'Mobile',includeHidden:true});
  assert.equal(await nav.getAttribute('data-calendar-nav-hidden'),null,'initial autofocus keeps nav visible');
  const box=await sc.boundingBox();assert(Math.abs(box.y+box.height-844)<2,'calendar extends to viewport bottom');
  await sc.evaluate(e=>e.scrollTop=100);await page.waitForTimeout(100);
  await page.mouse.move(box.x+box.width/2,box.y+100);await page.mouse.wheel(0,150);await page.waitForTimeout(150);
  assert.equal(await nav.getAttribute('data-calendar-nav-hidden'),'true','downward scroll hides nav');assert(await nav.evaluate(e=>e.inert),'hidden nav cannot take focus');
  if(width===390)assert.equal(await nav.evaluate(e=>getComputedStyle(e).pointerEvents),'none');
  await page.screenshot({path:path.join(dir,`nav-${theme}-${width}-${view}-hidden.png`)});
  await page.mouse.wheel(0,-40);await page.waitForTimeout(100);assert.equal(await nav.getAttribute('data-calendar-nav-hidden'),null,'upward reveals');
  await page.mouse.wheel(0,100);await page.waitForTimeout(150);assert.equal(await nav.getAttribute('data-calendar-nav-hidden'),'true');await page.waitForTimeout(800);assert.equal(await nav.getAttribute('data-calendar-nav-hidden'),null,'idle reveals');
  await sc.evaluate(e=>e.scrollTop=e.scrollHeight);await page.waitForTimeout(800);
  if(width===390){const grid=await page.locator('[data-calendar-time-grid]').boundingBox(),nb=await nav.boundingBox();assert(grid.y+grid.height<=nb.y,'last timeline position clears visible nav');}
  await page.screenshot({path:path.join(dir,`nav-${theme}-${width}-${view}-end.png`)});
 }
 await page.close();
}
console.log('PASS day/3day full-height canvas, down hide, up reveal, idle reveal, inert hidden nav and end clearance in both themes');
}finally{await browser.close();server.close()}})().catch(e=>{console.error(e);process.exitCode=1});

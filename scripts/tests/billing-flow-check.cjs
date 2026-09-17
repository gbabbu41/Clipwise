const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const appReq = Module.createRequire(path.join(root, 'package.json'));
const testReq = Module.createRequire(path.join(root, 'package.json'));
const ts = appReq('typescript');
const React = testReq('react');
const {create, act} = testReq('react-test-renderer');
const plans = ['starter','pro','premium'].map((id,i)=>({id,name:['Starter','Pro','Premium'][i],price_cents:[0,2300,7900][i],is_active:true,highlights:['Booking'],features:[],barber_limit:[1,4,9][i]}));
let auth, requests, nav, api, native=false, params=new URLSearchParams();
const box=({children,...p})=>React.createElement('div',p,children);
const router={push:p=>nav.push(p),replace:p=>nav.push(p)};
function load(rel, cache=new Map()) {
  let filename=path.join(root,rel);
  if(!path.extname(filename)) filename+=fs.existsSync(filename+'.tsx')?'.tsx':'.ts';
  if(cache.has(filename))return cache.get(filename).exports;
  const m=new Module(filename,module); cache.set(filename,m);m.filename=filename;
  m.require=id=>{
    if(id==='react')return React;
    if(id==='react/jsx-runtime')return testReq(id);
    if(id==='lucide-react')return new Proxy({}, {get:()=>()=>null});
    if(id==='next/navigation')return {useRouter:()=>router,useSearchParams:()=>params};
    if(id==='@/lib/auth-context')return {useAuth:()=>auth};
    if(id==='@/lib/native-app')return {isNativeApp:()=>native};
    if(id==='@/lib/use-reset-on-return')return {useResetOnReturn:()=>{}};
    if(id==='@/components/ui/logo')return {Logo:box};
    if(id==='@/components/ui/card')return {Card:box,CardHeader:box,CardTitle:box,CardContent:box};
    if(id.startsWith('@/'))return load('src/'+id.slice(2),cache);
    return appReq(id);
  };
  m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,filename);
  return m.exports;
}
const Billing=load('src/app/dashboard/billing/page.tsx').default;
const Plan=load('src/app/onboarding/plan/page.tsx').default;
const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
const find=(tree,label)=>tree.root.findAllByType('button').find(n=>text(n).includes(label));
const post=()=>requests.filter(r=>r.options?.method==='POST');
const reply=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const storage=new Map();
global.sessionStorage={setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k)||null};
global.document={getElementById:()=>null};
global.window={location:{search:'',href:''},history:{replaceState:()=>{}},setTimeout};
function reset(plan='starter') {
  native=false;params=new URLSearchParams();requests=[];nav=[];storage.clear();window.location.search='';
  const shop={id:'shop-a',name:'Test',subscription_plan:plan,subscription_status:plan==='starter'?'inactive':'active',stripe_subscription_id:plan==='starter'?null:'sub_test',trial_used:false};
  auth={accessToken:'test',shop,shops:[shop],plans,refreshShop:async()=>{}};
  api=async url=>reply({plan,subscriptionStatus:shop.subscription_status,amount:plan==='starter'?null:23,nextBilling:'2026-10-17',connect:{connected:false},invoices:[]});
  global.fetch=async (url,options)=>{requests.push({url,options});return api(url,options)};
}
async function mount(Component) {let tree;await act(async()=>{tree=create(React.createElement(Component),{createNodeMock:e=>e.type==='dialog'?{showModal(){}}:null});});return tree;}
async function click(tree,label){const b=find(tree,label);assert(b,`missing ${label}`);await act(async()=>{await b.props.onClick()});}
(async()=>{
  reset();let tree=await mount(Billing);
  await click(tree,'Start free trial');assert.equal(post().length,0);assert.match(text(tree.toJSON()),/23.*CAD \/ month/);assert.match(text(tree.toJSON()),/\$0 today/);
  await click(tree,'Go back');assert.equal(post().length,0);assert.equal(tree.root.findAllByType('dialog').length,0);
  await click(tree,'Start free trial');api=async(url)=>url.includes('start-trial')?reply({ok:true}):reply({plan:'starter',subscriptionStatus:'inactive',connect:{connected:false},invoices:[]});
  await click(tree,'Start my 21-day');assert.equal(post().filter(r=>r.url.includes('start-trial')).length,1);assert.equal(post().filter(r=>r.url.includes('checkout')).length,0);tree.unmount();
  console.log('PASS trial review: no mutation until confirm, CAD price/cycle, cancel safe, correct endpoint');
  reset('pro');tree=await mount(Billing);await click(tree,'Upgrade');assert.equal(post().length,0);assert.match(text(tree.toJSON()),/79.*CAD \/ month/);assert.match(text(tree.toJSON()),/next invoice/);
  api=async url=>url.includes('change-plan')?reply({error:'conflicting_subscription'},409):reply({});
  await click(tree,'Confirm plan change');assert.equal(post().length,1);assert.equal(post()[0].url,'/api/stripe/change-plan');tree.unmount();
  console.log('PASS paid review and unrelated 409 never starts new Checkout');
  reset('pro');tree=await mount(Billing);await click(tree,'Upgrade');
  let release;const pending=new Promise(r=>release=r);
  api=async url=>url.includes('change-plan')?pending:reply({plan:'premium',subscriptionStatus:'active',connect:{connected:false},invoices:[]});
  const confirm=find(tree,'Confirm plan change').props.onClick;
  await act(async()=>{const a=confirm(),b=confirm();assert.equal(post().length,1);assert.equal(JSON.parse(post()[0].options.body).expected_price_cents,7900);release(reply({ok:true}));await Promise.all([a,b]);});tree.unmount();
  console.log('PASS double confirmation sends one mutation with the reviewed price');
  reset();api=async()=>reply({},503);tree=await mount(Billing);assert.match(text(tree.toJSON()),/couldn't load billing/);assert(!find(tree,'Start free trial'));tree.unmount();
  reset('pro');api=async()=>reply({subscriptionCheckError:true});tree=await mount(Billing);assert(!find(tree,'Upgrade'));assert(find(tree,'Retry billing'));tree.unmount();
  reset();native=true;tree=await mount(Billing);assert.equal(tree.toJSON(),null);tree.unmount();
  console.log('PASS failed billing/Stripe reads block actions and native hides billing');
  reset();window.location.search='?upgraded=1&session_id=test';api=async url=>url.includes('confirm-subscription')?reply({ok:false,paid:false}):reply({plan:'starter',subscriptionStatus:'inactive',connect:{connected:false},invoices:[]});tree=await mount(Billing);assert(!text(tree.toJSON()).includes("You're subscribed"));tree.unmount();
  reset();auth.shops=[];auth.shop=null;tree=await mount(Plan);await click(tree,'Continue with free Starter');assert.equal(nav.length,0);assert.equal(storage.size,0);assert.match(text(tree.toJSON()),/No card required and no subscription charges/);await click(tree,'Go back');assert.equal(nav.length,0);
  await click(tree,'Review Pro trial');assert.equal(nav.length,0);await click(tree,'Confirm trial & continue');assert.deepEqual(nav,['/onboarding']);assert.deepEqual(JSON.parse(storage.get('clipwise_plan')),{plan:'pro',trial:true});tree.unmount();
  assert(!fs.readFileSync(path.join(root,'src/app/signup/page.tsx'),'utf8').includes('/api/shops/create'));
  reset();tree=await mount(Plan);assert.deepEqual(nav,['/dashboard/billing']);assert(!find(tree,'Review Pro'));tree.unmount();
  console.log('PASS failed checkout confirmation never claims success; signup requires explicit plan review before shop setup');
})().catch(e=>{console.error(e);process.exitCode=1});

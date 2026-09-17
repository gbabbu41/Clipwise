const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname, '../..'),appReq=Module.createRequire(path.join(root,'package.json')),ts=appReq('typescript'),{NextRequest}=appReq('next/server');
let plans,shops,readFailure,providerCalls,changes,session,sub;
function reset(){plans=[{id:'pro',name:'Pro',is_active:true,price_cents:2300}];shops=[{owner_id:'owner',stripe_subscription_id:'sub1',subscription_status:'past_due'}];readFailure=false;providerCalls=[];changes=[];session={metadata:{user_id:'owner',plan:'premium'},mode:'subscription',status:'complete',payment_status:'paid',customer:'cus1',subscription:'sub1'};sub={metadata:{user_id:'owner',plan:'pro'},status:'active',customer:'cus1'};}
const db={auth:{getUser:async token=>({data:{user:token==='valid'?{id:'owner',email:'qa@example.invalid'}:null}})},from(){let op='read',values;const q={select(){return q},order(){return q},limit(){return q},eq(){return q},update(v){op='update';values=v;return q},then(resolve,reject){return Promise.resolve().then(()=>{if(readFailure)return {error:{},data:null};if(op==='update'){changes.push(values);shops.forEach(s=>Object.assign(s,values));return {error:null}}return {data:shops,count:shops.length}}).then(resolve,reject)}};return q;}};
const stripe={checkout:{sessions:{create:async params=>{providerCalls.push(params);return {url:'https://checkout.stripe.com/test'}},retrieve:async()=>session}},customers:{create:async()=>{throw Error('unexpected')},update:async()=>{throw Error('unexpected')}},subscriptions:{retrieve:async()=>sub}};
const mocks={'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/stripe':{stripe,PLAN_PRICING:{pro:{amount:2300,name:'Pro'},premium:{amount:7900,name:'Premium'}}},'@/lib/plans-server':{ensurePlansHydrated:async()=>plans,getPlanById:(rows,id)=>rows.find(p=>p.id===id)},'@/lib/native-app':{isNativeRequest:r=>r.headers.get('user-agent')==='ClipWiseApp'},'@/lib/validation':{getLocationLimit:()=>1},'@/lib/stripe-addons':{changePlanPrice:async(...args)=>providerCalls.push(args),reconcileLocationAddon:async()=>{}}};
function load(route,method='POST'){const filename=path.join(root,`src/app/api/stripe/${route}/route.ts`),m=new Module(filename,module);m.filename=filename;m.require=id=>mocks[id]??appReq(id);m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);return m.exports[method];}
const checkout=load('checkout'),change=load('change-plan'),verify=load('verify-session','GET');
const req=(body={plan:'pro',expected_price_cents:2300},token='valid')=>new NextRequest('https://clipwise.ca/api/stripe/test',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
const get=()=>new NextRequest('https://clipwise.ca/api/stripe/verify-session?session_id=test',{headers:{Authorization:'Bearer valid'}});
(async()=>{
for(const route of [checkout,change]){
 for(const body of [null,{}, {plan:4},{plan:[]},{plan:'x'.repeat(101)}]){reset();assert.equal((await route(req(body))).status,400);assert.equal(providerCalls.length,0)}
 for(const value of [{is_active:false},{price_cents:0}]){reset();Object.assign(plans[0],value);assert.equal((await route(req())).status,400);assert.equal(providerCalls.length,0)}
 reset();assert.equal((await route(req({plan:'premium'}))).status,400);assert.equal(providerCalls.length,0);
 reset();plans=[];assert.equal((await route(req())).status,200);assert.equal(providerCalls.length,1);
 reset();plans=[];assert.equal((await route(req({plan:'__proto__'}))).status,400);
 reset();assert.equal((await route(req())).status,200);assert.equal(providerCalls.length,1);
 for(const expected of [undefined,2200,2300.5,'2300',null]){reset();const res=await route(req({plan:'pro',expected_price_cents:expected}));assert.equal(res.status,409);assert.equal((await res.json()).error,'price_changed');assert.equal(providerCalls.length,0)}
 reset();plans[0].price_cents=2400;assert.equal((await route(req())).status,409);assert.equal(providerCalls.length,0);
}
reset();assert.equal((await checkout(req({plan:'pro',upgrade:'true'}))).status,400);
reset();readFailure=true;assert.equal((await checkout(req({plan:'pro',upgrade:true,expected_price_cents:2300}))).status,503);assert.equal((await change(req())).status,503);assert.equal(providerCalls.length,0);
reset();assert.equal((await change(req())).status,200);assert.equal(shops[0].subscription_status,'past_due');assert.equal('subscription_status' in changes[0],false);
reset();assert.equal((await checkout(req())).status,200);const price=providerCalls[0].line_items[0].price_data;assert.equal(price.unit_amount,2300);assert.equal(price.currency,'cad');assert.equal(price.recurring.interval,'month');
for(const metadata of [{},{user_id:'foreign'}]){reset();session.metadata=metadata;assert.equal((await verify(get())).status,403)}
reset();sub.metadata.user_id='foreign';assert.equal((await verify(get())).status,403);
reset();sub.customer='foreign';assert.equal((await verify(get())).status,403);
for(const status of ['canceled','past_due','incomplete']){reset();sub.status=status;assert.deepEqual(await (await verify(get())).json(),{paid:false})}
reset();session.mode='payment';assert.deepEqual(await (await verify(get())).json(),{paid:false});
reset();session.payment_status='unpaid';assert.deepEqual(await (await verify(get())).json(),{paid:false});
reset();let result=await (await verify(get())).json();assert.equal(result.paid,true);assert.equal(result.plan,'pro');
reset();session.payment_status='no_payment_required';sub.status='trialing';assert.equal((await (await verify(get())).json()).paid,true);
console.log('PASS catalog inactive/free/missing enforcement, fallback preservation, runtime input, failed reads, past-due preservation, authoritative CADmonthly price and session/current-subscription ownership/status guards');
})().catch(e=>{console.error(e);process.exitCode=1});

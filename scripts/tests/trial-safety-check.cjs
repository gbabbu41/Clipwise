const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname, '../..'),appReq=Module.createRequire(path.join(root,'package.json')),ts=appReq('typescript');
const {NextRequest}=appReq('next/server');
let rows,readFailure,writeFailure,writes,emails;
function reset(){rows=[{id:'shop1',owner_id:'owner',status:'approved',subscription_plan:'starter',subscription_status:'inactive',stripe_subscription_id:null,trial_ends_at:null,trial_ended_at:null,trial_used:false}];readFailure=false;writeFailure=false;writes=0;emails=[];}
const db={auth:{async getUser(token){return {data:{user:token==='valid'?{id:'owner',email:'qa@example.invalid'}:null}}}},from(table){let filters=[],op='read',values,one=false;
 const q={select(){return q},order(){return q},limit(){return q},eq(k,v){filters.push([k,v]);return q},is(k,v){filters.push([k,v]);return q},update(v){op='update';values=v;return q},insert(v){op='insert';values=v;return q},single(){one=true;return q},maybeSingle(){one=true;return q},then(resolve,reject){return Promise.resolve().then(()=>{
  if(table==='users')return {data:{name:'QA'},error:null};
  if(op==='read'){if(readFailure)return {data:null,error:{message:'failed'}};const found=rows.filter(r=>filters.every(([k,v])=>r[k]===v)).map(r=>({...r}));return {data:one?found[0]??null:found,error:null};}
  writes++;if(writeFailure)return {data:null,error:{message:'column trial_used does not exist'}};
  if(op==='insert'){const r={...values,id:'newshop'};rows.push(r);return {data:r,error:null};}
  const found=rows.filter(r=>filters.every(([k,v])=>r[k]===v));found.forEach(r=>Object.assign(r,values));return {data:one?found[0]??null:found,error:null};
 }).then(resolve,reject)}};return q;}};
const mocks={'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/native-app':{isNativeRequest:r=>r.headers.get('user-agent')==='ClipWiseApp'},'@/lib/stripe':{stripe:{subscriptions:{retrieve:async()=>{throw Error('No live Stripe')}}}},'@/lib/platform-settings':{getPlatformSettings:async()=>({auto_approve_shops:true})},'@/lib/validation':{clampLen:x=>x,FIELD_CAPS:{shop_description:500},effectivePlan:(p,s)=>s==='active'?p:'starter',planHasFeature:p=>p==='pro'||p==='premium'},'@/lib/plans-server':{ensurePlansHydrated:async()=>[]},'@/lib/booking-defaults':{DEFAULT_BOOKING_SETTINGS:{}},'@/lib/timezone':{tzForProvince:()=>null,DEFAULT_TZ:'America/Halifax'},'@/lib/emailer':{sendAppEmail:async(type,data)=>emails.push({type,data})},'@/lib/utils':{prettyDate:x=>x}};
function load(route){const filename=path.join(root,route),m=new Module(filename,module);m.filename=filename;m.require=id=>mocks[id]??appReq(id);m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,filename);return m.exports.POST;}
const trial=load('src/app/api/shops/start-trial/route.ts'),create=load('src/app/api/shops/create/route.ts');
const req=(body={},token='valid',native=false)=>new NextRequest('https://clipwise.ca/api/shops/start-trial',{method:'POST',headers:{Authorization:`Bearer ${token}`,...native?{'user-agent':'ClipWiseApp'}:{}},body:JSON.stringify(body)});
(async()=>{
 reset();assert.equal((await trial(req({plan:'pro'},'bad'))).status,401);assert.equal((await trial(req({plan:'pro'},'valid',true))).status,403);assert.equal(writes,0);
 reset();assert.equal((await trial(req({plan:2}))).status,400);assert.equal((await trial(req({plan:'pro',shop_id:'foreign'}))).status,404);assert.equal(writes,0);
 for(const body of [null,[],42]){reset();assert.equal((await trial(req(body))).status,400);assert.equal(writes,0);rows=[];assert.equal((await create(req(body))).status,400);assert.equal(writes,0);}
 for(const body of [{name:3},{name:[]},{name:'QA',province:[]},{name:'QA',trial_plan:9},{name:'QA',description:{}}]){reset();rows=[];assert.equal((await create(req(body))).status,400);assert.equal(writes,0);}
 reset();readFailure=true;assert.equal((await trial(req({plan:'pro'}))).status,503);assert.equal((await create(req({name:'QA'}))).status,503);assert.equal(writes,0);
 for(const key of ['trial_used','trial_ends_at','trial_ended_at','stripe_subscription_id']){reset();rows[0][key]=key==='trial_used'?true:'previous';assert.equal((await trial(req({plan:'pro'}))).status,409);assert.equal(writes,0);}
 reset();const concurrent=await Promise.all([trial(req({plan:'pro'})),trial(req({plan:'premium'}))]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);assert.equal(rows[0].trial_used,true);assert(Math.abs(new Date(rows[0].trial_ends_at)-Date.now()-21*86400000)<1000);
 reset();writeFailure=true;assert.equal((await trial(req({plan:'pro'}))).status,500);assert.equal(writes,1);assert.equal(rows[0].trial_used,false);
 reset();rows=[];let result=await create(req({name:'QA Trial',trial_plan:'pro'}));assert.equal(result.status,200);assert.equal(rows[0].trial_used,true);assert.equal(rows[0].subscription_plan,'pro');assert.equal(emails.find(e=>e.type==='shop_welcome').data.paymentsEnabled,'true');
 reset();rows=[];result=await create(req({name:'QA Starter'}));assert.equal(result.status,200);assert.equal(rows[0].trial_used,false);assert.equal(rows[0].subscription_plan,'starter');assert.equal(emails.find(e=>e.type==='shop_welcome').data.paymentsEnabled,'false');
 reset();rows=[];writeFailure=true;assert.equal((await create(req({name:'QA',trial_plan:'pro'}))).status,500);assert.equal(writes,1);assert.equal(rows.length,0);
 console.log('PASS trial auth/native/ownership/input, failed reads, permanent history, concurrent single grant, 21-day duration, fail-closed schema errors, new-shop trial persistence and plan-aware welcome');
})().catch(e=>{console.error(e);process.exitCode=1});

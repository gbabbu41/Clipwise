const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname, '../..'),appReq=Module.createRequire(path.join(root,'package.json')),ts=appReq('typescript'),{NextRequest}=appReq('next/server');
let session,subs,rows,writes,stripeWrites,readFailure,cleanup;
function reset(){session={status:'complete',payment_status:'paid',mode:'subscription',subscription:'sub1',customer:'cus1',metadata:{user_id:'owner',plan:'pro'}};subs={sub1:{id:'sub1',customer:'cus1',status:'active',metadata:{user_id:'owner',plan:'pro'}}};rows=[{id:'shop1',name:'QA',owner_id:'owner',stripe_subscription_id:null,subscription_plan:'starter'}];writes=0;stripeWrites=0;readFailure=false;cleanup=[];}
const db={auth:{async getUser(token){return {data:{user:token==='valid'?{id:'owner'}:null}}}},from(table){let op='read',values,one=false,filters=[],opts;
const q={select(s,o){opts=o;return q},order(){return q},limit(){return q},eq(k,v){filters.push([k,v]);return q},update(v){op='update';values=v;return q},maybeSingle(){one=true;return q},then(resolve,reject){return Promise.resolve().then(()=>{if(table==='plans')return {data:{name:'Pro'}};if(readFailure&&op==='read')return {data:null,error:{}};const found=rows.filter(r=>filters.every(([k,v])=>r[k]===v));if(op==='update'){writes++;found.forEach(r=>Object.assign(r,values));return {error:null}}return {data:one?found[0]??null:found.map(r=>({...r})),count:opts?.count?found.length:undefined,error:null}}).then(resolve,reject)}};return q;}};
const stripe={checkout:{sessions:{retrieve:async()=>session}},subscriptions:{retrieve:async id=>{if(!subs[id])throw Error('Missing');return subs[id]}},customers:{update:async()=>{stripeWrites++}}};
const mocks={'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/native-app':{isNativeRequest:r=>r.headers.get('user-agent')==='ClipWiseApp'},'@/lib/stripe':{stripe},'@/lib/plans-server':{ensurePlansHydrated:async()=>[]},'@/lib/validation':{getLocationLimit:()=>1},'@/lib/stripe-addons':{reconcileLocationAddon:async()=>{stripeWrites++},reconcileAiPhoneAddon:async()=>{stripeWrites++}},'@/lib/stripe-subscription':{cancelDuplicateSubscriptions:async(...args)=>cleanup.push(args)}};
let sentEmail=null,emailFailure=false;
mocks['@/lib/emailer']={sendAppEmail:async(type,data)=>{sentEmail={type,data};if(emailFailure)throw Error('Email unavailable')}};
const filename=path.join(root,'src/app/api/stripe/confirm-subscription/route.ts'),m=new Module(filename,module);m.filename=filename;m.require=id=>mocks[id]??appReq(id);m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
const req=(body={session_id:'session1'},token='valid',native=false)=>new NextRequest('https://clipwise.ca/api/stripe/confirm-subscription',{method:'POST',headers:{Authorization:`Bearer ${token}`,...native?{'user-agent':'ClipWiseApp'}:{}},body:JSON.stringify(body)});
async function rejected(status){const res=await m.exports.POST(req());assert.equal(res.status,status);assert.equal(writes,0);assert.equal(stripeWrites,0);assert.equal(cleanup.length,0);}
(async()=>{
reset();assert.equal((await m.exports.POST(req({},'bad'))).status,401);assert.equal((await m.exports.POST(req({},'valid',true))).status,403);assert.equal((await m.exports.POST(req({session_id:5}))).status,400);
reset();session.metadata.user_id='someone';await rejected(403);
reset();subs.sub1.metadata.user_id='someone';await rejected(403);
reset();subs.sub1.customer='foreign';await rejected(403);
for(const status of ['canceled','incomplete','past_due','unpaid','incomplete_expired']){reset();subs.sub1.status=status;await rejected(409);}
reset();delete subs.sub1;await rejected(502);
reset();readFailure=true;await rejected(503);
reset();session.payment_status='unpaid';const unpaid=await m.exports.POST(req());assert.equal((await unpaid.json()).paid,false);assert.equal(writes,0);
reset();rows[0].stripe_subscription_id='newer';subs.newer={status:'active'};await rejected(409);
reset();rows[0].stripe_subscription_id='newer';await rejected(502);
reset();rows.push({...rows[0],id:'shop2',stripe_subscription_id:'newer'});subs.newer={status:'trialing'};await rejected(409);
reset();rows[0].stripe_subscription_id='old';subs.old={status:'active'};session.metadata.old_subscription_id='old';assert.equal((await m.exports.POST(req())).status,200);assert.equal(rows[0].stripe_subscription_id,'sub1');assert.deepEqual(cleanup[0],['cus1','sub1','old']);
reset();session.metadata.plan='premium';subs.sub1.metadata.plan='pro';assert.equal((await m.exports.POST(req())).status,200);assert.equal(rows[0].subscription_plan,'pro');assert.equal((await m.exports.POST(req())).status,200);assert.equal(rows[0].subscription_plan,'pro');
reset();session.payment_status='no_payment_required';subs.sub1.status='trialing';assert.equal((await m.exports.POST(req())).status,200);assert.equal(rows[0].subscription_status,'active');
reset();rows[0].email='qa@example.invalid';emailFailure=true;assert.equal((await m.exports.POST(req())).status,200);assert.equal(sentEmail.type,'subscription_started');assert.equal(sentEmail.data.ownerEmail,'qa@example.invalid');
console.log('PASS subscription confirm auth/native/input/owner/customer/current-state guards, unpaid and stale URL refusal, all-location conflict check, authorized replacement, current plan metadata and repeated confirmation');
})().catch(e=>{console.error(e);process.exitCode=1});

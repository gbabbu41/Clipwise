const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'../..'),req=Module.createRequire(path.join(root,'package.json')),ts=req('typescript'),{NextRequest}=req('next/server');
const id='11111111-1111-4111-8111-111111111111';
let role,fail,shop,sends,reads,sendFailure;
function reset(){role='super_admin';fail='';sends=[];reads=[];sendFailure=false;shop={id,name:'Saved Shop',slug:'saved-shop',email:'contact@example.invalid',status:'approved',rejection_reason:'Saved reason',users:{name:'Saved Owner',email:'owner@example.invalid'}};}
const db={auth:{getUser:async token=>({data:{user:token==='valid'&&fail!=='auth'?{id:'admin'}:null}})},from(table){const filters=[];const q={select(){return q;},eq(...a){filters.push(a);return q;},single(){return q;},maybeSingle(){return q;},then(resolve,reject){return Promise.resolve().then(()=>{reads.push({table,filters});if(fail===table)return{data:null,error:{message:'private failure'}};if(table==='users')return{data:{role},error:null};assert.equal(table,'shops');return{data:filters.some(([k,v])=>k==='id'&&v===id)?shop:null,error:null};}).then(resolve,reject);}};return q;}};
const mocks={'@/lib/supabase-admin':{supabaseAdmin:db},'./supabase-admin':{supabaseAdmin:db},'@/lib/emailer':{SERVER_ONLY_EMAIL_TYPES:new Set(),PRIVILEGED_EMAIL_TYPES:new Set(),sendAppEmail:async(type,data)=>{sends.push({type,data});return sendFailure?{error:'provider rejected'}:{success:true};}},'@/lib/validation':{},'@/lib/plans-server':{},'@/lib/rate-limit':{enforceRateLimit:()=>null},'@/lib/admin-audit':{logAdminAction:()=>{throw Error('must not mutate');}}};
function load(relative){const file=path.join(root,relative),m=new Module(file,module);m.require=n=>mocks[n]??(n.startsWith('@/')?load('src/'+n.slice(2)+'.ts'):req(n));m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);return m.exports;}
const {POST}=load('src/app/api/send-email/route.ts');
const forged={shopId:id,ownerEmail:'attacker@example.invalid',ownerName:'Forged',shopName:'Forged',slug:'attacker',reason:'Forged',role:'super_admin'};
const call=(type='shop_approved',token='valid',data=forged)=>POST(new NextRequest('https://clipwise.ca/api/send-email',{method:'POST',headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),'x-internal-secret':'fixture',Origin:'https://attacker.invalid'},body:JSON.stringify({type,data})}));
(async()=>{
process.env.RESEND_API_KEY='dummy';process.env.CRON_SECRET='fixture';
reset();assert.equal((await call('shop_approved','')).status,403,'anonymous approval notification must be rejected');assert.equal(sends.length,0);
for(const type of ['shop_approved','shop_rejected']){
  for(const who of ['shop_owner','barber','customer']){reset();role=who;assert.equal((await call(type)).status,403);assert.equal(sends.length,0);}
  for(const token of ['','expired']){reset();assert.equal((await call(type,token)).status,403);assert.equal(sends.length,0);}
  reset();shop.status=type==='shop_approved'?'approved':'rejected';assert.equal((await call(type)).status,200);assert.deepEqual(sends,[{type,data:{shopName:'Saved Shop',ownerName:'Saved Owner',ownerEmail:'owner@example.invalid',slug:'saved-shop',reason:'Saved reason'}}]);
  reset();shop.status=type==='shop_approved'?'rejected':'approved';assert.equal((await call(type)).status,409);assert.equal(sends.length,0);
}
for(const table of ['auth','users','shops']){reset();fail=table;const r=await call();assert.ok(r.status>=400);assert.equal(sends.length,0);assert.doesNotMatch(await r.text(),/private/);}
for(const data of [null,{}, {shopId:[]},{shopId:'not-uuid'}]){reset();assert.equal((await call('shop_approved','valid',data)).status,400);assert.equal(sends.length,0);}
reset();shop=null;assert.equal((await call()).status,404);assert.equal(sends.length,0);
reset();shop.users=null;await call();assert.equal(sends[0].data.ownerEmail,'contact@example.invalid');
reset();shop.users=[{name:'Array Owner',email:'array@example.invalid'}];await call();assert.equal(sends[0].data.ownerEmail,'array@example.invalid');
reset();shop.users=null;shop.email='';assert.equal((await call()).status,400);assert.equal(sends.length,0);
reset();sendFailure=true;assert.equal((await call()).status,400);assert.equal(shop.status,'approved');
for(const route of ['src/app/api/admin/shops/route.ts','src/app/api/admin/shops/[id]/route.ts']){reset();const {PATCH}=load(route);const r=await PATCH(new NextRequest('https://clipwise.ca/api/admin/shops',{method:'PATCH',body:JSON.stringify({id,status:'approved'})}),{params:{id}});assert.equal(r.status,403);assert.equal(reads.length,0);assert.equal(sends.length,0);}
// Execute the actual browser handlers, not a rewritten notification surrogate.
for(const [file,names] of [['src/app/admin/page.tsx',['approveShop','rejectShop']],['src/app/admin/shops/page.tsx',['approveShop','rejectShop']],['src/app/admin/shops/[id]/page.tsx',['setStatus']]]){
  const source=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  for(const name of names){
    let declaration;function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(source)===name)declaration=n;ts.forEachChild(n,visit);}visit(source);assert.ok(declaration);
    for(const outcome of ['success','http','network','json','malformed']){
      reset();const saved=shop;let patchCount=0,requests=[],toasts=[],display=saved;
      const env={accessToken:'valid',shop:saved,rejectModal:saved,rejectReason:'Reason',
        auth:()=>({Authorization:'Bearer valid','Content-Type':'application/json'}),
        patchShop:async()=>{patchCount++;return{ok:true};},updateStatus:async()=>{patchCount++;return true;},patch:async()=>{patchCount++;return{ok:true};},
        setSavingId:()=>{},setSavingStatus:()=>{},setRejectModal:()=>{},setRejectOpen:()=>{},setRejectReason:()=>{},
        setShops:fn=>{display=fn([saved])[0];},setShop:fn=>{display=fn(saved);},showToast:(msg,ok)=>toasts.push({msg,ok}),
        fetch:async(url,init)=>{requests.push({url,init});if(outcome==='network')throw Error('offline');return{ok:outcome!=='http',json:async()=>{if(outcome==='json')throw Error('bad json');return outcome==='malformed'?{}:{success:true};}};}};
      const code=ts.transpileModule('const '+declaration.getText(source)+';return '+name+';',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
      const handler=new Function(...Object.keys(env),code)(...Object.values(env));
      await handler(name==='setStatus'?'approved':saved);await new Promise(resolve=>setImmediate(resolve));
      assert.equal(patchCount,1);assert.equal(requests.length,1);assert.equal(requests[0].url,'/api/send-email');assert.equal(requests[0].init.headers.Authorization,'Bearer valid');
      assert.deepEqual(JSON.parse(requests[0].init.body).data,{shopId:id});assert.equal(display.status,name==='rejectShop'?'rejected':'approved');
      if(outcome!=='success')assert.match(toasts.at(-1).msg,/email not confirmed.*Do not repeat/);else assert.ok(!toasts.some(t=>/not confirmed/.test(t.msg)));
    }
  }
}
console.log('PASS admin email: anonymous/staff/secret denial, canonical saved recipient/content, valid admin, status/read/contact guards and protected approval mutations');
})().catch(e=>{console.error(e);process.exitCode=1;});

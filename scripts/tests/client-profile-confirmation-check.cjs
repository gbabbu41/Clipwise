const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const source=fs.readFileSync(process.env.CLIPWISE_PROFILE_SOURCE || path.resolve(__dirname,'../../src/app/dashboard/clients/page.tsx'),'utf8');
const body=source.slice(source.indexOf('  const saveNotes ='),source.indexOf('  const sendBirthdayEmail ='));
const code=ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function setup(mode){const client={id:'client',shop_id:'shop',notes:'old',birthday:'',email:'old@example.test'};
const state={selected:client,clients:[client],busy:false,toasts:[],field:'email',filters:[],error:null,materializations:0,writes:0};
const env={profileSavePending:{current:false},uncertainProfileSaves:{current:new Set()},profileMounted:{current:true},setProfileSaveError:v=>state.error=v,selectedClient:client,shop:{id:'shop'},activeShopId:{current:'shop'},notes:'draft',birthday:'2000-01-01',hairProfile:{styleNotes:'draft'},editField:'email',fieldDraft:'draft@example.test',profileState:{current:{clientId:'client',editField:'email',fieldDraft:'draft@example.test'}},
ensureRealClient:async()=>{state.materializations++;if(mode==='materializeThrow')throw Error('offline');return 'client';},formatPhone:s=>s,showToast:m=>state.toasts.push(m),
setSaving:v=>state.busy=v,setSavingHair:v=>state.busy=v,setSavingBirthday:v=>state.busy=v,setSavingField:v=>state.busy=v,setFieldDraft:()=>{},setEditField:v=>state.field=v,
setSelectedClient:fn=>state.selected=fn(state.selected),setClients:fn=>state.clients=fn(state.clients),
supabase:{from:()=>{const result=()=>{if(mode==='throw')return Promise.reject(Error('offline'));return Promise.resolve({data:mode==='zero'?null:{id:mode==='wrong'?'other':'client'},error:mode==='error'?{message:'private'}:null});};const q={update:()=>{state.writes++;return q;},eq:(...args)=>{state.filters.push(args);return q;},select:()=>q,maybeSingle:result,then:(a,b)=>result().then(a,b)};return q;}}};
return{state,env,handlers:new Function(...Object.keys(env),code+';return {saveNotes,saveHairProfile,saveBirthday,saveContactField};')(...Object.values(env))};}
(async()=>{for(const name of ['saveNotes','saveHairProfile','saveBirthday','saveContactField']){
for(const mode of ['zero','wrong','error','throw','materializeThrow']){const p=setup(mode),before=JSON.stringify(p.state.selected);await p.handlers[name]();assert.equal(JSON.stringify(p.state.selected),before,name+' must retain displayed data without confirmed write');assert.equal(p.state.field,'email');assert.equal(p.state.busy,false);assert(!p.state.toasts.some(t=>/saved!/i.test(t)),name+' must not report unconfirmed save');assert(p.state.error);if(mode!=='zero'){await p.handlers[name]();assert.equal(p.state.materializations,1,'uncertain outcomes do not replay materialization');}}
const p=setup('success');await p.handlers[name]();assert(p.state.toasts.some(t=>/saved!/i.test(t)));assert.equal(p.state.busy,false);assert(p.state.filters.some(([k,v])=>k==='shop_id'&&v==='shop'),'writes must retain captured shop scope');
}
for(const name of ['saveNotes','saveHairProfile','saveBirthday','saveContactField']){
const p=setup('success');let release;p.env.ensureRealClient=async()=>{p.state.materializations++;await new Promise(r=>release=r);return 'client';};
// Recompile to use the held materialization callback.
p.handlers=new Function(...Object.keys(p.env),code+';return {saveNotes,saveHairProfile,saveBirthday,saveContactField};')(...Object.values(p.env));
const pending=p.handlers[name]();await p.handlers.saveNotes();await p.handlers.saveBirthday();assert.equal(p.state.materializations,1,'shared pending guard prevents overlapping materialization');release();await pending;assert.equal(p.state.writes,1);
}
for(const kind of ['selection','shop','unmount']){
const p=setup('success');let release;p.env.ensureRealClient=async()=>{await new Promise(r=>release=r);return 'client';};p.handlers=new Function(...Object.keys(p.env),code+';return {saveNotes};')(...Object.values(p.env));
const pending=p.handlers.saveNotes();if(kind==='selection')p.env.profileState.current.clientId='other';if(kind==='shop')p.env.activeShopId.current='other';if(kind==='unmount')p.env.profileMounted.current=false;release();await pending;assert.equal(p.state.writes,0,'stale materialization must not start follow-on write');assert.equal(p.state.toasts.length,0);
}
const synthetic=setup('success');synthetic.env.selectedClient.id='synthetic:client';synthetic.env.profileState.current.clientId='synthetic:client';await synthetic.handlers.saveNotes();assert.equal(synthetic.state.selected.id,'client');assert.equal(synthetic.state.selected.notes,'draft');assert.equal(synthetic.state.materializations,1);
for(const kind of ['selection','shop','unmount']){
 const p=setup('success');let release;const held=new Promise(r=>release=r);
 p.env.supabase={from:()=>{const q={update:()=>q,eq:()=>q,select:()=>q,maybeSingle:async()=>{await held;return{data:{id:'client'},error:null};}};return q;}};
 p.handlers=new Function(...Object.keys(p.env),code+';return {saveNotes};')(...Object.values(p.env));
 const pending=p.handlers.saveNotes();await new Promise(r=>setImmediate(r));
 if(kind==='selection')p.env.profileState.current.clientId='other';if(kind==='shop')p.env.activeShopId.current='other';if(kind==='unmount')p.env.profileMounted.current=false;
 release();await pending;assert.equal(p.state.selected.notes,'old');assert.equal(p.state.toasts.length,0);assert.equal(p.state.error,null);
}
const syntheticRejected=setup('zero');syntheticRejected.env.selectedClient.id='synthetic:client';syntheticRejected.env.profileState.current.clientId='synthetic:client';await syntheticRejected.handlers.saveNotes();await syntheticRejected.handlers.saveNotes();assert.equal(syntheticRejected.state.materializations,1,'confirmed materialization plus rejected update must not re-materialize blindly');
console.log('PASS client profile confirmation: zero/wrong row, DB/network/materialization failure, draft/editor preservation, released busy and confirmed scoped success');})().catch(e=>{console.error(e);process.exitCode=1;});

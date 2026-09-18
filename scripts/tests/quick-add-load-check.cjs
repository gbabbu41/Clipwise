const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const source=fs.readFileSync(path.resolve(__dirname,'../../src/components/dashboard/add-appointment-modal.tsx'),'utf8');
const start=source.indexOf('  // Load barbers + services + clients'),end=source.indexOf('  // One-barber shop:',start);
const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(locked=false){let cleanup;const state={reads:[],barbers:[],services:[],clients:[],barberId:'',loading:true,error:'',loaded:''};
 const env={open:true,shop:{id:'shop'},lockBarber:locked?{id:'fixed',name:'Fixed'}:null,preferUserId:'owner',resourceScope:'shop:scope',resourceAttempt:0,activeResourceScope:{current:'shop:scope'},
 useEffect:fn=>{cleanup=fn();},setBarbers:v=>{state.barbers=v;},setServices:v=>{state.services=v;},setClients:v=>{state.clients=v;},setBarberId:v=>{state.barberId=typeof v==='function'?v(state.barberId):v;},
 setResourcesLoading:v=>{state.loading=v;},setResourcesError:v=>{state.error=v;},setLoadedResourceScope:v=>{state.loaded=v;},
 supabase:{from:table=>{const promise=new Promise((resolve,reject)=>{state.reads.push({table,resolve,reject,filters:[]});});const row=state.reads.at(-1);const q={select:()=>q,eq:(...args)=>{row.filters.push(args);return q;},order:()=>q,limit:()=>q,then:promise.then.bind(promise)};return q;}}};
 return{state,env,run:()=>new Function(...Object.keys(env),code)(...Object.values(env)),cleanup:()=>cleanup?.()};}
function resolveAll(p,fail=null,isNull=false){for(const r of p.state.reads.filter(r=>!r.done)){r.done=true;r.resolve(r.table===fail?{data:null,error:isNull?null:{message:'private'}}:{data:[],error:null});}}
(async()=>{
 for(const table of ['barbers','services','clients'])for(const isNull of [true,false]){const p=setup();p.run();resolveAll(p,table,isNull);await flush();assert(p.state.error,'failed prerequisite must offer retry');assert.equal(p.state.loading,false);assert.equal(p.state.loaded,'');p.cleanup();p.run();resolveAll(p);await flush();assert.equal(p.state.error,'');assert.equal(p.state.loaded,p.env.resourceScope);}
 const p=setup();p.run();for(const r of p.state.reads){r.resolve({data:r.table==='barbers'?[{id:'other',user_id:'other'},{id:'mine',user_id:'owner'}]:[{id:r.table}],error:null});}await flush();assert.equal(p.state.barbers[0].id,'mine');assert.equal(p.state.barberId,'mine');assert.equal(p.state.loaded,p.env.resourceScope);assert(p.state.reads.every(r=>r.filters.some(([key,value])=>key==='shop_id'&&value==='shop')));
 const manual=setup();manual.state.barberId='manual';manual.run();for(const r of manual.state.reads)r.resolve({data:r.table==='barbers'?[{id:'mine',user_id:'owner'}]:[],error:null});await flush();assert.equal(manual.state.barberId,'manual');
 const locked=setup(true);locked.run();resolveAll(locked);await flush();assert.equal(locked.state.barberId,'fixed');assert.equal(locked.state.reads.length,2);assert.equal(locked.state.error,'');
 for(const mode of ['cleanup','scope']){const p=setup();p.run();if(mode==='cleanup')p.cleanup();else p.env.activeResourceScope.current='other';for(const r of p.state.reads)r.resolve({data:[{id:'late'}],error:null});await flush();assert.deepEqual(p.state.barbers,[]);assert.deepEqual(p.state.clients,[]);assert.equal(p.state.loaded,'');}
 const missingShop=setup();missingShop.env.shop=null;missingShop.run();assert.equal(missingShop.state.reads.length,0);assert.equal(missingShop.state.loading,false);assert.match(missingShop.state.error,/Choose a shop/);
 const offline=setup();offline.run();offline.state.reads[0].reject(Error('offline'));for(const r of offline.state.reads.slice(1))r.resolve({data:[],error:null});await flush();assert(offline.state.error);assert.equal(offline.state.loading,false);
 console.log('PASS quick-add prerequisite reads: error/null/offline retry, scoped success and empty lists, preferred/manual/locked barber preservation, late cleanup/scope suppression');
})().catch(error=>{console.error(error);process.exitCode=1;});

const ast=ts.createSourceFile('modal.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),handlers={};
function visit(node){if(ts.isVariableDeclaration(node)&&['submit','openIt'].includes(node.name.getText(ast)))handlers[node.name.getText(ast)]=node.initializer.getText(ast);ts.forEachChild(node,visit);}visit(ast);
const compile=expression=>ts.transpileModule('const action='+expression,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
new Function('resourcesReady',compile(handlers.submit)+';return action;')(false)().catch(error=>{console.error(error);process.exitCode=1;});
let opening={loading:false,loaded:'old',open:false};
const env={submitState:{current:"idle"},submitContext:{current:0},setSubmitError:()=>{},setSubmitUncertain:()=>{},open:false,saving:false,shop:{id:'shop'},lockBarber:null,reset:()=>{},requestCalendarAddContext:()=>({}),setOpen:v=>{opening.open=v;},setResourcesLoading:v=>{opening.loading=v;},setResourcesError:()=>{},setLoadedResourceScope:v=>{opening.loaded=v;}};
new Function(...Object.keys(env),compile(handlers.openIt)+';return action;')(...Object.values(env))({});
assert.deepEqual(opening,{loading:true,loaded:'',open:true},'each opening must wait for fresh confirmed prerequisites');
const scopeStart=source.indexOf('  // A location/account change'),scopeEnd=source.indexOf('  // Animated close:',scopeStart);
assert(scopeStart>=0);const scopeCode=ts.transpileModule(source.slice(scopeStart,scopeEnd),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
for(const changed of [false,true]){let clears=0;const scope={submitState:{current:'idle'},submitContext:{current:0},setSubmitError:()=>{},setSubmitUncertain:()=>{},setSaving:()=>{},UNCERTAIN_BOOKING_MESSAGE:'Check calendar',resourceScope:'new',previousResourceScope:{current:changed?'old':'new'},reset:()=>{clears++;},setOpen:()=>{},setShown:()=>{},useEffect:fn=>fn()};new Function(...Object.keys(scope),scopeCode)(...Object.values(scope));assert.equal(clears,changed?1:0,'same-scope retries preserve draft; changed scope clears it');}
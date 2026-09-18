const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const source=fs.readFileSync(path.resolve(__dirname,'../../src/app/book/[shopslug]/booking-client.tsx'),'utf8');
const start=source.indexOf('  // ── Load shop + barbers + services'),end=source.indexOf('  // ── Handle return from Stripe',start);
assert(start>=0&&end>start);const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(slug='one'){
 let cleanup;const state={loading:true,error:false,shop:null,barbers:[],services:[],reviews:[],reads:[]};
 const env={shopslug:slug,currentShopSlug:{current:slug},useEffect:fn=>{cleanup=fn();},setPageLoading:v=>{state.loading=v;},setLoadError:v=>{state.error=v;},setShop:v=>{state.shop=v;},setBarbers:v=>{state.barbers=v;},setServices:v=>{state.services=v;},setReviews:v=>{state.reviews=v;},
 supabase:{from:table=>{const promise=new Promise((resolve,reject)=>{state.reads.push({table,resolve,reject});});const q={select:()=>q,eq:()=>q,maybeSingle:()=>q,not:()=>q,order:()=>q,limit:()=>q,then:promise.then.bind(promise)};return q;}}};
 return{state,env,run:()=>new Function(...Object.keys(env),code)(...Object.values(env)),cleanup:()=>cleanup?.()};
}
const shop={id:'shop',slug:'one',status:'approved'};
async function begin(p){p.run();p.state.reads[0].resolve({data:shop,error:null});await flush();}
function reply(p,table,value){p.state.reads.findLast(r=>r.table===table).resolve(value);}
(async()=>{
 for(const table of ['barbers','services'])for(const failure of [{data:null,error:{message:'private'}},{data:null,error:null}]){
   const p=setup();await begin(p);reply(p,table,failure);reply(p,table==='barbers'?'services':'barbers',{data:[],error:null});reply(p,'reviews',{data:[],error:null});await flush();assert.equal(p.state.error,true,'essential read failure must show retry, not an empty shop');assert.equal(p.state.loading,false);
 }
 for(const throwReview of [false,true]){const p=setup();await begin(p);reply(p,'barbers',{data:[{id:'b'}],error:null});reply(p,'services',{data:[{id:'s'}],error:null});const review=p.state.reads.find(r=>r.table==='reviews');if(throwReview)review.reject(Error('offline'));else review.resolve({data:null,error:{message:'optional'}});await flush();assert.equal(p.state.error,false);assert.equal(p.state.loading,false);assert.deepEqual(p.state.barbers,[{id:'b'}]);assert.deepEqual(p.state.reviews,[]);}
 const empty=setup();await begin(empty);for(const table of ['barbers','services','reviews'])reply(empty,table,{data:[],error:null});await flush();assert.equal(empty.state.error,false);assert.deepEqual(empty.state.services,[]);
 for(const data of [null,{...shop,status:'pending'}]){const p=setup();p.run();p.state.reads[0].resolve({data,error:null});await flush();assert.equal(p.state.error,false);assert.equal(p.state.reads.length,1);assert.equal(p.state.loading,false);}
 for(const change of ['unmount','slug']){const p=setup();await begin(p);if(change==='unmount')p.cleanup();else p.env.currentShopSlug.current='two';for(const table of ['barbers','services','reviews'])reply(p,table,{data:[{id:'old'}],error:null});await flush();assert.deepEqual(p.state.barbers,[]);assert.deepEqual(p.state.services,[]);}
 const failedShop=setup();failedShop.run();failedShop.state.reads[0].resolve({data:null,error:{message:'db'}});await flush();assert.equal(failedShop.state.error,true);assert.equal(failedShop.state.loading,false);
 const offline=setup();offline.run();offline.state.reads[0].reject(Error('offline'));await flush();assert.equal(offline.state.error,true);
 failedShop.cleanup();failedShop.run();failedShop.state.reads[1].resolve({data:shop,error:null});await flush();for(const table of ['barbers','services','reviews'])reply(failedShop,table,{data:[],error:null});await flush();assert.equal(failedShop.state.error,false);
 const lateShop=setup();lateShop.run();lateShop.cleanup();lateShop.state.reads[0].resolve({data:shop,error:null});await flush();assert.equal(lateShop.state.shop,null);assert.equal(lateShop.state.reads.length,1);
 const ast=ts.createSourceFile('booking-client.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const handlers={};function visit(node){if(ts.isVariableDeclaration(node)&&['confirmBooking','joinWaitlist'].includes(node.name.getText(ast)))handlers[node.name.getText(ast)]=node.initializer.getText(ast);ts.forEachChild(node,visit);}visit(ast);
 for(const expression of Object.values(handlers)){const handlerCode=ts.transpileModule('const action='+expression,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;await new Function('bookingReady',handlerCode+';return action;')(false)();}assert.equal(Object.keys(handlers).length,2);
 console.log('PASS public booking prerequisites: failed/null essential reads, optional reviews, genuine empty/missing/pending shops, offline failure, cleanup/slug guards and fresh retry success');
})().catch(error=>{console.error(error);process.exitCode=1;});

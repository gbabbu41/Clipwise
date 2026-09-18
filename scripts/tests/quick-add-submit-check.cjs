const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const source=fs.readFileSync(path.resolve(__dirname,'../../src/components/dashboard/add-appointment-modal.tsx'),'utf8');
const start=source.indexOf('  const submit ='),end=source.indexOf('\n  return (',start);
const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(mode='held',override=true){let release;const held=new Promise(resolve=>{release=resolve;});
const state={requests:[],busy:false,closed:0,resets:0,events:0,toasts:[],error:'',uncertain:false,confirms:0};
const env={resourcesReady:true,shop:{id:'shop'},barberId:'b',query:'Client',serviceIds:['s'],services:[{id:'s',name:'Cut',price:30,duration_minutes:30}],barbers:[{id:'b',name:'Barber'}],accessToken:'token',phone:' 123 ',email:' test@example.invalid ',date:'2026-10-01',time:'9:00 AM',
submitState:{current:'idle'},submitContext:{current:0},resourceScope:'shop:scope',activeResourceScope:{current:'shop:scope'},UNCERTAIN_BOOKING_MESSAGE:'This booking may have been saved. Refresh and check this shop’s calendar before trying again.',
setSubmitError:v=>{state.error=v;},setSubmitUncertain:v=>{state.uncertain=v;},
fetch:async(url,options)=>{state.requests.push(JSON.parse(options.body));if(mode==='held')await held;if(mode==='throw')throw Error('offline');const n=state.requests.length;
const body=mode==='malformed'?{}:mode==='null'?null:mode==='safe'?{error:'One or more selected services are unavailable.'}:mode==='unknown4xx'?{error:'Unrecognized error'}:mode==='server'?{error:'Server error'}:mode==='override'&&n===1?{blocked:true,error:'Time off'}:{id:'appt',status:'confirmed',barber_id:'b'};
const status=mode==='safe'||mode==='unknown4xx'?400:mode==='server'?500:mode==='override'&&n===1?409:200;
return{ok:status===200,status,json:async()=>{if(mode==='json')throw Error('bad JSON');return body;}};},
confirm:async()=>{state.confirms++;await held;return override;},setSaving:v=>{state.busy=v;},showToast:v=>{state.toasts.push(v);},close:()=>{state.closed++;},reset:()=>{state.resets++;},window:{dispatchEvent:()=>{state.events++;}},Event:class{}};
return{state,env,release,submit:new Function(...Object.keys(env),`${code};return submit;`)(...Object.values(env))};}
(async()=>{
 const p=setup(),first=p.submit(),second=p.submit();assert.equal(p.state.requests.length,1,'one pending booking request');p.release();await Promise.all([first,second]);await p.submit();assert.equal(p.state.requests.length,1);assert.equal(p.state.closed,1);assert.equal(p.state.resets,1);assert.equal(p.state.events,1);assert.equal(p.state.busy,false);
 assert.deepEqual(p.state.requests[0],{shop_id:'shop',barber_id:'b',service_id:'s',service_ids:['s'],client_name:'Client',client_phone:'123',client_email:'test@example.invalid',date:'2026-10-01',time_slot:'9:00 AM',total_amount:30,duration_minutes:30,pay_in_person:true,confirmed:true});
 for(const mode of ['throw','malformed','null','json','server','unknown4xx']){const p=setup(mode);await p.submit();await p.submit();assert.equal(p.state.requests.length,1,'uncertain responses must not permit blind retry');assert.equal(p.state.uncertain,true);assert.match(p.state.error,/calendar/i);assert.equal(p.state.busy,false);assert.equal(p.state.closed,0);assert.equal(p.state.resets,0);assert.equal(p.state.events,0);}
 const safe=setup('safe');await safe.submit();assert.equal(safe.env.submitState.current,'idle');assert.equal(safe.state.uncertain,false);assert.equal(safe.state.closed,0);assert(safe.state.error);await safe.submit();assert.equal(safe.state.requests.length,2);
 for(const allowed of [true,false]){const p=setup('override',allowed),pending=p.submit();await flush();assert.equal(p.state.confirms,1);await p.submit();assert.equal(p.state.requests.length,1,'override dialog must retain pending guard');p.release();await pending;assert.equal(p.state.requests.length,allowed?2:1);assert.equal(p.state.closed,allowed?1:0);if(allowed)assert.equal(p.state.requests[1].override_block,true);else assert.equal(p.env.submitState.current,'idle');assert.equal(p.state.busy,false);}
 for(const phase of ['held','override'])for(const changed of ['scope','unmount']){const p=setup(phase),pending=p.submit();await flush();if(changed==='scope')p.env.activeResourceScope.current='other';else p.env.submitContext.current++;p.release();await pending;assert.equal(p.state.requests.length,1);assert.equal(p.state.closed,0);assert.equal(p.state.resets,0);assert.equal(p.state.events,0);}
 console.log('PASS quick-add submit: pending/override reentry guard, canonical ID, uncertain lock, known rejection retry, retained draft, payload and stale callback isolation');
})().catch(error=>{console.error(error);process.exitCode=1;});

// Exercise dismissal/reopen lifecycle independently from React scheduling.
const ast=ts.createSourceFile('modal.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),handlers={};
function visit(node){if(ts.isVariableDeclaration(node)&&['close','openIt'].includes(node.name.getText(ast)))handlers[node.name.getText(ast)]=node.initializer.getText(ast);ts.forEachChild(node,visit);}visit(ast);
const compile=expression=>ts.transpileModule('const action='+expression,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';return action;';
const life={hidden:0,closed:0,resets:0,opened:0,timer:null};
const lifecycle={submitState:{current:'pending'},submitContext:{current:0},useCallback:fn=>fn,setShown:()=>life.hidden++,setOpen:v=>v?life.opened++:life.closed++,window:{setTimeout:fn=>life.timer=fn}};
const close=new Function(...Object.keys(lifecycle),compile(handlers.close))(...Object.values(lifecycle));
close();assert.equal(life.hidden,0,'pending dismissal must be blocked synchronously');
lifecycle.submitState.current='uncertain';close();assert.equal(life.hidden,1);lifecycle.submitContext.current++;life.timer();assert.equal(life.closed,0,'old close timer cannot close a newer opening');
const opening={...lifecycle,open:false,saving:false,shop:{id:'shop'},lockBarber:null,setResourcesLoading:()=>{},setResourcesError:()=>{},setLoadedResourceScope:()=>{},setSubmitError:()=>{},setSubmitUncertain:()=>{},reset:()=>life.resets++,requestCalendarAddContext:()=>({})};
const openIt=new Function(...Object.keys(opening),compile(handlers.openIt))(...Object.values(opening));
openIt({});assert.equal(life.opened,1);assert.equal(life.resets,0,'reopening uncertain result retains draft and lock');assert.equal(lifecycle.submitState.current,'uncertain');
lifecycle.submitState.current='complete';openIt({});assert.equal(life.resets,1);assert.equal(lifecycle.submitState.current,'idle','fresh opening after confirmed success permits a new booking');
const scopeStart=source.indexOf('  // A location/account change'),scopeEnd=source.indexOf('  // Animated close:',scopeStart);
const scopeCode=ts.transpileModule(source.slice(scopeStart,scopeEnd),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
let scopeUncertain=false;const scope={...opening,resourceScope:'new',previousResourceScope:{current:'old'},useEffect:fn=>fn(),setSaving:()=>{},setSubmitUncertain:v=>scopeUncertain=v,UNCERTAIN_BOOKING_MESSAGE:'Check original calendar'};
lifecycle.submitState.current='pending';new Function(...Object.keys(scope),scopeCode)(...Object.values(scope));assert.equal(lifecycle.submitState.current,'uncertain');assert(scopeUncertain);assert.equal(life.resets,2,'scope switch clears foreign draft while preserving uncertain lock');

const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/app/onboarding/page.tsx'), 'utf8');
const start = source.indexOf('  const handleNext ='), end = source.indexOf('  // Shared "advance this step"', start);
const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function setup(step, mode = 'held', overrides = {}) {
  let release; const held = new Promise(resolve => { release = resolve; });
  const state = { writes: [], advances: 0, error: '', saving: false };
  const write = async (table,payload) => { state.writes.push({table,payload}); if (mode === 'held') await held; if (mode === 'throw') throw Error('offline'); return {error: null}; };
  const env = { step, resumeReady: true, stepSaveInFlight: {current:false}, resumeUserId:'owner', activeResumeUser:{current:'owner'}, createdShopId: step === 0 ? '' : 'shop', createdBarberIds: ['barber'],
    shop:{ name:'Shop',address:'Address',city:'City',province:'NB',postal_code:'',phone:'',description:'' }, accessToken:'token', logoFile:null,
    services:[{name:'Haircut',price:'30',duration:'30',category:'Hair'}], hours:[{open:true,start:'9 AM',end:'5 PM'}], toDbTime: s => s === '9 AM' ? '09:00:00' : '17:00:00',
    setError:v=>{state.error=v;}, setSaving:v=>{state.saving=v;}, setStep:()=>{state.advances++;}, setCreatedShopId:()=>{},setCreatedShopSlug:()=>{},setCreatedShopStatus:()=>{},
    sessionStorage:{getItem:()=> '{}'},
    fetch:async(url,options)=>{await write(url,JSON.parse(options.body));return {ok:true,json:async()=>({shop:{id:'shop',slug:'shop',status:'pending'}})};},
    supabase:{from:table=>({ insert:payload=>write(table,payload),delete:()=>({eq:(key,value)=>write(table,{key,value})}),
      select:()=>({eq:async()=>({data:mode==='read-null'?null:[],error:mode==='read-error'?{message:'private'}:null})}) })}, ...overrides };
  return {state,env,release,save:new Function(...Object.keys(env),`${code}; return handleNext;`)(...Object.values(env))};
}
(async()=>{
  for(const step of [0,2,3]){
    const p=setup(step),first=p.save(),second=p.save(); assert.equal(p.state.writes.length,1,'step submissions must not overlap'); p.release();await Promise.all([first,second]);
    assert.equal(p.state.advances,1);assert.equal(p.state.saving,false);assert.equal(p.env.stepSaveInFlight.current,false);
    if(step===3)assert.deepEqual(p.state.writes[0].payload,[{shop_id:'shop',name:'Haircut',price:30,duration_minutes:30,category:'Hair',is_active:true}]);
    const blocked=setup(step,'success',{resumeReady:false});await blocked.save();assert.equal(blocked.state.writes.length,0);assert.equal(blocked.state.advances,0);
    const fail=setup(step,'throw');await fail.save();assert.equal(fail.state.saving,false);assert.equal(fail.env.stepSaveInFlight.current,false);assert.equal(fail.state.advances,0);
  }
  for(const mode of ['read-error','read-null']){const p=setup(2,mode,{createdBarberIds:[]});await p.save();assert.equal(p.state.writes.length,0);assert.equal(p.state.advances,0);assert.match(p.state.error,/Couldn't load/);assert.doesNotMatch(p.state.error,/private/);}
  const empty=setup(2,'success',{createdBarberIds:[]});await empty.save();assert.equal(empty.state.advances,1);assert.equal(empty.state.writes.length,0);
  console.log('PASS onboarding step saves: synchronous duplicate guard, loading cleanup, unchanged service payloads, failed team lookups block advancement and confirmed empty team remains allowed');
})().catch(error=>{console.error(error);process.exitCode=1;});

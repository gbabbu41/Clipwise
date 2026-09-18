const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const source=fs.readFileSync(path.resolve(__dirname,'../../src/components/dashboard/setup-sheet.tsx'),'utf8');
const start=source.indexOf('  const saveHours ='),end=source.indexOf('\n  return (',start);
const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(mode='read'){
  let release;const held=new Promise(resolve=>{release=resolve;});
  const state={reads:0,invites:0,writes:[],closed:0,refreshes:0,busy:false,error:''};
  const env={shop:{id:'shop'},user:{email:'owner@example.invalid'},profile:{name:'Owner'},accessToken:'token',hours:[{open:true,start:'09:00',end:'17:00'}],
    scopeId:'shop:hours',activeScope:{current:'shop:hours'},saveContext:{current:0},saveInFlight:{current:false},
    setSaving:value=>{state.busy=value;},setError:value=>{state.error=value;},refreshShop:async()=>{state.refreshes++;},onClose:()=>{state.closed++;},
    fetch:async()=>{state.invites++;if(mode==='invite')await held;return{ok:true,json:async()=>({barber:{id:'owner-chair'}})};},
    supabase:{from:table=>({select:()=>({eq:async()=>{state.reads++;if(mode==='read')await held;return{data:mode==='invite'?[]:[{id:'barber'}],error:null};}}),
      delete:()=>({eq:async()=>{state.writes.push('delete');if(mode==='delete')await held;return{error:null};}}),
      insert:async()=>{state.writes.push('insert');if(mode==='insert')await held;return{error:null};}})}};
  return{state,env,release,save:new Function(...Object.keys(env),`${code};return saveHours;`)(...Object.values(env))};
}
(async()=>{
  const p=setup(),first=p.save(),second=p.save();assert.equal(p.state.reads,1,'overlapping hours saves must not start two workflows');p.release();await Promise.all([first,second]);assert.deepEqual(p.state.writes,['delete','insert']);assert.equal(p.state.closed,1);assert.equal(p.env.saveInFlight.current,false);assert.equal(p.state.busy,false);
  for(const mode of ['read','invite','delete','insert'])for(const change of ['shop','unmount']){
    const p=setup(mode),pending=p.save();await flush();if(change==='shop')p.env.activeScope.current='other:hours';else p.env.saveContext.current++;const writesBefore=p.state.writes.length;p.release();await pending;assert.equal(p.state.writes.length,writesBefore,'stale requests must stop subsequent writes');assert.equal(p.state.closed,0);assert.equal(p.state.refreshes,0);assert.equal(p.state.error,'');
  }
  console.log('PASS setup hours isolation: one pending workflow, one success, no follow-on writes or close/refresh after shop change/unmount at each await');
})().catch(error=>{console.error(error);process.exitCode=1;});

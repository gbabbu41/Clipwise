const assert = require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const source=fs.readFileSync(path.resolve(__dirname,'../../src/components/dashboard/setup-sheet.tsx'),'utf8');
const start=source.indexOf('  const saveLocation ='),end=source.indexOf('  const saveHours =',start);
const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function setup(mode='ok'){
  let release;const held=new Promise(resolve=>{release=resolve;});
  const state={writes:[],closed:0,refreshes:0,busy:false,error:'',filters:[]};
  const env={shop:{id:'shop'},scopeId:'shop:location',activeScope:{current:'shop:location'},saveContext:{current:0},saveInFlight:{current:false},
    loc:{address:'  Street  ',city:' City ',province:' NB ',postal_code:' A1A1A1 ',phone:' '},setSaving:v=>{state.busy=v;},setError:v=>{state.error=v;},refreshShop:async()=>{state.refreshes++;},onClose:()=>{state.closed++;},
    supabase:{from:table=>({update:payload=>{state.writes.push({table,payload});const reply=async()=>{if(mode==='held')await held;if(mode==='throw')throw Error('offline');return{data:mode==='zero'?null:{id:mode==='wrong-id'?'other':'shop'},error:mode==='error'?{message:'private'}:null};};const q={eq:(key,id)=>{state.filters.push([key,id]);return q;},select:()=>q,maybeSingle:reply,then:(resolve,reject)=>reply().then(resolve,reject)};return q;}})}};
  return{state,env,release,save:new Function(...Object.keys(env),`${code};return saveLocation;`)(...Object.values(env))};
}
(async()=>{
  for(const mode of ['zero','wrong-id','error','throw']){const p=setup(mode);await p.save();assert.equal(p.state.closed,0,'unconfirmed location must retain its form');assert.equal(p.state.refreshes,0);assert.equal(p.state.busy,false);assert(p.state.error);}
  const held=setup('held'),first=held.save(),second=held.save();assert.equal(held.state.writes.length,1);held.release();await Promise.all([first,second]);assert.equal(held.state.closed,1);assert.equal(held.state.refreshes,1);
  for(const changed of ['shop','unmount']){const p=setup('held'),pending=p.save();if(changed==='shop')p.env.activeScope.current='other:location';else p.env.saveContext.current++;p.release();await pending;assert.equal(p.state.closed,0);assert.equal(p.state.refreshes,0);}
  const blank=setup();blank.env.loc.address=' ';await blank.save();assert.equal(blank.state.writes.length,0);assert.equal(blank.state.closed,0);
  const valid=setup();await valid.save();assert.deepEqual(valid.state.writes,[{table:'shops',payload:{address:'Street',city:'City',province:'NB',postal_code:'A1A1A1',phone:null}}]);assert.deepEqual(valid.state.filters,[['id','shop']]);assert.equal(valid.state.closed,1);
  console.log('PASS setup location: confirmed scoped save, retained zero-row/error/offline drafts, duplicate guard and stale shop/unmount suppression');
})().catch(error=>{console.error(error);process.exitCode=1;});

const closeStart=source.indexOf('  const closeSheet ='),closeEnd=source.indexOf('  const saveLocation =',closeStart);
assert(closeStart>=0,'guarded dismiss handler exists');
const closeCode=ts.transpileModule(source.slice(closeStart,closeEnd),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
for(const [saving,pending,expected] of [[false,true,0],[true,false,0],[false,false,1]]){
  let closed=0;const env={saving,saveInFlight:{current:pending},onClose:()=>{closed++;}};
  new Function(...Object.keys(env),`${closeCode};return closeSheet;`)(...Object.values(env))();assert.equal(closed,expected,'pending save cannot be dismissed');
}
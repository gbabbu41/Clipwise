const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const source=fs.readFileSync(path.resolve(__dirname,'../../src/components/dashboard/setup-sheet.tsx'),'utf8');
const start=source.indexOf('  const saveHours ='),end=source.indexOf('\n  return (',start);
const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function setup(mode='success',open=true){
  const state={writes:[],invites:[],closed:0,refreshes:0,busy:false,error:''};
  const env={scopeId:'shop:hours',activeScope:{current:'shop:hours'},saveContext:{current:0},saveInFlight:{current:false},shop:{id:'shop'},user:{email:'owner@example.invalid'},profile:{name:'Owner'},accessToken:'token',hours:[{open,start:'09:00',end:'17:00'}],
    setSaving:value=>{state.busy=value;},setError:value=>{state.error=value;},refreshShop:async()=>{state.refreshes++;},onClose:()=>{state.closed++;},
    fetch:async(url,options)=>{state.invites.push(JSON.parse(options.body));return{ok:true,json:async()=>({barber:mode==='bad-id'?{}:{id:'owner-chair'}})};},
    supabase:{from:table=>({select:()=>({eq:async()=>{if(mode==='read-throw')throw Error('offline');return{data:mode==='read-error'||mode==='read-null'?null:mode==='empty'||mode==='bad-id'?[]:[{id:'barber'}],error:mode==='read-error'?{message:'private'}:null};}}),
      delete:()=>({eq:async(key,id)=>{state.writes.push({op:'delete',table,key,id});if(mode==='delete-throw')throw Error('offline');return{error:mode==='delete-error'?{message:'private'}:null};}}),
      insert:async(rows)=>{state.writes.push({op:'insert',table,rows});return{error:null};}})}};
  return {state,save:new Function(...Object.keys(env),`${code};return saveHours;`)(...Object.values(env))};
}
(async()=>{
  for(const mode of ['read-error','read-null','read-throw']){const p=setup(mode);await p.save();assert.equal(p.state.invites.length,0,'failed team reads must never create a chair');assert.equal(p.state.writes.length,0);assert.equal(p.state.closed,0);assert(p.state.error);assert.equal(p.state.busy,false);}
  for(const open of [true,false])for(const mode of ['delete-error','delete-throw']){const p=setup(mode,open);await p.save();assert.equal(p.state.writes.length,1,'failed deletion must stop replacement insertion');assert.equal(p.state.closed,0);assert.equal(p.state.refreshes,0);assert(p.state.error);assert.equal(p.state.busy,false);}
  const bad=setup('bad-id');await bad.save();assert.equal(bad.state.writes.length,0,'malformed chair confirmation must not write undefined barber ids');assert.equal(bad.state.closed,0);
  const valid=setup('empty');await valid.save();assert.deepEqual(valid.state.invites,[{name:'Owner',email:'owner@example.invalid',commission_percent:0,shop_id:'shop'}]);assert.equal(valid.state.closed,1);assert.equal(valid.state.refreshes,1);
  const existing=setup();await existing.save();assert.equal(existing.state.invites.length,0);assert.deepEqual(existing.state.writes[1].rows,[{day_of_week:0,start_time:'09:00:00',end_time:'17:00:00',is_available:true,barber_id:'barber'}]);assert.equal(existing.state.closed,1);
  const closed=setup('success',false);await closed.save();assert.equal(closed.state.writes.length,1);assert.equal(closed.state.closed,1);
  console.log('PASS setup hours: failed reads cannot create chairs, malformed confirmation blocks writes, delete failures retain form, owner commission and successful slot payloads unchanged');
})().catch(error=>{console.error(error);process.exitCode=1;});

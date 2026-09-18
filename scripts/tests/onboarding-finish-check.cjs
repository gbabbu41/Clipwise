const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/app/onboarding/page.tsx'),'utf8');
const tree = ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let expression;
function visit(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree)==='Button') {
    const attrs=node.openingElement.attributes.properties;
    if(attrs.some(attr=>attr.name?.getText(tree)==='loading' && attr.initializer?.expression?.getText(tree)==='finishing')) expression=attrs.find(attr=>attr.name?.getText(tree)==='onClick').initializer.expression.getText(tree);
  }
  ts.forEachChild(node,visit);
}
visit(tree); assert(expression,'finish handler found');
if(/^\w+$/.test(expression)) {const name=expression;function find(node){if(ts.isVariableDeclaration(node)&&node.name.getText(tree)===name)expression=node.initializer.getText(tree);ts.forEachChild(node,find);}find(tree);}
const code=ts.transpileModule(`const finish=${expression};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function setup(value='{}',mode='normal') {
  let release;const held=new Promise(resolve=>{release=resolve;});
  const state={refreshes:0,removals:0,reads:0,routes:[],busy:false};
  const env={resumeReady:true,finishInFlight:{current:false},setFinishing:value=>{state.busy=value;},
    sessionStorage:{getItem:()=>{state.reads++;if(mode==='get-throw')throw Error('storage unavailable');return value;},removeItem:()=>{state.removals++;if(mode==='remove-throw')throw Error('storage unavailable');value=null;}},
    refreshShop:async()=>{state.refreshes++;if(mode==='held')await held;if(mode==='refresh-throw')throw Error('offline');},router:{push:path=>{state.routes.push(path);}}};
  return {state,env,release,finish:new Function(...Object.keys(env),`${code};return finish;`)(...Object.values(env))};
}
(async()=>{
  const scenarios=process.argv.includes('--storage-only')?[]:[['pro',true],['premium',false]];
  for(const [plan,trial] of scenarios){const p=setup(JSON.stringify({plan,trial,autoApprove:!trial}),'held');const first=p.finish(),second=p.finish();p.release();await Promise.all([first,second]);assert.deepEqual(p.state.routes,['/onboarding/stripe-connect'],'repeat action must not override Stripe setup with dashboard');assert.equal(p.state.refreshes,1,'only one refresh before navigation');assert.equal(p.state.reads,1,'read the chosen plan once');await p.finish();assert.equal(p.state.routes.length,1);}
  for(const [value,mode,destination] of [['null','normal','/dashboard'],['{','normal','/dashboard'],['{}','get-throw','/dashboard'],['{}','remove-throw','/dashboard'],['{"plan":"pro","trial":true}','remove-throw','/onboarding/stripe-connect'],['{}','refresh-throw','/dashboard'],['{"plan":"starter","trial":true}','normal','/dashboard']]){
    const p=setup(value,mode);await p.finish();assert.equal(p.state.refreshes,1);assert.deepEqual(p.state.routes,[destination]);
  }
  console.log('PASS onboarding finish: single plan snapshot/refresh/navigation, existing destinations, null/corrupt/unavailable storage fallback and refresh failure fallback');
})().catch(error=>{console.error(error);process.exitCode=1;});

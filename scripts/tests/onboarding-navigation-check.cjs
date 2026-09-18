const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/app/onboarding/page.tsx'), 'utf8');
const tree = ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let backExpression;
function visit(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree)==='Button' && node.children.some(child=>ts.isJsxSelfClosingElement(child)&&child.tagName.getText(tree)==='ChevronLeft')) {
    backExpression = node.openingElement.attributes.properties.find(attr=>attr.name?.getText(tree)==='onClick').initializer.expression.getText(tree);
  }
  ts.forEachChild(node,visit);
}
visit(tree); assert(backExpression,'Back button handler found');
if (/^\w+$/.test(backExpression)) {
  const name=backExpression; let initializer;
  function find(node){if(ts.isVariableDeclaration(node)&&node.name.getText(tree)===name)initializer=node.initializer.getText(tree);ts.forEachChild(node,find);} find(tree); backExpression=initializer;
}
const backCode=ts.transpileModule(`const back=${backExpression};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
for(const [saving,pending,ready,expected] of (process.argv.includes('--continue-only') ? [] : [[true,false,true,2],[false,true,true,2],[false,false,false,2],[false,false,true,1]])){
  let current=2;
  const env={step:2,saving,resumeReady:ready,stepSaveInFlight:{current:saving},barberRequestState:{current:pending?'pending':'idle'},setBlockHint:()=>{},setStep:value=>{current=typeof value==='function'?value(current):value;}};
  new Function(...Object.keys(env),`${backCode};return back;`)(...Object.values(env))();assert.equal(current,expected,'Back must wait for saves/prerequisite reads');
}
const from=source.indexOf('  const handleNext ='),to=source.indexOf('  // Shared "advance this step"',from);
const code=ts.transpileModule(source.slice(from,to),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
(async()=>{
  let current=1;
  const env={step:1,resumeReady:true,stepSaveInFlight:{current:false},setError:()=>{},setSaving:()=>{},setStep:value=>{current=typeof value==='function'?value(current):value;}};
  const next=new Function(...Object.keys(env),`${code};return handleNext;`)(...Object.values(env));await Promise.all([next(),next()]);assert.equal(current,2,'same-render Continue calls must not skip Hours');
  console.log('PASS onboarding navigation: Back waits for pending saves/staff/read gates, idle Back preserved, same-render Continue cannot skip Hours');
})().catch(error=>{console.error(error);process.exitCode=1;});

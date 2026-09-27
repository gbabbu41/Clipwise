const fs=require('fs'),assert=require('node:assert/strict'),ts=require('typescript');
const source=fs.readFileSync('src/app/api/stripe/booking-checkout/route.ts','utf8');
const ast=ts.createSourceFile('route.ts',source,ts.ScriptTarget.Latest,true);let expression;function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='bookingPath')expression=n.initializer.getText(ast);ts.forEachChild(n,visit)}visit(ast);assert(expression);
const pathFor=new Function('booking','return '+expression);
for(const presentation of [undefined,'luxury','https://attacker.invalid','//attacker.invalid','other']){const result=pathFor({presentation,shop_slug:'a-shop'});assert.equal(result,(presentation==='luxury'?'/shop-preview/':'/book/')+'a-shop');}
assert.equal(pathFor({presentation:'luxury',shop_slug:'shop?redirect=https://bad.test'}),'/shop-preview/shop%3Fredirect%3Dhttps%3A%2F%2Fbad.test');
assert.equal((source.match(/success_url: `\$\{BASE_URL\}\$\{bookingPath\}/g)||[]).length,2);assert.equal((source.match(/cancel_url: `\$\{BASE_URL\}\$\{bookingPath\}/g)||[]).length,2);
console.log('PASS allowlisted preview/default checkout returns for charge and save-card paths; unknown variant falls back to canonical and slug cannot inject query');

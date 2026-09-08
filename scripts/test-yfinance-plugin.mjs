import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import ts from "typescript";
const source=await readFile("scripts/yfinance-plugin.ts","utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
await writeFile("work/metal-references/plugin-test.mjs",compiled);
const { yfinancePlugin }=await import("../work/metal-references/plugin-test.mjs");
let middleware;
yfinancePlugin("test-only-password").configureServer({middlewares:{use(path,fn){assert.equal(path,"/api/metal-quotes");middleware=fn;}}});
const token=createHmac("sha256","test-only-password").update("winding-intelligence-access-v1").digest("base64url");
function invoke(headers={},method="GET"){return new Promise(resolve=>{let status=200;const response={setHeader(){},set statusCode(v){status=v;},end(body){resolve({status,body:JSON.parse(body)});}};middleware({method,headers:{host:"localhost:3000",...headers}},response);});}
assert.equal((await invoke()).status,401);
assert.equal((await invoke({cookie:"winding_intelligence_access=é".repeat(20)})).status,401);
assert.equal((await invoke({origin:"https://other.example"})).status,403);
assert.equal((await invoke({origin:"invalid"})).status,403);
assert.equal((await invoke({},"POST")).status,405);
const result=await invoke({cookie:"winding_intelligence_access="+token});
assert.equal(result.status,200);
assert.equal(result.body.quotes.length,3);
assert.deepEqual(result.body.quotes.map(q=>q.symbol),["HRC=F","ALI=F","HG=F"]);
console.log("Adapter access tests passed; authenticated Python response:", result.body.quotes.map(q=>q.symbol+": "+q.status).join(", "));


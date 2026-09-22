import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { MvpTask } from "../lib/mvp-contract";

const freePort=()=>new Promise<number>(resolve=>{const server=http.createServer();server.listen(0,"127.0.0.1",()=>{const port=(server.address() as {port:number}).port;server.close(()=>resolve(port));});});
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return{promise,resolve};};
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

async function fixture(mode:"pause"|"balance"|"invalid"|"budget") {
  const root=await mkdtemp(path.join(os.tmpdir(),"store-queue-"));const apiPort=await freePort();
  const jpeg=await sharp({create:{width:64,height:64,channels:3,background:"#678a70"}}).jpeg().toBuffer();
  const pricingFile=path.join(root,"pricing.json"); await writeFile(pricingFile,JSON.stringify({models:{"vision-mock":{analysis:1,planning:1,quality_check:1},"image-mock":{generation:1}}}));
  const entered=deferred(),release=deferred();let generations=0,checks=0,requests=0;
  const mock=http.createServer(async(req,res)=>{
    requests++;let raw="";for await(const chunk of req)raw+=chunk;const payload=JSON.parse(raw);
    res.setHeader("content-type","application/json");
    if(req.url==="/images") {generations++;if(mode==="pause"&&generations===1){entered.resolve();await release.promise;}res.end(mode==="invalid"?"bad JSON":JSON.stringify({data:[{b64_json:jpeg.toString("base64")}]}));return;}
    const text=payload.input[0].content[0].text;let output;
    if(text.includes("识别下列商品")) {if(mode==="balance"){entered.resolve();await release.promise;res.statusCode=403;res.end(JSON.stringify({error:{message:"insufficient balance"}}));return;}output=[1,2,3].map(i=>({productId:"p"+i,summary:"测试商品",identitySensitive:false,protectedFeatures:["结构"]}));}
    else if(text.includes("微购店铺首页规划器")) output=["atmosphere","quick","product"].map((strategy,i)=>({id:strategy,strategy,name:strategy,rationale:"测试",shopSign:{id:"sign",type:"shopSign",variant:"default",productIds:["p1"],assetIds:[]},modules:[{id:"carousel",type:"carousel",variant:["small","medium","large"][i],productIds:["p1"],assetIds:[]},{id:"showcase",type:"showcase",variant:"single",productIds:["p1"],assetIds:[]},{id:"text",type:"text",variant:"multiLine",title:"测试文本",productIds:[],assetIds:[]}]}));
    else {checks++;output={verdict:mode==="pause"&&checks===1?"reject":"pass",reason:"模拟质检"};}
    res.end(JSON.stringify({output:[{content:[{type:"output_text",text:JSON.stringify(output)}]}]}));
  });
  await new Promise<void>(resolve=>mock.listen(0,"127.0.0.1",resolve));const mockPort=(mock.address() as {port:number}).port;
  const child=spawn(process.execPath,["--import","tsx","server/index.ts"],{cwd:process.cwd(),env:{...process.env,MVP_DATA_DIR:root,MVP_PRICING_FILE:mode==="budget"?pricingFile:"",MVP_SERVICE_PORT:String(apiPort),ARK_API_KEY:"mock-only",ARK_VISION_MODEL:"vision-mock",ARK_IMAGE_MODEL:"image-mock",ARK_RESPONSES_ENDPOINT:`http://127.0.0.1:${mockPort}/responses`,ARK_IMAGE_ENDPOINT:`http://127.0.0.1:${mockPort}/images`},stdio:"pipe"});let logs="";child.stdout?.on("data",b=>logs+=b);child.stderr?.on("data",b=>logs+=b);
  const url=`http://127.0.0.1:${apiPort}`;
  async function waitReady(){for(let i=0;i<100;i++){try{if((await fetch(url+"/health")).ok)return;}catch{}await sleep(50);}throw Error(logs);}
  await waitReady();
  const read=async(id:string)=>await(await fetch(url+"/tasks/"+id)).json() as MvpTask;
  const act=async(task:MvpTask,action:string)=>{const response=await fetch(url+"/tasks/"+task.id+"/"+action,{method:"POST",headers:{"if-match":String(task.revision),"content-type":"application/json"},body:"{}"});assert.ok(response.ok,await response.clone().text());return await response.json() as MvpTask;};
  async function create(extra:Record<string,unknown>={},key?:string){const form=new FormData();form.append("metadata",JSON.stringify({...extra,brief:"队列可靠性模拟验证",visualDescription:"自然柔光",products:[1,2,3].map(i=>({id:"p"+i,name:"商品"+i,isHero:i===1,images:["p"+i]}))}));for(let i=1;i<=3;i++)form.append("p"+i,new Blob([jpeg],{type:"image/jpeg"}),i+".jpg");const response=await fetch(url+"/tasks",{method:"POST",headers:key?{"idempotency-key":key}:undefined,body:form});assert.ok([200,201].includes(response.status));return await response.json() as MvpTask;}
  async function until(id:string,predicate:(task:MvpTask)=>boolean){for(let i=0;i<400;i++){const task=await read(id);if(predicate(task))return task;await sleep(25);}throw Error("State timeout: "+JSON.stringify(await read(id))+logs);}
  return {entered,release,create,read,act,until,counts:()=>({generations,checks,requests}),close:async()=>{release.resolve();child.kill();await new Promise<void>(resolve=>child.exitCode!==null?resolve():child.once("exit",()=>resolve()));await new Promise<void>(resolve=>mock.close(()=>resolve()));await rm(root,{recursive:true,force:true});}};
}

test("生成中暂停：先保存图片，恢复先质检，自动拒绝仅再生成一次",{timeout:30000},async()=>{
  const f=await fixture("pause");try{const created=await f.create();await f.act(created,"run");await f.entered.promise;await f.act(await f.read(created.id),"pause");f.release.resolve();const paused=await f.until(created.id,t=>t.status==="paused");assert.equal(f.counts().generations,1);assert.equal(f.counts().checks,0);assert.ok(paused.assets.some(a=>a.currentVersion===1&&a.status==="checking"));await f.act(paused,"resume");const done=await f.until(created.id,t=>t.status==="completed");const first=done.assets.find(a=>a.moduleId==="atmosphere-sign")!;assert.equal(first.automaticAttempts,2);assert.equal(first.initialVerdict,"reject");assert.equal(first.route,"preserve");assert.equal(done.modelCalls.filter(c=>c.assetId===first.id&&c.requestType==="generation").length,2);assert.equal(new Set(done.modelCalls.map(c=>c.id)).size,done.modelCalls.length);}finally{await f.close();}
});
test("分析阶段余额不足：暂停当前和等待任务，不继续派发",{timeout:30000},async()=>{
  const f=await fixture("balance");try{const first=await f.create(),second=await f.create();await f.act(first,"run");await f.entered.promise;await f.act(second,"run");f.release.resolve();const paused=await f.until(first.id,t=>t.status==="paused");await f.until(second.id,t=>t.status==="paused");assert.equal(f.counts().requests,1);assert.equal(paused.modelCalls[0].status,"failed");assert.match(paused.error??"",/balance/);}finally{await f.close();}
});
test("生图异常响应不自动重试；恢复任务不重置生成次数",{timeout:30000},async()=>{
  const f=await fixture("invalid");try{const first=await f.create();await f.act(first,"run");const failed=await f.until(first.id,t=>t.status==="partial_failed");const calls=f.counts().generations;assert.ok(calls>0);assert.ok(failed.assets.filter(a=>a.route==="direct").every(a=>a.automaticAttempts===1));assert.equal(failed.modelCalls.filter(c=>c.requestType==="generation"&&c.status==="failed").length,calls);await f.act(failed,"resume");await f.until(first.id,t=>t.status==="partial_failed");assert.equal(f.counts().generations,calls);}finally{await f.close();}
});

test("预算不足在任何模型请求发出前暂停",{timeout:30000},async()=>{const f=await fixture("budget");try{const task=await f.create({budgetCny:.5});await f.act(task,"run");const paused=await f.until(task.id,t=>t.status==="paused");assert.equal(f.counts().requests,0);assert.equal(paused.modelCalls.length,0);assert.match(paused.currentStep??"",/预算/);}finally{await f.close();}});
test("重复幂等创建返回同一任务且不触发模型",{timeout:30000},async()=>{const f=await fixture("budget");try{const first=await f.create({},"fixed-input-key");const second=await f.create({},"fixed-input-key");assert.equal(first.id,second.id);assert.equal(f.counts().requests,0);}finally{await f.close();}});

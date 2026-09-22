import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,mkdir,writeFile,readFile,rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { spawn } from "node:child_process";
import sharp from "sharp";

test("批次断点复用已有任务，输入变化拒绝继续，未设预算不执行技术批次",{timeout:30000},async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"batch-recovery-"));const pictures=path.join(root,"products");await mkdir(pictures);
  const image=await sharp({create:{width:32,height:32,channels:3,background:"#386b4c"}}).jpeg().toBuffer();
  for(const folder of ["a","b","c"]){await mkdir(path.join(pictures,folder));await writeFile(path.join(pictures,folder,"1.jpg"),image);}
  const manifest=path.join(root,"manifest.json"),state=path.join(root,"run.json");await writeFile(manifest,JSON.stringify({productRoot:pictures,tasks:[{category:"测试",brief:"批次恢复模拟测试",visualDescription:"自然柔光",products:["a","b","c"].map(folder=>({folder,name:folder}))}]}));
  let creates=0,requests=0,pauseCalls=0,pauseFailure=false;const task={id:"only-task",status:"completed",revision:1,modelCalls:[]};
  const mock=http.createServer(async(req,res)=>{requests++;for await(const _ of req){}res.setHeader("content-type","application/json");if(req.url==="/tasks/only-task/pause"){pauseCalls++;if(pauseFailure||pauseCalls===1){res.statusCode=pauseFailure?503:409;res.end(JSON.stringify({error:"pause failed"}));}else{task.status="paused";res.end(JSON.stringify(task));}}else if(req.url==="/health")res.end(JSON.stringify({models:{analysis:true,generation:true,qualityCheck:true}}));else if(req.method==="POST"&&req.url==="/tasks"){creates++;assert.ok(req.headers["idempotency-key"]);res.statusCode=201;res.end(JSON.stringify(task));}else if(req.url?.startsWith("/metrics"))res.end("{}");else res.end(JSON.stringify(task));});
  await new Promise<void>(resolve=>mock.listen(0,"127.0.0.1",resolve));const service=`http://127.0.0.1:${(mock.address() as {port:number}).port}`;
  const run=(extra:string[])=>new Promise<{code:number|null;output:string}>(resolve=>{const child=spawn(process.execPath,["--import","tsx","scripts/run-validation-batch.mjs",manifest,"--limit=1","--confirm-costs","--state="+state,...extra],{env:{...process.env,MVP_BATCH_SERVICE_URL:service},stdio:"pipe"});let output="";child.stdout.on("data",b=>output+=b);child.stderr.on("data",b=>output+=b);child.on("exit",code=>resolve({code,output}));});
  try{
    const blocked=await run([]);assert.notEqual(blocked.code,0);assert.match(blocked.output,/预算/);assert.equal(requests,0);
    const first=await run(["--baseline"]);assert.equal(first.code,0,first.output);assert.equal(creates,1);
    const second=await run(["--baseline"]);assert.equal(second.code,0,second.output);assert.equal(creates,1);
    assert.equal(JSON.parse(await readFile(state,"utf8")).tasks[0].taskId,"only-task");
    const baselineState=await readFile(state,"utf8");const balanceState=JSON.parse(baselineState);balanceState.purpose="technical";balanceState.untilBalance=true;await writeFile(state,JSON.stringify(balanceState));
    const balanceRun=await run(["--until-balance"]);assert.equal(balanceRun.code,0,balanceRun.output);assert.equal(creates,1);
    const mixed=await run(["--until-balance","--budget=10"]);assert.notEqual(mixed.code,0);assert.match(mixed.output,/不能同时/);
    await writeFile(state,baselineState);
    const expired=JSON.parse(await readFile(state,"utf8"));expired.tasks[0].watchStartedAt="2020-01-01T00:00:00Z";await writeFile(state,JSON.stringify(expired));task.status="generating";
    const stopped=await run(["--baseline"]);assert.notEqual(stopped.code,0);assert.equal(pauseCalls,2);assert.equal(JSON.parse(await readFile(state,"utf8")).tasks[0].pauseConfirmed,true);
    task.status="generating";pauseFailure=true;
    const uncertain=await run(["--baseline"]);assert.notEqual(uncertain.code,0);assert.match(uncertain.output,/未能确认暂停/);assert.equal(JSON.parse(await readFile(state,"utf8")).tasks[0].pauseConfirmed,false);assert.equal(creates,1);
    await writeFile(path.join(pictures,"a","1.jpg"),await sharp(image).modulate({brightness:.5}).jpeg().toBuffer());
    const changed=await run(["--baseline"]);assert.notEqual(changed.code,0);assert.match(changed.output,/不一致/);assert.equal(creates,1);
  }finally{await new Promise<void>(resolve=>mock.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});

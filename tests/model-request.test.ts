import test from "node:test";
import assert from "node:assert/strict";
import { modelRequest } from "../server/model-request";
import type { MvpTask } from "../lib/mvp-contract";

for(const scenario of ["success","invalid-json","balance","transport","parse"] as const) test("模型记录覆盖："+scenario,{concurrency:false},async()=>{
  const saved=globalThis.fetch;const records:MvpTask["modelCalls"]=[];let requests=0;
  try {
    globalThis.fetch=async()=>{requests++;assert.equal(records[0].status,"pending");if(scenario==="transport")throw new Error("connection lost");if(scenario==="invalid-json")return new Response("invalid");if(scenario==="balance")return new Response(JSON.stringify({error:{message:"insufficient balance"}}),{status:403});return new Response(JSON.stringify({usage:{input_tokens:10,output_tokens:5},result:42}));};
    const request=modelRequest({model:"mock",requestType:"generation",endpoint:"http://mock.invalid",body:{},timeoutMs:1000,observe:async call=>{records.push(structuredClone(call));}},payload=>{if(scenario==="parse")throw new Error("missing output");return payload.result;});
    if(scenario==="success")assert.equal(await request,42);else await assert.rejects(request,error=>scenario!=="balance" || Boolean((error as {fatalProvider?:boolean}).fatalProvider));
    assert.equal(requests,1);assert.equal(records.length,2);assert.equal(records[0].id,records[1].id);assert.equal(records[1].status,scenario==="success"?"success":scenario==="transport"?"unknown":"failed");
  } finally {globalThis.fetch=saved;}
});
test("写入调度记录失败时不发送网络请求",async()=>{
  const saved=globalThis.fetch;let requests=0;try{globalThis.fetch=async()=>{requests++;return new Response("{}");};await assert.rejects(modelRequest({model:"mock",requestType:"analysis",endpoint:"http://mock.invalid",body:{},timeoutMs:1000,observe:async()=>{throw Error("paused");}},()=>null));assert.equal(requests,0);}finally{globalThis.fetch=saved;}
});

test("HTTP 413纯文本响应保留可读原因且不重试",async()=>{ const saved=globalThis.fetch;let count=0;try{globalThis.fetch=async()=>{count++;return new Response("Request Entity Too Large",{status:413});};await assert.rejects(modelRequest({model:"mock",requestType:"analysis",endpoint:"http://mock.invalid",body:{},timeoutMs:1000},()=>null),/图片数据过大.*413/);assert.equal(count,1);}finally{globalThis.fetch=saved;} });

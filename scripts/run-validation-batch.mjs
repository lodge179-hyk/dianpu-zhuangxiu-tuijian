import { readFile,writeFile,mkdir,rename,unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prepareBatch } from "./batch-input.ts";

const args=process.argv.slice(2),has=flag=>args.includes(flag),value=name=>args.find(arg=>arg.startsWith(name+"="))?.slice(name.length+1);
const manifestPath=path.resolve(args.find(arg=>!arg.startsWith("--")&&arg.endsWith(".json"))??"validation/batch-manifest.json");
const limit=value("--limit")===undefined?Infinity:Number(value("--limit"));
const prepared=await prepareBatch(manifestPath,limit);
for(const item of prepared)console.log("["+(item.index+1)+"] "+item.metadata.testCategory+"："+item.metadata.products.length+" 件，"+item.files.length+" 张，输入 "+item.fingerprint.slice(0,12));
if(has("--check-only")){console.log("所有选定任务完整预检通过，未调用模型。");process.exit(0);}
if(!has("--confirm-costs"))throw Error("真实调用需明确 --confirm-costs");
const purpose=has("--baseline")?"baseline":"technical";
if(purpose==="baseline"&&prepared.length!==1)throw Error("独立基线必须仅有1个任务，请设置 --limit=1");
const budget=value("--budget")===undefined?undefined:Number(value("--budget"));
const untilBalance=has("--until-balance");
if(untilBalance&&budget!==undefined)throw Error("余额模式与固定预算不能同时设置");
if(purpose!=="baseline"&&!untilBalance&&(!Number.isFinite(budget)||budget<=0))throw Error("技术批次需要明确正数预算 --budget；未设置预算仅允许预检");
if(budget!==undefined&&(!Number.isFinite(budget)||budget<=0))throw Error("预算必须为正数");
if(budget!==undefined){const pricing=JSON.parse(await readFile(path.resolve(process.env.MVP_PRICING_FILE??"MISSING_PRICING_FILE"),"utf8"));for(const [model,types] of [[process.env.ARK_VISION_MODEL,["analysis","planning","quality_check"]],[process.env.ARK_IMAGE_MODEL,["generation"]]])for(const type of types)if(!Number.isFinite(pricing.models?.[model]?.[type])||pricing.models[model][type]<0)throw Error("预算上界表未完整配置："+type);}
const statePath=value("--state")?path.resolve(value("--state")):undefined;
if(!statePath)throw Error("执行必须指定 --state=记录文件，便于中断后安全继续");
await mkdir(path.dirname(statePath),{recursive:true});
const lockPath=statePath+".lock";
try{await writeFile(lockPath,JSON.stringify({pid:process.pid}),{flag:"wx"});}catch(error){if(error.code!=="EEXIST")throw error;const lock=JSON.parse(await readFile(lockPath,"utf8"));let live=true;try{process.kill(lock.pid,0);}catch(reason){if(reason.code==="ESRCH")live=false;else throw reason;}if(live)throw Error("该批次执行器仍在运行，不可重复启动");await unlink(lockPath);await writeFile(lockPath,JSON.stringify({pid:process.pid}),{flag:"wx"});}
const service=process.env.MVP_BATCH_SERVICE_URL??"http://127.0.0.1:5174";
let state;
const persist=async()=>{const temp=statePath+"."+process.pid+".tmp";await writeFile(temp,JSON.stringify(state,null,2));for(let i=0;;i++){try{await rename(temp,statePath);break;}catch(error){if(!["EPERM","EACCES","EBUSY"].includes(error.code)||i>=7)throw error;await new Promise(r=>setTimeout(r,25*(i+1)));}}};
const api=async(route,options={})=>{const response=await fetch(service+route,{signal:AbortSignal.timeout(30000),...options});const body=await response.json();if(!response.ok)throw Object.assign(Error(body.error??"HTTP "+response.status),{statusCode:response.status});return body;};
try{
  try{state=JSON.parse(await readFile(statePath,"utf8"));}catch(error){if(error.code!=="ENOENT")throw error;state={batchId:purpose+"-"+randomUUID(),purpose,budget,untilBalance,createdAt:new Date().toISOString(),tasks:prepared.map(item=>({index:item.index,fingerprint:item.fingerprint,files:item.files.map(({key,filename,hash})=>({key,filename,hash})),status:"prepared"}))};await persist();}
  if(Boolean(state.untilBalance)!==untilBalance||state.purpose!==purpose||state.budget!==budget||state.tasks.length!==prepared.length||state.tasks.some((record,i)=>record.fingerprint!==prepared[i].fingerprint))throw Error("输入/用途/预算与已有批次不一致；不要覆盖原记录");
  const health=await api("/health");if(!health.models?.analysis||!health.models?.generation||!health.models?.qualityCheck)throw Error("模型配置不完整");
  let reserved=0;
  for(const [index,item] of prepared.entries()){
    const record=state.tasks[index];let task;
    if(record.taskId)task=await api("/tasks/"+record.taskId);
    else{
      if(budget!==undefined&&reserved>=budget)throw Error("批次预算已用完");
      record.key=record.key??state.batchId+":"+index+":"+item.fingerprint;await persist();
      const form=new FormData();form.append("metadata",JSON.stringify({...item.metadata,batchId:state.batchId,testPurpose:purpose,batchBudgetCny:budget,budgetCny:budget===undefined?undefined:budget-reserved}));for(const file of item.files)form.append(file.key,new Blob([file.bytes],{type:file.mime}),file.filename);
      task=await api("/tasks",{method:"POST",headers:{"idempotency-key":record.key},body:form});record.taskId=task.id;record.status="created";await persist();
    }
    if(task.status==="draft"||task.status==="paused"&&has("--resume")){
      task=await api("/tasks/"+task.id+(task.status==="draft"?"/run":"/resume"),{method:"POST",headers:{"content-type":"application/json","if-match":String(task.revision)},body:"{}"});record.watchStartedAt=new Date().toISOString();record.status="running";await persist();
    }
    record.watchStartedAt??=new Date().toISOString();await persist();
    while(!["completed","partial_failed","failed","paused"].includes(task.status)){
      if(Date.now()-Date.parse(record.watchStartedAt)>30*60000){
        let pauseConfirmed=false;
        for(let attempt=0;attempt<3;attempt++){
          try{
            task=await api("/tasks/"+task.id);
            if(["completed","partial_failed","failed","paused","pausing"].includes(task.status)){pauseConfirmed=true;break;}
            task=await api("/tasks/"+task.id+"/pause",{method:"POST",headers:{"if-match":String(task.revision)},body:"{}"});
            pauseConfirmed=["paused","pausing"].includes(task.status);break;
          }catch(error){record.pauseError=error.message;if(error.statusCode!==409)break;}
        }
        record.snapshot=task;record.pauseConfirmed=pauseConfirmed;await persist();
        throw Error("单任务监测达到30分钟；"+(pauseConfirmed?"服务已确认暂停请求或处理已结束":"未能确认暂停，请检查任务是否仍在运行"));
      }
      await new Promise(r=>setTimeout(r,2000));task=await api("/tasks/"+task.id);
    }
    record.status=task.status;record.lastObservedAt=new Date().toISOString();record.snapshot=task;await persist();
    if(task.status!=="completed")throw Error("任务 "+task.id+" 为 "+task.status+"；批次停止，不自动重跑");
    if(budget!==undefined&&task.modelCalls.some(call=>call.reservedCost===undefined))throw Error("存在未知预算占用，停止后续任务");
    reserved+=task.modelCalls.reduce((sum,call)=>sum+(call.reservedCost??0),0);
    console.log("["+(index+1)+"] "+task.id+" 处理结束，人工评价另行记录");
  }
  state.finishedAt=new Date().toISOString();state.report=await api("/metrics?batchId="+encodeURIComponent(state.batchId));await persist();console.log("批次处理结束；记录："+statePath);
}catch(error){if(state){state.lastError=error.message;state.stoppedAt=new Date().toISOString();await persist();}throw error;}finally{await unlink(lockPath);}

import type { MvpTask } from "../lib/mvp-contract";

export function needsRecovery(task:MvpTask) {return ["queued","analyzing","planning","generating","checking","pausing"].includes(task.status)||task.modelCalls.some(c=>c.status==="pending");}
export function recoverInterruptedTask(task:MvpTask,at=new Date().toISOString()):MvpTask {
  const unknownAssets=new Set(task.modelCalls.filter(c=>c.status==="pending"&&c.requestType==="generation").map(c=>c.assetId));
  return {...task,status:"paused",currentStep:"服务重启后已暂停；结果不明的生图不会自动重复",modelCalls:task.modelCalls.map(call=>call.status==="pending"?{...call,status:"unknown",durationMs:Math.max(0,Date.parse(at)-Date.parse(call.createdAt)),error:"服务中断，结果与费用待核对"}:call),assets:task.assets.map(asset=>asset.status==="generating"||unknownAssets.has(asset.id)?{...asset,status:"failed",verdict:"pending",retryEligible:false,error:"生图请求结果不明；请核对后人工处理"}:asset)};
}

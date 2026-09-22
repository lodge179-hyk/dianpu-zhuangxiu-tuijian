import { canSelectPlan, hasLegalStructure, type MvpTask } from "../lib/mvp-contract";

const average=(values:number[])=>values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length):undefined;
export function summarizeTasks(allTasks:MvpTask[], batchId?:string) {
  const batches=[...new Set(allTasks.filter(t=>t.batchId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(t=>t.batchId!))];
  const selectedBatch=batchId ?? batches[0];
  const executed=allTasks.filter(t=>t.startedAt&&(selectedBatch?t.batchId===selectedBatch:!t.batchId));
  const terminal=executed.filter(t=>t.firstCompletedAt || t.completedAt);
  const assets=executed.flatMap(t=>t.assets), calls=executed.flatMap(t=>t.modelCalls);
  const ai=assets.filter(a=>["direct","preserve"].includes(a.initialRoute??a.route));
  const local=assets.filter(a=>["original","crop"].includes(a.initialRoute??"") );
  const firstPass=ai.filter(a=>a.initialVerdict==="pass").length;
  const unknown=ai.filter(a=>!a.initialVerdict).length;
  const retried=ai.filter(a=>a.automaticAttempts>1).length;
  const rejected=new Set(executed.flatMap(t=>[...t.assets.filter(a=>a.manuallyRejected).map(a=>a.id),...(t.assetEvents??[]).filter(e=>e.after.manuallyRejected).map(e=>e.assetId)]));
  const priced=calls.filter(c=>c.estimatedCost!==undefined);
  const reviewed=executed.filter(t=>t.adoptionReviews?.length);
  const adopted=reviewed.filter(t=>t.adoptionReviews!.at(-1)!.verdict==="adopt");
  const declined=reviewed.length-adopted.length;
  const planned=executed.filter(t=>t.plans.length);
  const valid=planned.filter(hasLegalStructure).length;
  const duration=terminal.filter(t=>t.firstCompletedAt).map(t=>Date.parse(t.firstCompletedAt!)-Date.parse(t.startedAt!)).filter(n=>Number.isFinite(n)&&n>=0);
  const categories=[...new Set(executed.map(t=>t.testCategory).filter((s):s is string=>Boolean(s)))];
  const repairs=terminal.filter(t=>t.firstCompletedAt&&t.completedAt&&t.completedAt!==t.firstCompletedAt).map(t=>Date.parse(t.completedAt!)-Date.parse(t.firstCompletedAt!)).filter(n=>n>=0);
  const pauseDurations=executed.filter(t=>t.stateEvents).map(t=>(t.stateEvents??[]).reduce((sum,event,index,events)=>event.to === "paused" ? sum+Math.max(0,Date.parse(events[index+1]?.at??t.firstCompletedAt??new Date().toISOString())-Date.parse(event.at)):sum,0));
  return {
    scope:{batchId:selectedBatch??null,batches,legacy:!selectedBatch,purposes:[...new Set(executed.map(t=>t.testPurpose??"debug"))]},
    tasks:{total:executed.length,terminal:terminal.length,adopted:adopted.length,declined,pendingReview:executed.length-reviewed.length,adoptionRate:executed.length?adopted.length/executed.length:0,currentlySelectable:executed.filter(t=>t.selectedPlanId&&canSelectPlan(t,t.selectedPlanId)).length,averageDurationMs:average(duration),unknownDuration:terminal.length-duration.length,averageRepairDurationMs:average(repairs),averagePauseDurationMs:average(pauseDurations),categories,categoryCount:categories.length,structurallyValid:valid,planned:planned.length,noOutput:executed.length-planned.length,structureRate:planned.length?valid/planned.length:null},
    quality:{totalAssets:assets.length,aiAssets:ai.length,firstPass,firstPassRate:ai.length?firstPass/ai.length:null,unknownFirstVerdict:unknown,retried,retryRate:ai.length?retried/ai.length:null,localAssets:local.length,localFirstPass:local.filter(a=>a.initialVerdict==="pass").length,unknownRoute:assets.length-ai.length-local.length,manuallyRejected:rejected.size,manualRejectionRate:assets.length?rejected.size/assets.length:0,manualRegenerations:assets.reduce((n,a)=>n+a.manualAttempts,0)},
    usage:{calls:calls.length,successful:calls.filter(c=>c.status==="success").length,failed:calls.filter(c=>c.status==="failed").length,unknown:calls.filter(c=>!c.status||c.status==="unknown"||c.status==="pending").length,inputTokens:calls.reduce((n,c)=>n+(c.inputTokens??0),0),outputTokens:calls.reduce((n,c)=>n+(c.outputTokens??0),0),unknownTokenCalls:calls.filter(c=>c.inputTokens===undefined||c.outputTokens===undefined).length,pricedCalls:priced.length,unknownCostCalls:calls.length-priced.length,estimatedCost:priced.reduce((n,c)=>n+c.estimatedCost!,0),requestDurationMs:calls.reduce((n,c)=>n+c.durationMs,0)}
  };
}

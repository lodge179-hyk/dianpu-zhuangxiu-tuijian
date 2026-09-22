import test from "node:test";
import assert from "node:assert/strict";
import { taskSchema } from "../lib/mvp-contract";
import { summarizeTasks } from "../server/metrics";
import { recoverInterruptedTask } from "../server/recovery";
import { moduleSlots,currentLayoutVersion,posterLayouts } from "../lib/module-layout";
import { validateInputMetadata,validateImageBytes } from "../server/input-validation";

const fixture=()=>taskSchema.parse({id:"test",revision:0,createdAt:"2026-09-11T00:00:00Z",updatedAt:"2026-09-11T00:00:00Z",startedAt:"2026-09-11T00:00:00Z",status:"completed",progress:100,brief:"稳定性测试任务",visualDescription:"自然柔光",products:[1,2,3].map(i=>({id:"p"+i,name:"商品"+i,isHero:i===1,images:[i+".jpg"]}))});
test("批次不混入历史调试，AI首轮与原图适配分开，未知不是零费用",()=>{
  const legacy=fixture();legacy.id="legacy";legacy.selectedPlanId="historical";
  const task=fixture();task.batchId="technical-1";task.testPurpose="technical";
  task.assets=[{id:"ai",moduleId:"m",productId:"p1",ratio:"1:1",role:"hero",route:"original",initialRoute:"preserve",status:"ready",verdict:"pass",initialVerdict:"reject",approvedRisk:false,manuallyRejected:false,automaticAttempts:2,manualAttempts:0,currentVersion:3},{id:"local",moduleId:"m2",productId:"p1",ratio:"1:1",role:"product",route:"original",initialRoute:"original",status:"ready",verdict:"pass",initialVerdict:"pass",approvedRisk:false,manuallyRejected:false,automaticAttempts:1,manualAttempts:0,currentVersion:1}];
  task.modelCalls=[{id:"c",createdAt:task.createdAt,model:"mock",requestType:"generation",durationMs:20,status:"unknown",reservedCost:1}];
  task.adoptionReviews=[{at:task.createdAt,verdict:"decline",versions:{ai:3}}];
  const report=summarizeTasks([legacy,task]);assert.equal(report.tasks.total,1);assert.equal(report.tasks.declined,1);assert.equal(report.tasks.pendingReview,0);assert.equal(report.quality.aiAssets,1);assert.equal(report.quality.firstPass,0);assert.equal(report.quality.localFirstPass,1);assert.equal(report.usage.unknownCostCalls,1);assert.equal(report.usage.unknown,1);assert.equal(report.usage.pricedCalls,0);
});
test("恢复中断任务：已存图片继续质检，未收到生图不允许自动再发",()=>{
  const task=fixture();task.status="generating";task.assets=[{id:"a",moduleId:"m",ratio:"1:1",role:"hero",route:"direct",status:"generating",verdict:"pending",approvedRisk:false,manuallyRejected:false,automaticAttempts:1,manualAttempts:0,currentVersion:0},{id:"b",moduleId:"m",ratio:"1:1",role:"hero",route:"direct",status:"checking",verdict:"pending",approvedRisk:false,manuallyRejected:false,automaticAttempts:1,manualAttempts:0,currentVersion:1}];task.modelCalls=[{id:"c",createdAt:task.createdAt,model:"mock",requestType:"generation",assetId:"a",status:"pending",durationMs:0}];
  const result=recoverInterruptedTask(task,"2026-09-11T00:00:10Z");assert.equal(result.status,"paused");assert.equal(result.modelCalls[0].status,"unknown");assert.equal(result.assets[0].retryEligible,false);assert.equal(result.assets[0].status,"failed");assert.equal(result.assets[1].status,"checking");
});
test("海报槽位比例由真实网格计算，历史素材保持旧协议",()=>{
  for(const [variant,layout] of Object.entries(posterLayouts)){const slots=moduleSlots("poster",variant,currentLayoutVersion);assert.equal(slots.length,layout.tiles.length);for(const slot of slots){const [w,h]=slot.ratio.split(":").map(Number);assert.ok(w>0&&h>0);}}
  assert.equal(moduleSlots("poster","combo1")[0].ratio,"1:2");assert.notEqual(moduleSlots("poster","combo1",currentLayoutVersion)[0].ratio,"1:2");
  const [wide,tall]=moduleSlots("poster","combo3",currentLayoutVersion)[0].ratio.split(":").map(Number);assert.ok(Math.abs(wide/tall-2.8/1.8)<.01);
});
test("批次和服务使用相同元数据约束，拒绝总图超限与重复字段",async()=>{
  const task=fixture();assert.doesNotThrow(()=>validateInputMetadata(task));task.products[1].id="p1";assert.throws(()=>validateInputMetadata(task));
  const many=fixture();many.products=Array.from({length:9},(_,i)=>({id:"p"+i,name:"商品",isHero:i===0,images:[`a${i}`,`b${i}`,`c${i}`]}));assert.throws(()=>validateInputMetadata(many));
  await assert.rejects(validateImageBytes(Buffer.from("this is not an image")));
});

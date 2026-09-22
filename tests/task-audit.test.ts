import test from "node:test";
import assert from "node:assert/strict";
import { taskSchema } from "../lib/mvp-contract";
import { buildFallbackPlans } from "../server/planner";
import { auditTaskUpdate } from "../server/task-audit";

function fixture() {
  const task = taskSchema.parse({ id: "audit", revision: 1, createdAt: "2026-09-11T00:00:00Z", updatedAt: "2026-09-11T00:00:00Z", status: "completed", progress: 100, brief: "测试商品装修结果", visualDescription: "自然柔光", products: [1,2,3].map(i => ({id: "p"+i, name: "商品"+i, isHero: i===1, images:[i+".jpg"]})), assets: [{id:"a",moduleId:"atmosphere-sign",productId:"p1",role:"hero",ratio:"3:2",route:"direct",status:"ready",verdict:"pass",initialVerdict:"reject",currentVersion:2,previousVersion:1}] });
  task.plans = buildFallbackPlans(task); task.plans[0].shopSign.assetIds = ["a"];
  return task;
}
test("改图撤销选择但保留人工采用的版本证据与首次失败", () => {
  const original = fixture(); const selected = auditTaskUpdate(original, {...original, selectedPlanId: original.plans[0].id}, "first");
  assert.equal(selected.adoptionReviews?.[0].versions.a, 2);
  const changed = structuredClone(selected); changed.assets[0].currentVersion = 3; changed.assets[0].initialVerdict = "pass";
  const result = auditTaskUpdate(selected, changed, "second");
  assert.equal(result.selectedPlanId, undefined); assert.equal(result.adoptionReviews?.length, 1);
  assert.equal(result.assets[0].initialVerdict, "reject");
  assert.equal(result.assetEvents?.[0].before.currentVersion, 2); assert.equal(result.assetEvents?.[0].after.currentVersion, 3);
});
test("人工否决撤销选择；恢复版本被识别且首次完成时间不被覆盖", () => {
  const before = fixture(); before.selectedPlanId = before.plans[0].id; before.firstCompletedAt = "2026-09-11T01:00:00Z";
  const next = structuredClone(before); next.assets[0].manuallyRejected = true; next.assets[0].verdict = "reject"; next.completedAt = "2026-09-11T03:00:00Z";
  const rejected = auditTaskUpdate(before, next, "reject"); assert.equal(rejected.selectedPlanId, undefined); assert.equal(rejected.firstCompletedAt, before.firstCompletedAt);
  const restored = structuredClone(rejected); restored.assets[0].currentVersion = 1; restored.assets[0].previousVersion = 2;
  assert.equal(auditTaskUpdate(rejected, restored, "restore").assetEvents?.at(-1)?.kind, "restored");
});

import test from "node:test";
import assert from "node:assert/strict";
import { formatCount, isStoreVariant, storeFormatRegistry } from "../lib/store-formats";
import { canSelectPlan, hasLegalStructure, taskSchema, type MvpTask } from "../lib/mvp-contract";
import { structureIssues } from "../lib/structure-validation";
import { buildFallbackPlans, planTask } from "../server/planner";
import { analyzeProducts } from "../server/analyzer";

const baseTask = (): MvpTask => ({ id: "task", revision: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: "draft", progress: 0, brief: "夏季女装上新并突出主推商品", visualDescription: "清透自然光和低饱和配色", products: [1, 2, 3].map((number) => ({ id: `p${number}`, name: `商品${number}`, isHero: number === 1, images: [`${number}.jpg`] })), styleReferences: [], productAnalyses: [], plans: [], assets: [], modelCalls: [] });


const preparedTask = () => {
  const task = baseTask(); task.plans = buildFallbackPlans(task);
  for (const plan of task.plans) for (const module of [plan.shopSign, ...plan.modules]) {
    const variant = (storeFormatRegistry[module.type as keyof typeof storeFormatRegistry].variants as Record<string, { slots: readonly { ratio: string; role: string }[] }>)[module.variant];
    module.assetIds = variant.slots.map((slot, index) => { const id = module.id + "-" + index; task.assets.push({ id, moduleId: module.id, productId: module.productIds[0], role: slot.role, ratio: slot.ratio, route: "original", status: "ready", verdict: "pass", approvedRisk: false, manuallyRejected: false, automaticAttempts: 1, manualAttempts: 0, currentVersion: 1 }); return id; });
  }
  return task;
};

test("格式注册表完整覆盖6类22种", () => { assert.equal(Object.keys(storeFormatRegistry).length, 6); assert.equal(formatCount, 22); assert.equal(isStoreVariant("poster", "combo3"), true); assert.equal(isStoreVariant("poster", "combo"), false); });
test("输入要求3至12件商品且只能有一个主推", () => { assert.equal(taskSchema.safeParse(baseTask()).success, true); const invalid = baseTask(); invalid.products[1].isHero = true; assert.equal(taskSchema.safeParse(invalid).success, false); });
test("固定规划生成三套合法且实质不同的方案", () => { const task = baseTask(); const plans = buildFallbackPlans(task); assert.deepEqual(plans.map((plan) => plan.strategy), ["atmosphere", "quick", "product"]); assert.equal(new Set(plans.map((plan) => plan.modules.map((module) => `${module.type}.${module.variant}`).join("|"))).size, 3); for (const plan of plans) assert.ok(plan.modules.length >= 3 && plan.modules.length <= 8); });
test("完整任务结构检查覆盖三案、招牌和正文模块", () => { const task = preparedTask(); assert.equal(hasLegalStructure(task), true); task.plans[1].modules = []; assert.equal(hasLegalStructure(task), false); });
test("存在未放行风险素材时方案不能正式选择", () => { const task = preparedTask(); task.assets[0].verdict = "risk"; assert.equal(canSelectPlan(task, task.plans[0].id), false); task.assets[0].approvedRisk = true; assert.equal(canSelectPlan(task, task.plans[0].id), true); });
test("未配置模型时仍生成明确的商品身份保护分析", async () => { const task = baseTask(); task.products[1].name = "机械结构商品"; const result = await analyzeProducts(task); assert.equal(result.analyses.length, 3); assert.equal(result.analyses[1].identitySensitive, true); assert.ok(result.analyses[0].protectedFeatures.includes("版型")); });
test("规划模型返回的 token 用量会进入调用元数据", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch; const oldKey = process.env.ARK_API_KEY; const oldModel = process.env.ARK_VISION_MODEL; const oldEndpoint = process.env.ARK_RESPONSES_ENDPOINT;
  try {
    process.env.ARK_API_KEY = "test"; process.env.ARK_VISION_MODEL = "vision-test"; process.env.ARK_RESPONSES_ENDPOINT = "https://example.invalid";
    const plans = buildFallbackPlans(baseTask());
    globalThis.fetch = async () => new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify(plans) }] }], usage: { input_tokens: 321, output_tokens: 123 } }), { status: 200, headers: { "content-type": "application/json" } });
    const result = await planTask(baseTask());
    assert.equal(result.model, "vision-test"); assert.equal(result.usage?.inputTokens, 321); assert.equal(result.usage?.outputTokens, 123); assert.equal(result.plans.length, 3); assert.deepEqual(result.plans[0].modules[0].productIds, ["p1"]); assert.equal(result.plans[0].modules[0].id, "atmosphere-0");
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.ARK_API_KEY; else process.env.ARK_API_KEY = oldKey;
    if (oldModel === undefined) delete process.env.ARK_VISION_MODEL; else process.env.ARK_VISION_MODEL = oldModel;
    if (oldEndpoint === undefined) delete process.env.ARK_RESPONSES_ENDPOINT; else process.env.ARK_RESPONSES_ENDPOINT = oldEndpoint;
  }
});

for (const [name, mutate] of [
  ["正文出现招牌", (task: MvpTask) => { task.plans[0].modules[0].type = "shopSign"; task.plans[0].modules[0].variant = "default"; }],
  ["缺失槽位素材", (task: MvpTask) => { task.plans[0].modules[0].assetIds = []; }],
  ["素材引用不存在", (task: MvpTask) => { task.assets.shift(); }],
  ["重复模块标识", (task: MvpTask) => { task.plans[1].modules[0].id = task.plans[0].modules[0].id; }],
  ["素材商品归属错误", (task: MvpTask) => { task.assets[0].productId = "missing"; }],
  ["比例与槽位不符", (task: MvpTask) => { task.assets[0].ratio = "9:1"; }],
  ["无实质结构差异", (task: MvpTask) => { task.plans[1].modules = task.plans[0].modules.map((m, i) => ({...m, id:"copy-" + i})); }],
] as const) test("阻止非法结构：" + name, () => { const task = preparedTask(); mutate(task); assert.ok(structureIssues(task).length); assert.equal(hasLegalStructure(task), false); assert.equal(canSelectPlan(task, task.plans[0].id), false); });
test("规划阶段允许空素材，结果阶段不允许", () => { const task = baseTask(); task.plans = buildFallbackPlans(task); assert.deepEqual(structureIssues(task, "planning"), []); assert.ok(structureIssues(task).length); });

for (const scenario of ["reordered", "duplicate", "unknown"] as const) test("商品分析身份绑定：" + scenario, { concurrency: false }, async () => {
  const savedFetch = globalThis.fetch;
  const keys = ["ARK_API_KEY", "ARK_VISION_MODEL", "ARK_RESPONSES_ENDPOINT"] as const;
  const saved = keys.map(key => process.env[key]);
  try {
    process.env.ARK_API_KEY = "mock"; process.env.ARK_VISION_MODEL = "mock"; process.env.ARK_RESPONSES_ENDPOINT = "https://example.invalid";
    const task = baseTask(); task.products.forEach(product => { product.images = []; });
    const ids = scenario === "reordered" ? ["p3", "p1", "p2"] : scenario === "duplicate" ? ["p1", "p1", "p3"] : ["p1", "p2", "alien"];
    globalThis.fetch = async () => new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify(ids.map(productId => ({ productId, summary: "identity-" + productId, identitySensitive: productId === "p2", protectedFeatures: [productId] }))) }] }] }));
    if (scenario === "reordered") {
      const result = await analyzeProducts(task);
      assert.deepEqual(result.analyses.map(item => item.summary), ["identity-p1", "identity-p2", "identity-p3"]);
      assert.equal(result.analyses[1].identitySensitive, true);
    } else await assert.rejects(analyzeProducts(task), /身份与输入不一致/);
  } finally {
    globalThis.fetch = savedFetch;
    keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
  }
});

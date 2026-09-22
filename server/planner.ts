import { modelRequest, type ModelCallObserver } from "./model-request";
import { assertStructure } from "../lib/structure-validation";
import type { MvpPlan, MvpTask } from "../lib/mvp-contract";
import { planSchema } from "../lib/mvp-contract";

const names = { atmosphere: "氛围叙事型", quick: "快速选购型", product: "商品聚焦型" } as const;
const rationales = { atmosphere: "先建立统一氛围，再通过主题内容引导顾客进入商品。", quick: "分类与商品入口前置，让目标明确的顾客更快完成选款。", product: "集中强化主推商品，同时保留必要的分类和搭配浏览路径。" } as const;
const layouts = {
  atmosphere: [["carousel", "large"], ["poster", "combo3"], ["text", "multiLine"], ["showcase", "double"]],
  quick: [["navigation", "five"], ["carousel", "small"], ["showcase", "triple"], ["poster", "double"]],
  product: [["carousel", "medium"], ["showcase", "single"], ["text", "singleLine"], ["poster", "combo1"], ["showcase", "slider"]],
} as const;

export function buildFallbackPlans(task: MvpTask): MvpPlan[] {
  const productIds = task.products.map((product) => product.id);
  return (Object.keys(layouts) as Array<keyof typeof layouts>).map((strategy) => ({
    id: `${task.id}-${strategy}`,
    strategy,
    name: names[strategy],
    rationale: rationales[strategy],
    shopSign: { id: `${strategy}-sign`, type: "shopSign", variant: strategy === "quick" ? "minimal" : strategy === "product" ? "classic" : "default", title: task.visualDescription, productIds: [task.products.find((product) => product.isHero)!.id], assetIds: [] },
    modules: layouts[strategy].map(([type, variant], index) => ({ id: `${strategy}-${index}`, type, variant, title: type === "text" ? task.brief.slice(0, 80) : undefined, productIds: type === "showcase" || type === "navigation" ? productIds : [task.products.find((product) => product.isHero)!.id], assetIds: [] })),
  }));
}

type Usage = { inputTokens?: number; outputTokens?: number };

export async function planTask(task: MvpTask, observe?: ModelCallObserver): Promise<{ plans: MvpPlan[]; model?: string; durationMs: number; usage?: Usage }> {
  const key = process.env.ARK_API_KEY; const model = process.env.ARK_VISION_MODEL; const endpoint = process.env.ARK_RESPONSES_ENDPOINT;
  if (!key || !model || !endpoint) return { plans: buildFallbackPlans(task), durationMs: 0 };
  const formats = "shopSign=default|classic|minimal; carousel=small|medium|large; navigation=four|five; showcase=single|double|triple|slider; poster=single|double|triple|slider|combo1|combo2|combo3; text=singleLine|multiLine|link";
  const prompt = `你是微购店铺首页规划器。经营目标：${task.brief}\n视觉方向：${task.visualDescription}\n商品分析：${task.products.map((product) => { const analysis = task.productAnalyses.find((item) => item.productId === product.id); return `${product.id}:${product.name}${product.isHero ? "(主推)" : ""}，${analysis?.summary ?? ""}`; }).join("；")}\n生成且只生成三套方案，strategy依次为atmosphere、quick、product，名称依次为氛围叙事型、快速选购型、商品聚焦型。每套恰好一个shopSign和3至8个正文模块，三套必须有实质差异。只允许：${formats}。文字模块不生成图片。不得声称所有图片均为实拍、商品绝对不变或未经编辑；这些保证不能由规划模型作出。shopSign必须是单个完整模块对象，不是字符串或数组，必须明确写type:"shopSign"；不得省略type。示例：{"id":"atmosphere","strategy":"atmosphere","name":"氛围叙事型","rationale":"先展示主题再展示商品","shopSign":{"id":"sign","type":"shopSign","variant":"default","title":"店铺名称","productIds":["${task.products.find(product => product.isHero)!.id}"],"assetIds":[]},"modules":[{"id":"body1","type":"carousel","variant":"large","productIds":["${task.products.find(product => product.isHero)!.id}"],"assetIds":[]}]}。示例只展示字段结构，实际正文必须3至8个模块。输出纯JSON数组。每套字段id,strategy,name,rationale,shopSign,modules；模块字段id,type,variant,title,productIds,assetIds（固定空数组）。`;
  const started = Date.now();
  return modelRequest({ model, requestType: "planning", endpoint, timeoutMs: 90000, observe, body: { model, store: false, max_output_tokens: 5000, reasoning: { effort: "minimal" }, input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }] } }, (payload) => {
  const text = payload.output?.flatMap((item: { content?: Array<{ type?: string; text?: string }> }) => item.content ?? []).find((item: { type?: string; text?: string }) => item.type === "output_text")?.text; if (!text) throw new Error("规划模型没有返回结果");
  const match = text.match(/\[[\s\S]*\]/); if (!match) throw new Error("规划结果不是有效JSON数组"); const value = JSON.parse(match[0]);
  if (!Array.isArray(value) || value.length !== 3) throw new Error("规划模型必须返回三套方案");
  const allowedProductIds = new Set(task.products.map((product) => product.id)); const fallbackProductId = task.products.find((product) => product.isHero)!.id;
  const plans = value.map((item, index) => { const strategy = ["atmosphere", "quick", "product"][index] as keyof typeof names; const normalizeModule = (module: Record<string, unknown>, id: string) => { if (Array.isArray(module.assetIds) && module.assetIds.length) throw new Error("规划阶段不得引用已有素材"); const proposed = Array.isArray(module.productIds) ? module.productIds : []; if (proposed.some((id) => typeof id !== "string" || !allowedProductIds.has(id))) throw new Error("规划引用了不存在的商品"); return { ...module, id, productIds: proposed.length ? [...new Set(proposed)] : [fallbackProductId], assetIds: [] }; }; const normalized = item as Record<string, unknown>; if(normalized.strategy !== strategy) throw new Error("规划策略数量或顺序不合法"); const proposedSign = normalized.shopSign && typeof normalized.shopSign === "object" ? normalized.shopSign as Record<string, unknown> : {}; if (proposedSign.type !== "shopSign") throw new Error("规划缺少合法置顶招牌"); const signVariant = strategy === "quick" ? "minimal" : strategy === "product" ? "classic" : "default"; return planSchema.parse({ ...normalized, id: `${task.id}-${strategy}`, strategy, name: names[strategy], shopSign: normalizeModule({ ...proposedSign, type: "shopSign", variant: signVariant }, `${strategy}-sign`), modules: Array.isArray(normalized.modules) ? normalized.modules.map((module, moduleIndex) => normalizeModule(module as Record<string, unknown>, `${strategy}-${moduleIndex}`)) : normalized.modules }); });
  if (new Set(plans.map((plan) => plan.modules.map((module) => `${module.type}.${module.variant}`).join("|"))).size !== 3) throw new Error("三套方案没有形成实质结构差异");
  assertStructure({ ...task, plans }, "planning");
  return { plans, model, durationMs: Date.now() - started, usage: { inputTokens: payload.usage?.input_tokens, outputTokens: payload.usage?.output_tokens } };
  });
}

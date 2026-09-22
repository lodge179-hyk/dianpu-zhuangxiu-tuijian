import { moduleSlots } from "./module-layout";
import { bodyModuleRange, isStoreVariant, storeFormatRegistry, type StoreFormatType } from "./store-formats";
import type { MvpTask } from "./mvp-contract";

export type StructurePhase = "planning" | "prepared";
/** Read old records permissively, but never execute or select an invalid result. */
export function structureIssues(task: Pick<MvpTask, "products" | "plans" | "assets" | "layoutVersion">, phase: StructurePhase = "prepared"): string[] {
  const issues: string[] = [];
  const unique = (values: string[], label: string) => {
    if (values.some((value) => !value.trim()) || new Set(values).size !== values.length) issues.push(`${label}必须非空且唯一`);
  };
  unique(task.products.map((p) => p.id), "商品 ID");
  unique(task.plans.map((p) => p.id), "方案 ID");
  unique(task.assets.map((a) => a.id), "素材 ID");
  if (task.plans.length !== 3 || task.plans.map((p) => p.strategy).join("|") !== "atmosphere|quick|product") issues.push("必须按顺序包含三套策略方案");
  if (new Set(task.plans.map((p) => p.modules.map((m) => `${m.type}.${m.variant}`).join("|"))).size !== 3) issues.push("三套方案必须有实质结构差异");
  const products = new Set(task.products.map((p) => p.id));
  const assets = new Map(task.assets.map((a) => [a.id, a]));
  const modules = task.plans.flatMap((p) => [p.shopSign, ...p.modules]);
  unique(modules.map((m) => m.id), "模块 ID");
  for (const plan of task.plans) {
    if (plan.shopSign.type !== "shopSign" || plan.modules.some((m) => m.type === "shopSign")) issues.push(`${plan.name}必须仅有一个置顶招牌`);
    if (plan.modules.length < bodyModuleRange.min || plan.modules.length > bodyModuleRange.max) issues.push(`${plan.name}正文必须为3至8个模块`);
  }
  for (const module of modules) {
    if (!isStoreVariant(module.type, module.variant)) { issues.push(`${module.id}格式非法`); continue; }
    if (module.productIds.some((id) => !products.has(id))) issues.push(`${module.id}引用了不存在的商品`);
    const format = storeFormatRegistry[module.type as StoreFormatType];
    const variant = { slots: moduleSlots(module.type,module.variant,task.layoutVersion) };
    if (variant.slots.length && !module.productIds.length) issues.push(`${module.id}缺少商品引用`);
    if (phase === "planning") {
      if (module.assetIds.length) issues.push(`${module.id}规划阶段不得指定已有素材`);
      continue;
    }
    if (module.assetIds.length !== variant.slots.length) issues.push(`${module.id}素材数量与槽位不一致`);
    module.assetIds.forEach((id, index) => {
      const asset = assets.get(id);
      if (!asset) { issues.push(`${module.id}引用的素材不存在：${id}`); return; }
      if (!asset.productId || !products.has(asset.productId) || !module.productIds.includes(asset.productId)) issues.push(`${module.id}素材商品归属错误`);
      if (variant.slots[index] && (asset.ratio !== variant.slots[index].ratio || asset.role !== variant.slots[index].role)) issues.push(`${module.id}素材用途或比例与槽位不一致`);
    });
  }
  return issues;
}

export function assertStructure(task: Pick<MvpTask, "products" | "plans" | "assets">, phase: StructurePhase = "prepared") {
  const issues = structureIssues(task, phase);
  if (issues.length) throw Object.assign(new Error(`结构检查失败：${issues.join("；")}`), { statusCode: 422 });
}

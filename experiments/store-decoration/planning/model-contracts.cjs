const { z } = require('zod');
const { usesPageDirection } = require('./page-direction.cjs');
const { planSchema, validatePlan } = require('./plan.cjs');
const { usesGenerationReferences, generationReferenceIds } = require('./visual-skill.cjs');
const clean = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : v;
const key = v => typeof v === 'string' ? v.normalize('NFKC').replace(/\s+/g, '').toLowerCase() : '';
const list = v => Array.isArray(v) ? v : [];
const lines = (v, count, max = 180) => [...new Set(list(v).filter(x => typeof x === 'string').map(x => clean(x, max)).filter(Boolean))].slice(0, count);
function parseModel(schema, value, label) {
  const result = schema.safeParse(value);
  if (!result.success) throw Error(`${label}的必要内容不完整：${result.error.issues.slice(0, 3).map(i => i.path.join('.') || '整体结构').join('、')}。已保留结果，可从本阶段继续。`);
  return result.data;
}
const product = z.object({
  description: z.string().min(1).max(180).describe('商品可见外观；仅此字段填写描述文字'),
  imageIndex: z.number().int().min(1).max(6).describe('必填：商品来源截图编号，取自输入 attachments 的 imageIndex，不是商品顺序'),
}).describe('一件商品必须是包含 description 和 imageIndex 的 JSON 对象，不能是字符串');
// A product belongs to its enclosing group; there is no second category name to disagree with it.
const recognitionRequestSchema = z.object({ sufficient: z.boolean(), groups: z.array(z.object({ name: z.string().min(1).max(20), products: z.array(product).min(1).max(16) })).max(5), observations: z.array(z.string().max(180)).max(8), uncertainties: z.array(z.string().max(180)).max(8), missing: z.array(z.string().max(180)).max(5) });
const recognitionSchema = z.object({ sufficient: z.boolean(), categories: z.array(z.string().min(1).max(20)).max(5), products: z.array(product.extend({ category: z.string().min(1).max(20) })).max(80), observations: z.array(z.string()).max(8), uncertainties: z.array(z.string()).max(8), missing: z.array(z.string()).max(5) });
function validateRecognition(value, count, { minProducts = 2 } = {}) {
  if (!value || typeof value !== 'object') throw Error('识别结果不是商品资料，已保存响应。');
  const categories = [], products = [], seen = new Set();
  const names = new Map();
  // Legacy flat responses use product labels as the evidence; only labels with actual products survive.
  const source = Array.isArray(value.groups) ? value.groups.flatMap((g, groupIndex) => {
    // Malformed groups must not silently disappear while valid products continue.
    if (!g || typeof g !== 'object' || Array.isArray(g) || !Array.isArray(g.products)) throw Error(`商品识别格式不完整：第 ${groupIndex + 1} 组必须包含商品列表（products 数组），不能是文字或缺少列表。已保存响应，未跳过该组；可沿用已有资料重新识别。`);
    return g.products.map((p, productIndex) => {
      // Reject malformed products before object spread can turn a string into indexed characters.
      if (!p || typeof p !== 'object' || Array.isArray(p)) throw Error(`商品识别格式不完整：第 ${groupIndex + 1} 组第 ${productIndex + 1} 件商品必须包含描述和来源图片编号（description、imageIndex），不能只返回文字。已保存响应，未猜测对应图片；可沿用已有资料重新识别。`);
      if (typeof p.description !== 'string' || !p.description.trim()) throw Error(`商品识别格式不完整：第 ${groupIndex + 1} 组第 ${productIndex + 1} 件商品缺少有效描述（description），描述必须放在该商品对象内。已保存响应，可沿用已有资料重新识别。`);
      return { ...p, category: g.name };
    });
  }) : list(value.products);
  for (const [productIndex, item] of source.entries()) {
    if (!item || typeof item !== 'object') throw Error('商品识别缺少商品资料，已保留结果。');
    const rawName = clean(item.category, 20), identity = key(rawName);
    if (!identity) throw Error('商品识别缺少分类名称，已保留结果。');
    if (!names.has(identity)) { names.set(identity, rawName); categories.push(rawName); }
    let imageIndex = item.imageIndex;
    if (typeof imageIndex === 'string' && /^\s*\d+\s*$/.test(imageIndex)) imageIndex = Number(imageIndex);
    if (imageIndex === undefined && count === 1) imageIndex = 1;
    if (!Number.isInteger(imageIndex) || imageIndex < 1 || imageIndex > count) throw Error(`商品证据图片编号应为 1 至 ${count}，第 ${productIndex + 1} 件商品收到 ${String(imageIndex).slice(0, 20)}；未猜测对应图片。已保存响应，可沿用已有资料重新识别。`);
    const entry = { category: names.get(identity), description: clean(item.description, 180), imageIndex };
    const signature = identity + '|' + key(entry.description);
    if (!seen.has(signature)) { products.push(entry); seen.add(signature); }
  }
  if (categories.length > 5) throw Error('识别出了超过 5 个不同分组；需重新归并分类后继续，原截图已保留。');
  const result = parseModel(recognitionSchema, { sufficient: value.sufficient === 'true' ? true : value.sufficient === 'false' ? false : value.sufficient, categories, products, observations: lines(value.observations, 8), uncertainties: lines(value.uncertainties, 8), missing: lines(value.missing, 5) }, '商品识别');
  if (result.sufficient && products.length < minProducts) { result.sufficient = false; result.missing = [minProducts===1 ? '请提供至少一件清楚可辨的商品照片。' : '请补充包含至少两种清楚商品或款式的列表截图。']; }
  return result;
}
function color(v) {
  if (typeof v !== 'string') return v;
  const s = v.trim(), m = /^#([\da-f])([\da-f])([\da-f])$/i.exec(s);
  return m ? '#' + m.slice(1).map(c => c + c).join('') : s;
}
const researchSchema = z.object({ concept: z.string().min(1).max(100), reason: z.string().min(1).max(400), style: planSchema.shape.style, anchors: z.array(z.string().min(1).max(120)).min(1).max(3), selectedSources: z.array(z.object({ sourceId: z.string(), application: z.string().min(1).max(300) })).min(1).max(3) });
function validateResearch(value, sources) {
  if (!sources.length) throw Error('联网检索没有返回可核实的来源，已停止。');
  if (value && typeof value === 'object' && typeof value.concept !== 'string' && ('$schema' in value || value.properties?.concept || value.properties?.style)) {
    throw Error('风格设计模型返回了字段格式说明（JSON Schema），没有实际风格方案。原始响应已保存，可点击“沿用已有资料继续”从风格阶段重新请求；尚未生图，无须重新上传商品图片。');
  }
  const selected = [], ids = new Set();
  for (const item of list(value?.selectedSources)) {
    const id = typeof item?.sourceId === 'string' ? item.sourceId.trim().toLowerCase() : '';
    if (!sources.some(s => s.id === id)) throw Error('选定风格引用了本次搜索之外的编号，已停止。');
    if (!ids.has(id)) { ids.add(id); selected.push({ sourceId: id, application: clean(item.application, 300) }); }
  }
  const s = value?.style || {};
  const result = parseModel(researchSchema, { concept: clean(value?.concept, 100), reason: clean(value?.reason, 400), style: { palette: [...new Set(list(s.palette).map(color))].slice(0, 4), background: clean(s.background, 200), lighting: clean(s.lighting, 200), photography: clean(s.photography, 200) }, anchors: lines(value?.anchors, 3, 120), selectedSources: selected.slice(0, 3) }, '风格设计');
  result.selectedSources = result.selectedSources.map(item => ({ ...sources.find(s => s.id === item.sourceId), application: item.application }));
  return result;
}
const designSchema = z.object({ artDirection: z.object({ concept: z.string().min(1).max(120), narrative: z.string().min(1).max(400), anchors: z.array(z.string().min(1).max(120)).min(1).max(3) }), assets: z.array(z.object({ id: z.string(), visualReference: planSchema.shape.assets.element.shape.visualReference, prompt: z.string().min(20).max(1600), camera: z.enum(['wide', 'eye-level', 'top-down', 'macro']), treatment: z.enum(['environment', 'human-use', 'still-life', 'texture', 'graphic']) })).min(1).max(12) });
function applyDesign(skeleton, value, { visualProfile = null } = {}) {
  // A schema is valid JSON, but is not a set of completed image briefs.
  if (!Array.isArray(value?.assets)) {
    if (value && typeof value === 'object' && ('$schema' in value || value.properties?.assets || value.properties?.artDirection)) {
      throw Error('画面设计模型返回了格式说明（JSON Schema），没有实际图片设计。原始响应已保存，可从画面设计继续；尚未生图，无须重新上传商品图片。');
    }
    throw Error('画面设计响应缺少有效的图片设计列表（assets 数组）。原始响应已保存，可从画面设计继续；尚未生图，无须重新上传商品图片。');
  }
  const items = value.assets, byId = new Map();
  for (const a of items) {
    const id = typeof a?.id === 'string' ? a.id.trim().toLowerCase() : '';
    if (!skeleton.assets.some(t => t.id === id) || byId.has(id)) throw Error('画面设计包含未知或重复素材编号，已保留响应。');
    byId.set(id, a);
  }
  const missing = skeleton.assets.filter(task => !byId.has(task.id)).map(task => task.id);
  if (missing.length) throw Error(`画面设计缺少素材描述：应有 ${skeleton.assets.length} 张，收到 ${byId.size} 张，缺少 ${missing.join('、')}。已保留响应，可从画面设计继续；尚未生图，无须重新上传商品图片。`);
  const art = value.artDirection || {};
  const assets = skeleton.assets.map(task => {
    const a = byId.get(task.id), d = a.direction || {};
    const prompt = parseModel(z.string().trim().min(skeleton.studio?.version>=2?1:20).max(1600), clean(a.prompt, 1600), `画面提示词 ${task.id}`);
    const choose = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
    let visualReference;
    if (usesGenerationReferences(visualProfile)) {
      const ref = usesPageDirection(visualProfile) && task.visualReference ? task.visualReference : a.visualReference;
      visualReference = parseModel(planSchema.shape.assets.element.shape.visualReference.unwrap(), { id: clean(ref?.id, 40), borrow: clean(ref?.borrow, 120), avoid: clean(ref?.avoid, 120) }, `画面 ${task.id} 的视觉参考`);
      if (!generationReferenceIds(visualProfile).includes(visualReference.id)) throw Error(`画面 ${task.id} 引用了本任务之外的案例编号；已保留响应，未自行换图。`);
    }
    return { ...task, ...(visualReference ? { visualReference } : {}), subject: clean(a.subject || task.subject, 180), composition: clean(a.composition || prompt, 300), prompt, direction: { role: task.direction.role, camera: choose(a.camera || d.camera, ['wide', 'eye-level', 'top-down', 'macro'], task.direction.camera), treatment: choose(a.treatment || d.treatment, ['environment', 'human-use', 'still-life', 'texture', 'graphic'], task.direction.treatment), background: clean(d.background || skeleton.style.background, 180), accents: clean(d.accents || skeleton.style.palette.join('、'), 120) } };
  });
  // Geometry, role, and focal position are program-owned, not fields an AI needs to repeat correctly.
  return validatePlan({ ...skeleton, imageMode: 'category-inspired', artDirection: { concept: clean(art.concept || skeleton.artDirection.concept, 120), narrative: clean(art.narrative || skeleton.artDirection.narrative, 400), anchors: lines(art.anchors?.length ? art.anchors : skeleton.artDirection.anchors, 3, 120), focalAssetId: 'overview' }, assets }).plan;
}
module.exports = { recognitionRequestSchema, recognitionSchema, researchSchema, designSchema, validateRecognition, validateResearch, applyDesign };

const { z } = require('zod');
const { catalog, entries } = require('./catalog.cjs');
const id = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
const aspectRatios = { '3:1': 3, '483:258': 483 / 258, '4:3': 4 / 3, '1:1': 1, '3:4': 3 / 4, '577:848': 577 / 848 };
const planSchema = z.object({
  version: z.literal(1),
  shop: z.object({ name: z.string().min(1).max(30), category: z.string().min(1).max(100), observations: z.array(z.string().max(180)).max(10), uncertainties: z.array(z.string().max(180)).max(10) }).strict(),
  summary: z.string().min(1).max(300),
  style: z.object({ palette: z.array(z.string().regex(/^#[\da-fA-F]{6}$/)).min(2).max(4), background: z.string().min(1).max(200), lighting: z.string().min(1).max(200), photography: z.string().min(1).max(200) }).strict(),
  modules: z.array(z.object({ id, type: z.enum(Object.keys(entries)), purpose: z.string().min(1).max(180), props: z.object({ assetIds: z.array(id).max(9), text: z.string().max(180), labels: z.array(z.string().max(24)).max(5), titles: z.array(z.string().max(48)).max(9) }).strict() }).strict()).min(3).max(24),
  assets: z.array(z.object({ id, subject: z.string().min(1).max(180), composition: z.string().min(1).max(300), aspect: z.enum(Object.keys(aspectRatios)), direction: z.object({ role: z.enum(['atmosphere', 'hero', 'category', 'scene', 'detail', 'product']), camera: z.enum(['wide', 'eye-level', 'top-down', 'macro']), background: z.string().min(1).max(180), accents: z.string().min(1).max(120) }).strict().optional() }).strict()).min(1).max(12),
  batches: z.array(z.object({ id, rows: z.array(z.array(id).min(1).max(4)).min(1).max(4) }).strict()).min(1).max(2),
}).strict();

function validatePlan(input) {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) throw new Error('方案格式不合格：' + parsed.error.issues.slice(0, 6).map(i => `${i.path.join('.')} ${i.message}`).join('；'));
  const plan = parsed.data;
  const unique = (list, label) => { if (new Set(list).size !== list.length) throw new Error(`${label}编号重复`); };
  unique(plan.modules.map(m => m.id), '模块'); unique(plan.assets.map(a => a.id), '素材'); unique(plan.batches.map(b => b.id), '批次');
  const signs = plan.modules.filter(m => m.type.startsWith('signboard.'));
  if (signs.length !== 1 || plan.modules[0] !== signs[0]) throw new Error('店铺必须以唯一一个招牌开始');
  const spec = { modules: plan.modules.map(({ id, type, props }) => ({ id, type, props })) };
  if (!catalog.validate(spec).success) throw new Error('方案未通过组件目录校验');
  const assets = new Map(plan.assets.map(a => [a.id, a])), used = new Set(), warnings = [];
  for (const m of plan.modules) {
    const entry = entries[m.type];
    const props = entry.props.safeParse(m.props);
    if (!props.success) throw new Error(`${m.id} ${m.type} 参数不符合固定组件要求：${props.error.issues.map(i => i.message).join('；')}`);
    if (m.type === 'showcase.three' && m.props.assetIds.length % 3) throw new Error('三列橱窗需要完整的3、6或9项');
    if (entry.family === 'text' && !m.props.text.trim()) throw new Error(`${m.id} 文本不能为空`);
    if (entry.family === 'showcase' && m.props.titles.length !== m.props.assetIds.length) throw new Error(`${m.id} 橱窗名称需要与图片一一对应`);
    if (entry.family === 'navigation' && m.props.labels.length !== m.props.assetIds.length) throw new Error(`${m.id} 导航标签需要与图片一一对应`);
    m.props.assetIds.forEach((assetId, index) => {
      const asset = assets.get(assetId); if (!asset) throw new Error(`${m.id} 引用了不存在的素材 ${assetId}`);
      used.add(assetId);
      const ratio = aspectRatios[asset.aspect], slot = entry.slots[index];
      const removed = 1 - Math.min(ratio / slot.aspect, slot.aspect / ratio);
      if (removed > .35) warnings.push(`${m.id} 第${index + 1}张使用 ${assetId}，适配槽位约裁去${Math.round(removed * 100)}%面积，需留意构图。`);
    });
  }
  for (const asset of plan.assets) if (!used.has(asset.id)) throw new Error(`素材 ${asset.id} 没有对应模块，避免无用途生图`);
  const categoryAssets = new Set(plan.modules.filter(m => m.type.startsWith('navigation.')).flatMap(m => m.props.assetIds));
  for (const m of plan.modules.filter(m => /^(poster|carousel)\./.test(m.type))) {
    m.props.assetIds.forEach((assetId, index) => {
      if (categoryAssets.has(assetId) && entries[m.type].slots[index].width >= 200) warnings.push(`${m.id} 将导航素材 ${assetId} 复用到较大画面，建议给主视觉独立构图，避免整页反复出现同一单品照。`);
    });
  }
  const editorial = plan.assets.filter(a => a.direction && a.direction.role !== 'category' && a.direction.role !== 'product');
  if (editorial.length >= 4 && new Set(editorial.map(a => a.direction.camera)).size < 2) warnings.push('素材计划中的主视觉都使用同一镜头类型，建议混合场景、俯拍或特写；此检查只看计划，不代表实际生图质量。');
  const assigned = [];
  for (const batch of plan.batches) {
    if (batch.rows.flat().length > 6) throw new Error(`${batch.id} 超过每张总图6个画面的上限`);
    for (const row of batch.rows) {
      if (row.some(id => !assets.has(id))) throw new Error(`${batch.id} 包含未声明素材`);
      if (new Set(row.map(id => assets.get(id).aspect)).size !== 1) throw new Error(`${batch.id} 同一行需使用相同比例，方便可靠裁剪`);
      assigned.push(...row);
    }
    const shape = batch.rows.reduce((sum, row) => sum + 1 / (row.length * aspectRatios[assets.get(row[0]).aspect]), 0);
    if (shape > 2.8 || shape < .45) throw new Error(`${batch.id} 总图过长或过扁，请调整行分配`);
  }
  unique(assigned, '生图素材');
  if (assigned.length !== used.size || [...used].some(id => !assigned.includes(id))) throw new Error('每张所需素材必须且只能分配到一个生图批次');
  return { plan, warnings, metrics: { modules: plan.modules.length, imageSlots: plan.modules.reduce((n, m) => n + m.props.assetIds.length, 0), uniqueAssets: assets.size, generationCalls: plan.batches.length } };
}

function styleLock(style) {
  return `Shared art direction: color family ${style.palette.join(', ')}; setting family: ${style.background}; light: ${style.lighting}; photographic finish: ${style.photography}. Unify color grading and image quality. Treat the palette as available accents, not a requirement to put every color in every photo. Each panel's own background, camera and product selection take priority. Different categories may use different packaging, materials and scenes; do not turn the whole store into one imaginary product brand.`;
}
function buildBatches(plan) {
  const lookup = new Map(plan.assets.map(a => [a.id, a]));
  const lock = styleLock(plan.style);
  return plan.batches.map((batch, index) => {
    const rowWeights = batch.rows.map(row => 1 / (row.length * aspectRatios[lookup.get(row[0]).aspect]));
    const total = rowWeights.reduce((a, b) => a + b, 0);
    const prompt = [
      'Create ONE photographic asset sheet for a store decoration reference. This is a sheet of independent photographs, not a website or UI.',
      lock,
      index ? 'Reference scope: use the previous sheet only to match white balance, photographic finish and the overall color family. Do not copy its bottles, packaging, props, background set, camera angle or panel arrangement unless explicitly requested for an individual asset. Follow each new panel brief.' : '',
      'Assign distinct visual jobs to the panels: atmosphere, hero, category identification, scene or detail. Vary camera distance, angle, subject grouping and negative space according to each brief. A coherent collection should contain visibly different photographs. Do not repeat the same product-on-pedestal scene across the sheet.',
      `Exactly ${batch.rows.flat().length} rectangular panels in ${batch.rows.length} horizontal rows, with row counts ${batch.rows.map(r => r.length).join(' / ')}. Approximate whole sheet width:height = 1:${total.toFixed(2)}. Keep all panels complete.`,
      ...batch.rows.map((row, i) => `Row ${i + 1}, about ${Math.round(rowWeights[i] / total * 100)}% of usable sheet height: ` + row.map((id, j) => { const a = lookup.get(id), d = a.direction; return `panel ${j + 1} (${id}): ${a.subject}; ${a.composition}; image aspect ${a.aspect}` + (d ? `; job: ${d.role}; camera: ${d.camera}; this panel's setting: ${d.background}; this panel's accents: ${d.accents}` : ''); }).join(' | ')),
      'Use uniform, solid MAGENTA #FF00FF for the outer margin and straight gaps between every panel (about 1-2% of width). Each photo must have its own opaque background. No gradient in separators; no magenta in photos; no object or shadow may cross a panel boundary.',
      'Keep focal content inside a generous safe area for ratio correction. For navigation photos keep the subject inside the central 65% for a circular crop. Signboard backgrounds leave the lower 35% uncluttered for fixed shop information. Intentional partial garment framing is allowed.',
      'Do not render text, panel labels, numbers, logos, watermarks, prices, navigation, buttons or other UI. Goods are illustrative examples, not a claim to reproduce an actual customer SKU.',
    ].filter(Boolean).join('\n\n');
    return { ...batch, panelCount: batch.rows.flat().length, referenceBatchId: index ? plan.batches[index - 1].id : null, styleLock: lock, prompt };
  });
}
module.exports = { planSchema, validatePlan, buildBatches, aspectRatios };

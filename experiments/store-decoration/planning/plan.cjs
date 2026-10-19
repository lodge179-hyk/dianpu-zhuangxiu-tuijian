const { z } = require('zod');
const { catalog, entries } = require('./catalog.cjs');
const { usesProductVisualMethod } = require('./visual-profile.cjs');
const { usesJewelryCampaign, usesCampaignIdentity } = require('./campaign-contract.cjs');
const { batchVisualReferences, usesGenerationReferences, usesReferenceBackground } = require('./visual-skill.cjs');
const id = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
const visualReferenceSchema = z.object({ id, borrow: z.string().min(1).max(120), avoid: z.string().min(1).max(120) }).strict();
const aspectRatios = { '3:1': 3, '483:258': 483 / 258, '4:3': 4 / 3, '1:1': 1, '3:4': 3 / 4, '577:848': 577 / 848 };
const planSchema = z.object({
  version: z.literal(1),
  imageMode: z.literal('category-inspired').optional(),
  shop: z.object({ name: z.string().min(1).max(30), category: z.string().min(1).max(100), observations: z.array(z.string().max(180)).max(10), uncertainties: z.array(z.string().max(180)).max(10) }).strict(),
  summary: z.string().min(1).max(300),
  navigationLibrary: z.object({ style: z.enum(['auto', 'clean', 'warm']) }).strict().optional(),
  artDirection: z.object({ concept: z.string().min(1).max(120), narrative: z.string().min(1).max(400), anchors: z.array(z.string().min(1).max(120)).min(1).max(3), focalAssetId: id }).strict().optional(),
  campaign: z.object({
    reference: visualReferenceSchema,
    collection: z.array(z.object({ id: z.string().regex(/^design-[1-9]\d*$/), category: z.string().min(1).max(20), appearance: z.string().min(1).max(240) }).strict()).min(1).max(12),
  }).strict().optional(),
  style: z.object({ palette: z.array(z.string().regex(/^#[\da-fA-F]{6}$/)).min(2).max(4), background: z.string().min(1).max(200), lighting: z.string().min(1).max(200), photography: z.string().min(1).max(200) }).strict(),
  modules: z.array(z.object({ id, type: z.enum(Object.keys(entries)), purpose: z.string().min(1).max(180), props: z.object({ assetIds: z.array(id).max(9), text: z.string().max(180), labels: z.array(z.string().max(24)).max(5), titles: z.array(z.string().max(48)).max(9) }).strict() }).strict()).min(3).max(24),
  assets: z.array(z.object({ id, visualReference: visualReferenceSchema.optional(), designIds: z.array(z.string().regex(/^design-[1-9]\d*$/)).min(1).max(6).optional(), prompt: z.string().min(20).max(1600).optional(), subject: z.string().min(1).max(180), composition: z.string().min(1).max(300), aspect: z.enum(Object.keys(aspectRatios)), direction: z.object({ role: z.enum(['atmosphere', 'hero', 'category', 'scene', 'detail', 'product']), camera: z.enum(['wide', 'eye-level', 'top-down', 'macro']), background: z.string().min(1).max(180), accents: z.string().min(1).max(120), treatment: z.enum(['environment', 'human-use', 'still-life', 'texture', 'graphic']).optional() }).strict().optional() }).strict()).min(1).max(12),
  batches: z.array(z.object({ id, rows: z.array(z.array(id).min(1).max(4)).min(1).max(4) }).strict()).min(1).max(2),
}).strict();

function validatePlan(input) {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) throw new Error('方案格式不合格：' + parsed.error.issues.slice(0, 6).map(i => `${i.path.join('.')} ${i.message}`).join('；'));
  const plan = parsed.data;
  if (plan.imageMode && (!plan.artDirection || plan.assets.some(a => !a.prompt || !a.direction))) throw new Error('商品装修方案缺少 AI 画面设计或最终提示词');
  const unique = (list, label) => { if (new Set(list).size !== list.length) throw new Error(`${label}编号重复`); };
  unique(plan.modules.map(m => m.id), '模块'); unique(plan.assets.map(a => a.id), '素材'); unique(plan.batches.map(b => b.id), '批次');
  if (plan.campaign) {
    unique(plan.campaign.collection.map(item => item.id), '款式');
    const designs = new Set(plan.campaign.collection.map(item => item.id));
    for (const asset of plan.assets) if (!asset.designIds?.length || asset.designIds.some(ref => !designs.has(ref))) throw Error(`素材 ${asset.id} 缺少有效款式引用，未自行补写外观。`);
  }
  const signs = plan.modules.filter(m => m.type.startsWith('signboard.'));
  if (signs.length !== 1 || plan.modules[0] !== signs[0]) throw new Error('店铺必须以唯一一个招牌开始');
  const spec = { modules: plan.modules.map(({ id, type, props }) => ({ id, type, props })) };
  if (!catalog.validate(spec).success) throw new Error('方案未通过组件目录校验');
  const assets = new Map(plan.assets.map(a => [a.id, a])), used = new Set(), warnings = [];
  if (plan.artDirection && !assets.has(plan.artDirection.focalAssetId)) throw new Error('整页视觉重点必须引用已声明素材');
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
  if (editorial.length >= 4 && editorial.every(a => a.direction.treatment) && new Set(editorial.map(a => a.direction.treatment)).size < 2) warnings.push('主要素材仍是同一种表现方式；换角度不一定能减少重复，需检查整页主题及主次。');
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
function campaignStyleLock(plan) {
  return [
    '【全套摄影约定：适用于每一格，优先于局部参考的风格】',
    `整页主题：${plan.artDirection.concept}。浏览节奏：${plan.artDirection.narrative}。`,
    `统一色板：${plan.style.palette.join('、')}。环境与色彩分工：${plan.style.background}`,
    `共同布光与白平衡：${plan.style.lighting}`,
    `共同影调与后期质感：${plan.style.photography}`,
    `跨图视觉联系：${plan.artDirection.anchors.join('；')}`,
    '整页如同一次有创意的品牌拍摄：色板不是给所有图片刷同一底色，也不改变商品本色。明部、暗部、人物服装及环境局部均属于这套视觉语言；不同镜头仍有同一光质、材质关系与调色。局部构图参考不可引入另一套色温或布景。',
    '保留强弱节奏：主视觉通过尺度、姿态或局部反差形成最醒目的焦点；辅助图改变景别、款式、构图与留白，保留鲜明的支撑画面和安静的浏览图。不要每格都争当主视觉，也不要统一成无层次的素底小商品。',
  ].join('\n');
}
function buildBatches(plan, excludedAssetIds = [], visualProfile = null) {
  const lookup = new Map(plan.assets.map(a => [a.id, a]));
  if (usesCampaignIdentity(visualProfile) && !plan.campaign) throw Error('整页摄影基准未写入方案，尚未生图；请从画面设计继续。');
  const lock = usesCampaignIdentity(visualProfile) ? campaignStyleLock(plan) : styleLock(plan.style);
  const excluded = new Set(excludedAssetIds);
  const pending = plan.batches.map(batch => ({ ...batch, rows: batch.rows.map(row => row.filter(id => !excluded.has(id))).filter(row => row.length) })).filter(batch => batch.rows.length);
  return pending.map((batch, index) => {
    const rowWeights = batch.rows.map(row => 1 / (row.length * aspectRatios[lookup.get(row[0]).aspect]));
    const total = rowWeights.reduce((a, b) => a + b, 0);
    const prompt = plan.imageMode === 'category-inspired' ? productBatchPrompt(plan, batch, lookup, rowWeights, total, index, visualProfile) : [
      'Create ONE asset sheet for an art-directed store campaign. Each panel is an independent finished visual in the medium specified by its brief, not a website or UI. Do not default every panel to a product packshot.',
      lock,
      plan.artDirection ? `Page concept: ${plan.artDirection.concept}. Narrative and visual hierarchy: ${plan.artDirection.narrative}. Shared anchors: ${plan.artDirection.anchors.join('; ')}. The page focal asset is ${plan.artDirection.focalAssetId}; give supporting visuals quieter or closer framing instead of making every panel compete as a hero. Follow each panel brief; do not repeat the same subject just to create unity.` : '',
      index ? 'Reference scope: use the previous sheet only to match white balance, photographic finish and the overall color family. Do not copy its bottles, packaging, props, background set, camera angle or panel arrangement unless explicitly requested for an individual asset. Follow each new panel brief.' : '',
      'Assign distinct visual jobs to the panels: atmosphere, hero, category identification, scene or detail. Vary camera distance, angle, subject grouping and negative space according to each brief. A coherent collection should contain visibly different photographs. Do not repeat the same product-on-pedestal scene across the sheet.',
      `Exactly ${batch.rows.flat().length} rectangular panels in ${batch.rows.length} horizontal rows, with row counts ${batch.rows.map(r => r.length).join(' / ')}. Approximate whole sheet width:height = 1:${total.toFixed(2)}. Keep all panels complete.`,
      ...batch.rows.map((row, i) => `Row ${i + 1}, about ${Math.round(rowWeights[i] / total * 100)}% of usable sheet height: ` + row.map((id, j) => { const a = lookup.get(id), d = a.direction; return `panel ${j + 1} (${id}): ${a.subject}; ${a.composition}; image aspect ${a.aspect}` + (d ? `; job: ${d.role}; camera: ${d.camera}; this panel's setting: ${d.background}; this panel's accents: ${d.accents}${d.treatment ? '; visual treatment: ' + d.treatment : ''}` : ''); }).join(' | ')),
      'Use uniform, solid MAGENTA #FF00FF for the outer margin and straight gaps between every panel (about 1-2% of width). Each photo must have its own opaque background. No gradient in separators; no magenta in photos; no object or shadow may cross a panel boundary.',
      'Keep focal content inside a generous safe area for ratio correction. For navigation photos keep the subject inside the central 65% for a circular crop. Signboard backgrounds leave the lower 35% uncluttered for fixed shop information. Intentional partial garment framing is allowed.',
      'Do not render text, panel labels, numbers, logos, watermarks, prices, navigation, buttons or other UI. Goods are illustrative examples, not a claim to reproduce an actual customer SKU.',
    ].filter(Boolean).join('\n\n');
    return { ...batch, panelCount: batch.rows.flat().length, referenceBatchId: index ? pending[index - 1].id : null, ...(usesGenerationReferences(visualProfile) ? { visualReferences: batchVisualReferences(plan, batch, visualProfile) } : {}), ...(usesReferenceBackground(visualProfile) ? { backgroundGuidance: visualProfile.visualSkill.backgroundGuidance } : {}), styleLock: lock, prompt };
  });
}
function productBatchPrompt(plan, batch, lookup, weights, total, index, visualProfile) {
  if (usesCampaignIdentity(visualProfile)) return [
    '生成一张可裁剪的珠宝店铺广告摄影素材总图。所有画面属于同一视觉企划，每格是完整照片；保持人物佩戴、环境静物、新款浏览的内容变化，不拼贴参考照片，不画网页。',
    campaignStyleLock(plan),
    index ? '本批延续同一全套摄影基准与全局约定。上一批成图用于对照实际调色、高光和颗粒，不照搬款式、镜头或布局；保留本批的明确变化。' : '',
    `严格 ${batch.rows.flat().length} 个矩形画面，${batch.rows.length} 行，各行画面数量为 ${batch.rows.map(r => r.length).join(' / ')}。总图宽高比约 1:${total.toFixed(2)}。`,
    ...batch.rows.map((row, i) => `第 ${i + 1} 行，占有效高度约 ${Math.round(weights[i] / total * 100)}%：\n` + row.map((id, j) => {
      const asset = lookup.get(id);
      const designs = asset.designIds.map(ref => plan.campaign.collection.find(item => item.id === ref));
      return `第 ${j + 1} 格（仅定位，不绘制编号），比例 ${asset.aspect}，${id === plan.artDirection.focalAssetId ? '整页主视觉' : '配合主视觉的' + asset.direction.role}：${asset.prompt}\n本格实际入画款式（由创作方案提供，编号不入画）：${designs.map(item => `${item.id} ${item.category}：${item.appearance}`).join('；')}。同一编号的轮廓、连接与配色保持一致，未列入本格的款式不增加。${asset.direction.role === 'category' ? '主体关键轮廓位于中央65%，适应圆形裁剪。' : ''}`;
    }).join('\n')),
    '每格独立构图，不是同一照片切片；相邻画面通过共享色彩、材质和光质连成店铺，不能只因款式不同就另换摄影风格。人物为原创成年人，饰品与人体接触自然。',
    '外边距、各行和各格之间使用纯洋红 #FF00FF 直线分隔带，宽约总图的 1–2%。分隔带内只填纯色，每格有自己的不透明背景，物体及阴影不跨格，画面内禁用分隔色。',
    '按各格比例构图并给饰品留安全边距。商品为示意设计，不绘制文字、编号、品牌、水印或界面，不增加未提供的真实材质与性能宣称。',
  ].filter(Boolean).join('\n\n');
  if (usesJewelryCampaign(visualProfile)) return [
    '生成一张可裁剪的珠宝广告摄影素材总图。每格是按自身描述构图的完整照片，人物佩戴、环境静物及商品浏览各有画面，不是同一场景的连续切片，也不是网页截图。',
    '每格的具体款式、人物、环境和明暗以该格提示为准。整套以色彩关系和摄影品质呼应，不把同一款式、台面或背景套给所有图片。',
    index ? '上一批总图仅辅助保持摄影品质与色彩联系；本批的新款、人物和场景按各格描述，不沿用上一批的商品清单或背景。' : '',
    `严格 ${batch.rows.flat().length} 个矩形画面，${batch.rows.length} 行，各行画面数量为 ${batch.rows.map(r => r.length).join(' / ')}。总图宽高比约 1:${total.toFixed(2)}。`,
    ...batch.rows.map((row, i) => `第 ${i + 1} 行，占有效高度约 ${Math.round(weights[i] / total * 100)}%：\n` + row.map((id, j) => {
      const a = lookup.get(id);
      return `第 ${j + 1} 格（仅供定位，不绘制编号），比例 ${a.aspect}：${a.prompt}${a.direction?.role === 'category' ? '主体关键轮廓位于中央65%，适应圆形裁剪。' : ''}`;
    }).join('\n')),
    '外边距、各行和各格之间使用纯洋红 #FF00FF 直线分隔带，宽约总图的 1–2%。每格有自己的不透明背景，物体及阴影不跨格。画面内禁止出现该分隔色。',
    '按各格比例构图，饰品关键轮廓留足安全边距。人物为原创成年人，佩戴接触与人体姿态自然。商品为示意设计，不绘制文字、编号、品牌标识、水印或界面。',
  ].filter(Boolean).join('\n\n');
  // Versioned profiles keep saved tasks on their original generation instructions.
  const focusedDigital = visualProfile?.id === 'digital' && visualProfile.version >= 2;
  const sharedMethod = usesProductVisualMethod(visualProfile);
  const general = sharedMethod && visualProfile.id === 'general';
  const referenceBackground = usesReferenceBackground(visualProfile);
  const plannedReference = visualProfile?.visualSkill?.backgroundGuidance === 'planned-reference-v1';
  if (sharedMethod || (visualProfile?.id === 'jewelry' && visualProfile.version >= 9) || focusedDigital) {
    return [
      general
        ? '生成一张可裁剪的装修素材总图。每格按自身描述独立构图、完整表达指定商品，不是同一个场景的连续切片，也不是网页截图。'
        : '生成一张可裁剪的静物摄影素材总图。每格是一张按自身描述独立构图的完整照片，不是同一个场景的连续切片，也不是网页截图。',
      // New profiles resolve shared art direction into each asset during design, without reimposing global backgrounds here.
      plannedReference
        ? '各格执行该格已定的商品、场景、构图和明暗安排，指定案例只辅助实现本格借鉴说明中的视觉关系。不要把一张案例的完整台面、明暗比例或布景复制到所有格子；整套以色彩呼应和表面质感协调，丰富场景与清楚浏览保持各自的视觉强度。'
        : referenceBackground
        ? '各格执行自身商品与构图描述，并保留指定案例及借鉴说明中的背景明暗面积、过渡、表面与阴影/倒影关系。全套以商品表面表现、色彩呼应和摄影品质协调，不要求每格同一底色、明暗比例、台面或光位。商品本色不随背景换色。'
        : `全套共享视觉语言：${plan.artDirection.anchors.join('；')}。协调色板：${plan.style.palette.join('、')}，不必每格用尽，不据此改变商品本色。各格的场景、承托、背景材质、光位和构图分别按该格描述实现。`,
      index ? (plannedReference
        ? '上一批总图只辅助保持商品表面表现及色彩联系，不改变本批各格已定的场景、构图、主体尺度或明暗节奏。'
        : referenceBackground
        ? '上一批总图只辅助保持商品本色与表面表现；本批背景明暗面积、过渡、纹理及光影关系以各格指定案例和借鉴说明为准，不被上一批背景、色温或反差覆盖。'
        : '所附上一批总图仅参考色彩关系、白平衡、反差与表面质感；本批商品、布景、机位和构图以各格描述为准，不照搬参考图的背景或格子排布。') : '',
      focusedDigital ? '保留各格描述的商品主要轮廓、比例、颜色和可见部件位置，同款外观保持一致；不添加未描述的部件、内部结构或性能效果。屏幕只用抽象色彩或反射，不画系统界面或参数。' : '',
      sharedMethod ? visualProfile.imageRules || '' : '',
      `严格 ${batch.rows.flat().length} 个矩形画面，${batch.rows.length} 行，各行画面数量为 ${batch.rows.map(r => r.length).join(' / ')}。总图宽高比约 1:${total.toFixed(2)}。`,
      ...batch.rows.map((row, i) => `第 ${i + 1} 行，占有效高度约 ${Math.round(weights[i] / total * 100)}%：\n` + row.map((id, j) => {
        const a = lookup.get(id);
        const role = a.direction?.role;
        const safeArea = role === 'category' ? '主体关键轮廓位于中央65%，适应圆形展示。' : role === 'atmosphere' ? '下部35%保持简洁留白，供店铺信息展示。' : '';
        return `第 ${j + 1} 格（仅供定位，不绘制编号），比例 ${a.aspect}：${a.prompt}${safeArea ? '\n' + safeArea : ''}`;
      }).join('\n')),
      '外边距、各行和各格之间使用纯洋红 #FF00FF 直线分隔带，宽约总图的 1–2%。每格有自己的不透明背景，物体及阴影不跨格。画面内禁止出现该分隔色。',
      general
        ? '按各格比例完成构图，主体保留适应比例修正的安全边距。商品是既定经营方向内的示意设计，无须复刻原SKU。不绘制文字、编号、标识、水印或界面元素。'
        : '按各格比例完成构图，主体保留适应比例修正的安全边距。商品是既定经营方向内的示意设计，无须复刻原SKU。不绘制人物、文字、编号、标识、水印或界面元素。',
    ].filter(Boolean).join('\n\n');
  }
  const jewelryPlanning = visualProfile?.id === 'jewelry' && visualProfile.version >= 2;
  const sharedVisualDirection = visualProfile?.id === 'jewelry' && visualProfile.version >= 6;
  const jewelryJobs = {
    hero: '主视觉：以一个主要焦点和清楚的形状关系吸引注意，配角让位于主体',
    scene: '主题或整体展示：交代商品造型与本图的新信息，构图与主视觉形成变化',
    product: '商品展示：主要轮廓完整、比例清楚，表面反射有层次',
    detail: '细节展示：突出一个有依据的可见特点，交代局部与商品的关系',
    category: '品类识别：主体清楚，关键轮廓位于中央65%圆形裁切安全区',
    atmosphere: '店招氛围背景：安静衬托主题，下部35%保持简洁留白，不强行加入商品',
  };
  return [
    '生成一张可裁剪的装修素材总图。每格是一张独立完整图片，不是网页截图。商品为已确认品类的相似或同类型示意商品，无须复刻上传的具体 SKU。不得加入品牌标识、价格、功效、认证、文字或界面元素。',
    `整套视觉方向：${plan.artDirection.concept}。主次：${plan.artDirection.narrative}。贯穿要素：${plan.artDirection.anchors.join('；')}。`,
    `共享配色：${plan.style.palette.join('、')}；环境：${plan.style.background}；光线：${plan.style.lighting}；表现：${plan.style.photography}。配色作为协调依据，不要求每张用尽所有颜色。`,
    sharedVisualDirection
      ? '各格共用上述色彩分工、主光方向与软硬、白平衡、背景材质关系和摄影反差；逐格描述细化构图，不另换光线体系。逐格文字与这些共用要求不一致时，保留该格主体与构图，光线及色彩服从共用要求。机位、主体尺度、单件或组合关系、留白位置可按用途变化，同色系背景允许局部深浅变化；不要求同一商品、支架或布景反复出现。主视觉形成主要焦点，辅助图提供不同信息。'
      : jewelryPlanning ? '按每格用途和具体提示词分别设计画面。共享的是主题、色彩关系和材质表现，各格明确指定的背景明暗、机位、主体占比与光位优先于共享描述；不把整张总图做成同一块布景的重复近景。主视觉建立重点，其他画面提供整体或细节信息，氛围背景保持舒缓。' : '',
    index ? (sharedVisualDirection
      ? '所附上一批总图仅用于延续本次约定的色彩分工、白平衡、光线软硬和材质质感，不覆盖上述文字约定。按本批任务创作商品与构图，不复制上一批的支架、机位或格子排布；无需复刻上传商品，也不要求重复上一批款式。'
      : '所附上一批总图仅用于保持视觉方向与色彩关系。不要复制上一批的商品、背景、机位或格子排布。') : '',
    `严格 ${batch.rows.flat().length} 个矩形画面，${batch.rows.length} 行，各行画面数量为 ${batch.rows.map(r => r.length).join(' / ')}。总图宽高比约 1:${total.toFixed(2)}。`,
    ...batch.rows.map((row, i) => `第 ${i + 1} 行，占有效高度约 ${Math.round(weights[i] / total * 100)}%：\n` + row.map((id, j) => {
      const a = lookup.get(id);
      const job = jewelryPlanning ? jewelryJobs[a.direction?.role] : '';
      return `第 ${j + 1} 格（仅供定位，不绘制编号），比例 ${a.aspect}：${job ? '画面用途（不绘制这些说明）：' + job + '。具体画面：' : ''}${a.prompt}`;
    }).join('\n')),
    '外边距、各行和各格之间使用纯洋红 #FF00FF 直线分隔带，宽约总图的 1–2%。每格有自己的不透明背景，物体及阴影不跨格。画面内禁止出现该分隔色。',
    '主体保留适应比例修正的安全边距。导航图片主体集中在中央 65%，适应圆形裁剪。只生成图片内容，标题和导航文字由程序排版。',
    visualProfile ? (visualProfile.id === 'footwear' ? '本任务的鞋履静物视觉要求' : visualProfile.id === 'digital' ? '本任务的数码产品视觉要求' : '本任务的珠宝摄影要求') + '（仅约束画面，不改变分格、分隔带、素材数量及裁切规格；商品表现与以下要求不一致时遵循这些要求）：\n' + visualProfile.rules.join('\n') : '',
  ].filter(Boolean).join('\n\n');
}
module.exports = { planSchema, validatePlan, buildBatches, aspectRatios };

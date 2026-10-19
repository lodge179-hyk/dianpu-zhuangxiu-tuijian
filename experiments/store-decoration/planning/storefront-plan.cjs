const { createHash } = require('crypto');
const { entries } = require('./catalog.cjs');
const { storefrontContentSchema, chapterSchema } = require('./storefront-contract.cjs');
const { campaignVisualSchema, campaignBackdropSchema } = require('./campaign-contract.cjs');
const { validatePlan, aspectRatios } = require('./plan.cjs');
const { contentBatches, evidenceFor } = require('./content-plan.cjs');
const { artworkGeometry, artworkBrief } = require('./slot-artwork.cjs');

function compileStorefront(brief, value, recognition, profile) {
  const parsed = storefrontContentSchema(campaignVisualSchema, campaignBackdropSchema).safeParse(value);
  if (!parsed.success) throw Error('装修叙事方案不完整：' + parsed.error.issues.slice(0, 4).map(i => i.path.join('.')).join('、') + '。已保存响应，可从本阶段继续。');
  const content = parsed.data, evidence = new Map(evidenceFor(recognition, profile).map(item => [item.id, item]));
  const designs = new Map(), categories = new Set(), assets = [], modules = [], tasks = [], decisions = [];
  for (const item of content.collection) {
    if (designs.has(item.id) || !recognition.categories.includes(item.category)) throw Error('款式编号重复或引用未确认品类，已保留方案。');
    designs.set(item.id, item);
  }
  const checkReference = ref => {
    if (!profile.visualSkill.referenceIds.includes(ref.id)) throw Error('方案引用了本任务之外的摄影案例，未自行替换。');
  };
  checkReference(content.reference);
  content.modules.forEach((item, index) => {
    const entry = entries[item.type], moduleId = `chapter-${index + 1}`, count = item.visuals.length;
    if (count < entry.min || count > entry.max || (item.type === 'showcase.three' && count % 3)) throw Error(`第${index + 1}模块的图片数不符合 ${item.type} 真实规格，已保留方案。`);
    if (['showcase', 'navigation'].includes(entry.family) && item.visuals.some(v => !v.caption)) throw Error('橱窗或导航缺少原生名称，已保留方案。');
    const ids = item.visuals.map((visual, slotIndex) => {
      checkReference(visual.visualPlan.visualReference);
      // Resolve only explicit collection references for this image. Never swap
      // ID prefixes or infer a category from the subject/picture text.
      if (visual.evidenceIds.some(id => id.startsWith('design-'))) {
        visual.evidenceIds = [...new Set(visual.evidenceIds.map(id => {
          if (!id.startsWith('design-')) return id;
          const design = designs.get(id);
          if (!design || !visual.visualPlan.designIds.includes(id)) throw Error('品类资料引用中的款式 ' + id + ' 未定义或不属于本图，已保留方案。');
          const matches = [...evidence.values()].filter(e => e.category === design.category);
          if (matches.length !== 1) throw Error('款式 ' + id + ' 无法唯一对应经营资料，未猜测或替换品类。');
          return matches[0].id;
        }))];
      }
      if (entry.family === 'signboard' && !!visual.evidenceIds.length !== !!visual.visualPlan.designIds.length) throw Error('招牌若不展示商品，两组商品引用均应为空；展示商品时均须填写。已保留方案。');
      for (const id of visual.evidenceIds) {
        if (!evidence.has(id)) throw Error('方案引用未知经营资料 ' + id + '，已保留响应。');
        categories.add(evidence.get(id).category);
      }
      for (const id of visual.visualPlan.designIds) if (!designs.has(id)) throw Error('画面引用未定义款式 ' + id + '，已保留方案。');
      const slot = entry.slots[slotIndex];
      // Choose the existing generation ratio nearest to the actual slot, never a new layout.
      const aspect = Object.keys(aspectRatios).reduce((best, ratio) => Math.abs(Math.log(aspectRatios[ratio] / slot.aspect)) < Math.abs(Math.log(aspectRatios[best] / slot.aspect)) ? ratio : best);
      const signboard = entry.family === 'signboard';
      const id = signboard ? 'identity-bg' : assets.some(a => a.id === 'overview') ? `story-${assets.length + 1}` : 'overview';
      const role = signboard ? 'atmosphere' : entry.family === 'navigation' ? 'category' : entry.family === 'showcase' ? 'product' : id === 'overview' ? 'hero' : visual.visualPlan.camera === 'macro' ? 'detail' : 'scene';
      const hasCopy = !!(visual.copy.heading || visual.copy.body);
      if (entry.family === 'navigation' && hasCopy) throw Error('圆形导航图不能承载设计文案，请使用原生导航名称。已保留方案。');
      if (signboard && hasCopy && visual.copy.placement !== 'top') throw Error('招牌下部是固定店铺信息区，设计文案需放在顶部，已保留方案。');
      const alternate = visual.copy.tone === 'alternate', theme = content.pageDesign;
      const artwork = hasCopy ? { ...visual.copy, width: slot.width, height: slot.height,
        background: alternate ? theme.alternateBackground : theme.background,
        foreground: alternate ? theme.alternateForeground : theme.foreground, typography: theme.typography } : null;
      if (artwork) artworkGeometry(artwork); // Catch impossible copy before any image call.
      const layoutBrief = `章节：${item.chapter}。本模块讲清：${item.message}。衔接：${item.transition || '开场'}。真实组件${item.type}第${slotIndex + 1}槽，显示${slot.width}×${slot.height}。模块外固定白色，不依赖全页染色。${artwork ? artworkBrief(artwork) : '本图无设计文字，按内容构图。'}${signboard ? '本图是招牌背景，下方36%保留平静空间给平台头像、店名和数据；重要主体放上部，不绘制这些原生控件。' : ''}${role === 'category' ? '主体置于中央65%，适应圆形裁剪。' : ''}`;
      assets.push({ id, aspect, subject: visual.subject, composition: visual.visualPlan.picture.slice(0, 300),
        visualReference: visual.visualPlan.visualReference, layoutBrief, ...(artwork ? { artwork } : {}),
        direction: { role, camera: visual.visualPlan.camera, treatment: visual.visualPlan.treatment, background: brief.style.background.slice(0, 180), accents: brief.style.palette.join('、') } });
      tasks.push({ id, aspect, role, subject: visual.subject, intent: { purpose: item.message, reason: item.transition },
        display: { component: item.type, width: slot.width, height: slot.height }, safeArea: layoutBrief,
        visualPlan: visual.visualPlan, evidence: visual.evidenceIds.map(id => evidence.get(id)) });
      return id;
    });
    const narrative = chapterSchema.parse({ chapter: item.chapter, message: item.message, transition: item.transition });
    modules.push({ id: moduleId, type: item.type, purpose: item.message, narrative,
      props: { assetIds: ids, text: '', labels: entry.family === 'navigation' ? item.visuals.map(v => v.caption) : [], titles: entry.family === 'showcase' ? item.visuals.map(v => v.caption) : [] } });
    decisions.push({ moduleId, why: item.transition || item.message, remove: '模型按叙事决定模块，程序不自动合并或改选组件。' });
  });
  if (!assets.length) throw Error('整页须有1至12张素材，尚未生图。');
  const missing = recognition.categories.filter(category => !categories.has(category));
  if (missing.length) throw Error('整页叙事尚未覆盖经营品类：' + missing.join('、') + '。已保存响应。');
  if (assets.length > 12) {
    const error = Error(`整页实际安排${assets.length}张素材，须为1至12张（各模块：${content.modules.map(m => `${m.type}=${m.visuals.length}`).join('、')}）。请调整组件或图数，保留招牌与品类覆盖；尚未生图。`);
    // This is review input only, never a generation-ready plan. A complete
    // over-budget draft can reach the existing review; the final stays strict.
    error.code = 'STOREFRONT_IMAGE_BUDGET';
    error.reviewDraft = {
      content,
      pageOrder: modules.map(m => ({ type: m.type, purpose: m.purpose, assetIds: m.props.assetIds, narrative: m.narrative })),
      currentSlots: tasks.map(t => ({ id: t.id, aspect: t.aspect, display: t.display, safeArea: t.safeArea, designIds: t.visualPlan.designIds })),
      requiredChanges: {
        code: error.code, actualImages: assets.length, maxImages: 12, reduceByAtLeast: assets.length - 12,
        moduleCounts: modules.map(m => ({ type: m.type, chapter: m.narrative.chapter, images: m.props.assetIds.length })),
        instruction: '先调整模块组合与各模块图数，使实际图片总数不超过12，再返回完整终稿。由你决定删减或改选哪些组件，保留必备招牌、品类覆盖、核心叙事和视觉亮点；不是只改报出的总数或换句话重复原结构。',
      },
    };
    throw error;
  }
  const plan = { version: 1, delivery: 'platform-slots-v1', shop: brief.shop, style: brief.style,
    pageDesign: content.pageDesign, summary: content.narrative.slice(0, 300),
    artDirection: { concept: brief.theme, narrative: content.narrative, anchors: ['共同摄影基准、图片内统一图文语言与白色平台背景'], focalAssetId: 'overview' },
    modules, assets, batches: contentBatches(assets) };
  const validated = validatePlan(plan);
  return { ...validated, tasks, content, signature: createHash('sha256').update(JSON.stringify({ plan: validated.plan, content })).digest('hex'),
    recommendation: { version: 4, method: 'ai-narrative-platform-slots', name: '可上传的章节叙事装修', reason: content.reason,
      lengthReason: `${validated.plan.modules.length}个原生模块（含必备招牌），${assets.length}张独立成品图片。`, tradeoff: '招牌必备且首位，模型选择非全屏招牌样式和正文叙事；程序按真实槽位合字、裁剪和组装。', decisions, brief } };
}
module.exports = { compileStorefront };

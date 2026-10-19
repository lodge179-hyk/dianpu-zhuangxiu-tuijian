const { createHash } = require('crypto');
const { entries } = require('./catalog.cjs');
const { storefrontContentSchema, chapterSchema } = require('./storefront-contract.cjs');
const { campaignVisualSchema } = require('./campaign-contract.cjs');
const { validatePlan, aspectRatios } = require('./plan.cjs');
const { contentBatches, evidenceFor } = require('./content-plan.cjs');
const { artworkGeometry, artworkBrief } = require('./slot-artwork.cjs');

function compileStorefront(brief, value, recognition, profile) {
  const parsed = storefrontContentSchema(campaignVisualSchema).safeParse(value);
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
      for (const id of visual.evidenceIds) {
        if (!evidence.has(id)) throw Error('方案引用未知经营资料 ' + id + '，已保留响应。');
        categories.add(evidence.get(id).category);
      }
      for (const id of visual.visualPlan.designIds) if (!designs.has(id)) throw Error('画面引用未定义款式 ' + id + '，已保留方案。');
      const slot = entry.slots[slotIndex];
      // Choose the existing generation ratio nearest to the actual slot, never a new layout.
      const aspect = Object.keys(aspectRatios).reduce((best, ratio) => Math.abs(Math.log(aspectRatios[ratio] / slot.aspect)) < Math.abs(Math.log(aspectRatios[best] / slot.aspect)) ? ratio : best);
      const id = assets.length ? `story-${assets.length + 1}` : 'overview';
      const role = entry.family === 'navigation' ? 'category' : entry.family === 'showcase' ? 'product' : id === 'overview' ? 'hero' : visual.visualPlan.camera === 'macro' ? 'detail' : 'scene';
      const hasCopy = !!(visual.copy.heading || visual.copy.body);
      if (entry.family === 'navigation' && hasCopy) throw Error('圆形导航图不能承载设计文案，请使用原生导航名称。已保留方案。');
      const alternate = visual.copy.tone === 'alternate', theme = content.pageDesign;
      const artwork = hasCopy ? { ...visual.copy, width: slot.width, height: slot.height,
        background: alternate ? theme.alternateBackground : theme.background,
        foreground: alternate ? theme.alternateForeground : theme.foreground, typography: theme.typography } : null;
      if (artwork) artworkGeometry(artwork); // Catch impossible copy before any image call.
      const layoutBrief = `章节：${item.chapter}。本模块讲清：${item.message}。衔接：${item.transition || '开场'}。真实组件${item.type}第${slotIndex + 1}槽，显示${slot.width}×${slot.height}。模块外固定白色，不依赖全页染色。${artwork ? artworkBrief(artwork) : '本图无设计文字，按内容构图。'}${role === 'category' ? '主体置于中央65%，适应圆形裁剪。' : ''}`;
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
  if (!assets.length || assets.length > 12) throw Error('整页须有1至12张素材，尚未生图。');
  const missing = recognition.categories.filter(category => !categories.has(category));
  if (missing.length) throw Error('整页叙事尚未覆盖经营品类：' + missing.join('、') + '。已保存响应。');
  const plan = { version: 1, delivery: 'platform-slots-v1', shop: brief.shop, style: brief.style,
    pageDesign: content.pageDesign, summary: content.narrative.slice(0, 300),
    artDirection: { concept: brief.theme, narrative: content.narrative, anchors: ['共同摄影基准、图片内统一图文语言与白色平台背景'], focalAssetId: 'overview' },
    modules, assets, batches: contentBatches(assets) };
  return { ...validatePlan(plan), tasks, content, signature: createHash('sha256').update(JSON.stringify({ plan, content })).digest('hex'),
    recommendation: { version: 4, method: 'ai-narrative-platform-slots', name: '可上传的章节叙事装修', reason: content.reason,
      lengthReason: `${modules.length}个原生模块，${assets.length}张独立成品图片。`, tradeoff: '模型决定章节与组件；程序按真实槽位合字、裁剪和组装。', decisions, brief } };
}
module.exports = { compileStorefront };

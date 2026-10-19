const { createHash } = require('crypto');
const { narrativeContentSchema, storySchema } = require('./narrative-contract.cjs');
const { campaignVisualSchema } = require('./campaign-contract.cjs');
const { validatePlan } = require('./plan.cjs');
const { contentBatches, evidenceFor } = require('./content-plan.cjs');
const { frameTypes, moduleGeometry } = require('./narrative-layout.cjs');

function compileNarrative(brief, value, recognition, profile) {
  const result = narrativeContentSchema(campaignVisualSchema).safeParse(value);
  if (!result.success) throw Error('整页叙事方案不完整：' + result.error.issues.slice(0, 4).map(i => i.path.join('.')).join('、') + '。已保存响应，可从本阶段继续。');
  const content = result.data, evidence = new Map(evidenceFor(recognition, profile).map(item => [item.id, item]));
  const designs = new Map(), categories = new Set(), assets = [], modules = [], tasks = [], decisions = [];
  for (const item of content.collection) {
    if (designs.has(item.id) || !recognition.categories.includes(item.category)) throw Error('款式编号重复或引用未确认的品类，已保留方案。');
    designs.set(item.id, item);
  }
  const checkReference = ref => {
    if (!profile.visualSkill.referenceIds.includes(ref.id)) throw Error('叙事方案引用了本任务之外的摄影案例，未自行替换。');
  };
  checkReference(content.reference);
  content.modules.forEach((item, index) => {
    const count = item.visuals.length, moduleId = `chapter-${index + 1}`;
    const required = { poster: [1, 1], editorial: [1, 1], pair: [2, 2], collection: [1, 3], statement: [0, 0] }[item.layout];
    if (count < required[0] || count > required[1]) throw Error(`第${index + 1}模块的 ${item.layout} 图片数不符合布局，已保留方案。`);
    if (item.layout === 'statement' && !item.heading && !item.body) throw Error('文字过渡模块没有内容，已保留方案。');
    if (item.layout !== 'poster' && item.textPlacement.startsWith('on-image')) throw Error('图上排字只适用于海报，已保留方案。');
    if (item.layout === 'collection' && item.visuals.some(v => !v.caption)) throw Error('商品橱窗缺少款式名称，已保留方案。');
    const frame = frameTypes[item.format];
    const type = ['poster', 'editorial'].includes(item.layout) ? frame[0]
      : item.layout === 'pair' ? 'poster.two' : item.layout === 'statement' ? 'text.single'
      : `showcase.${['', 'single', 'two', 'three'][count]}`;
    const aspect = ['poster', 'editorial'].includes(item.layout) ? frame[1] : '1:1';
    const ids = item.visuals.map(visual => {
      checkReference(visual.visualPlan.visualReference);
      for (const id of visual.evidenceIds) {
        if (!evidence.has(id)) throw Error('叙事方案引用未知经营资料 ' + id + '，已保留响应。');
        categories.add(evidence.get(id).category);
      }
      for (const id of visual.visualPlan.designIds) if (!designs.has(id)) throw Error('画面引用未定义款式 ' + id + '，已保留方案。');
      const id = assets.length ? `story-${assets.length + 1}` : 'overview';
      const role = id === 'overview' ? 'hero' : item.layout === 'collection' ? 'product' : visual.visualPlan.camera === 'macro' ? 'detail' : 'scene';
      const layoutBrief = `章节：${item.chapter}。本模块让用户理解：${item.message}。衔接：${item.transition || '开场'}。${item.heading || item.body ? `页面后期排字：${item.heading} ${item.body}（均不要在图片内绘制）。` : ''}${item.layout === 'poster' && item.textPlacement.startsWith('on-image') ? `图中文字由程序放在${item.textPlacement === 'on-image-left' ? '左' : '右'}侧约42%区域；该侧保留有层次的平静空间，主体放另一侧，不生成字。` : '图像清楚落实本段观点，文字在图外排版。'}`;
      assets.push({ id, aspect, subject: visual.subject, composition: visual.visualPlan.picture.slice(0, 300), visualReference: visual.visualPlan.visualReference,
        layoutBrief, direction: { role, camera: visual.visualPlan.camera, treatment: visual.visualPlan.treatment, background: brief.style.background.slice(0, 180), accents: brief.style.palette.join('、') } });
      tasks.push({ id, aspect, role, subject: visual.subject, intent: { purpose: item.message, reason: item.transition }, safeArea: layoutBrief,
        visualPlan: visual.visualPlan, evidence: visual.evidenceIds.map(id => evidence.get(id)) });
      return id;
    });
    const { format, visuals, ...storyInput } = item;
    const story = storySchema.parse(storyInput);
    modules.push({ id: moduleId, type, purpose: item.message, story, props: { assetIds: ids,
      text: item.layout === 'statement' ? [item.heading, item.body].filter(Boolean).join('\n') : '', labels: [],
      titles: item.layout === 'collection' ? item.visuals.map(v => v.caption) : [] } });
    decisions.push({ moduleId, why: item.transition || item.message, remove: '由AI依据章节作用决定保留，不由程序按图数自动合并。' });
  });
  if (!assets.length || assets.length > 12) throw Error('整页须有1至12张独立素材，尚未生图。');
  const missing = recognition.categories.filter(category => !categories.has(category));
  if (missing.length) throw Error('整页叙事尚未覆盖经营品类：' + missing.join('、') + '。已保存响应。');
  const lookup = new Map(assets.map(asset => [asset.id, asset]));
  for (const module of modules) {
    const geometry = moduleGeometry(module, lookup);
    for (const image of geometry.images) {
      const asset = lookup.get(image.assetId), task = tasks.find(task => task.id === image.assetId);
      task.display = { component: module.story.layout, width: image.rect[2], height: image.rect[3] };
      const theme = content.pageDesign, background = module.story.tone === 'base' ? theme.background : theme.alternateBackground;
      asset.layoutBrief += ` 本模块排版区域的背景色为${background}，照片边缘和环境与之协调，不强制把商品本色改成背景色。`;
      if (module.story.textPlacement.startsWith('on-image') && !geometry.overlay) {
        // Fit correction only: preserve all copy rather than clipping a narrow banner.
        asset.layoutBrief = asset.layoutBrief.replace(/图中文字由程序放在[^。]+。/, '文字长度超出本图安全区，将在图下完整排版，图片无需为文字留出半幅空白。');
        module.story.textPlacement = 'below';
      }
      task.safeArea = asset.layoutBrief;
    }
  }
  const plan = { version: 1, shop: brief.shop, style: brief.style, pageDesign: content.pageDesign, summary: content.narrative.slice(0, 300),
    artDirection: { concept: brief.theme, narrative: content.narrative, anchors: ['共享摄影基准与图文设计'], focalAssetId: 'overview' },
    modules, assets, batches: contentBatches(assets) };
  return { ...validatePlan(plan), tasks, content, signature: createHash('sha256').update(JSON.stringify({ plan, content })).digest('hex'),
    recommendation: { version: 3, method: 'ai-narrative-program-render', name: '按章节叙事组织店铺', reason: content.reason,
      lengthReason: `${modules.length}个由模型安排的模块，${assets.length}张素材。`, tradeoff: '模型决定内容、模块与顺序；程序负责安全排版及裁剪。', decisions, brief } };
}
module.exports = { compileNarrative };

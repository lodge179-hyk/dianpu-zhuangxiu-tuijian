const { z } = require('zod');
const { planSchema, validatePlan, aspectRatios } = require('./plan.cjs');

const briefSchema = z.object({
  version: z.literal(1), shop: planSchema.shape.shop,
  categories: z.array(z.string().trim().min(1).max(20)).min(1).max(5),
  theme: z.string().trim().min(1).max(100),
  style: planSchema.shape.style,
  navigationStyle: z.enum(['auto', 'clean', 'warm']).default('auto'),
  featuredCategory: z.object({ name: z.string().trim().min(1).max(20), evidence: z.string().trim().min(1).max(120) }).strict().nullable().default(null),
}).strict();
const sources = [
  { id: 'muji', name: 'MUJI', url: 'https://www.muji.us/', observed: '2026-10-14', finding: '首页同时使用生活场景与明确分类，分别服务兴趣和查找。', boundary: '只迁移任务分工，不复制六分类布局或商品素材。' },
  { id: 'glossier', name: 'Glossier', url: 'https://www.glossier.com/', observed: '2026-10-14', finding: '主视觉、商品比较、主题和分类入口形成不同内容组。', boundary: '没有转化数据；角色变化是设计参考，不是效果保证。' },
  { id: 'ilia', name: 'ILIA', url: 'https://iliabeauty.com/', observed: '2026-10-14', finding: '主题照片、分类与细节表达相互衔接。', boundary: '选购工具、评价和品牌承诺需要真实资料，本轮不迁移。' },
];
const recipes = [
  { id: 'category-first', name: '先看品类', aim: '先找经营范围，再看组合氛围', suitable: '品类明确、主推内容尚不确定的店铺', tradeoff: '分类更早出现，主题的第一印象较弱。', evidence: ['muji', 'glossier'] },
  { id: 'theme-first', name: '先看主题', aim: '先建立整体印象，再进入品类与细节', suitable: '愿意尝试一个明确视觉主题的店铺', tradeoff: '主视觉占据首屏，品类入口更靠后；组合海报会强调部分内容。', evidence: ['glossier', 'ilia'] },
];
const defaultStyle = { palette: ['#EEE8DF', '#A56352', '#3D3632'], background: '浅色空间、干净背景与局部细节，可变化场景，不复制同一台面', lighting: '柔和自然光，保持中性白平衡', photography: '清楚真实的品类示意摄影，保留形态差异，不模拟同一品牌' };

function validateBrief(input) {
  const result = briefSchema.safeParse(input);
  if (!result.success) throw Error('店铺资料不完整：' + result.error.issues.slice(0, 4).map(i => `${i.path.join('.')} ${i.message}`).join('；'));
  const brief = result.data;
  const labels = brief.categories.map(c => c.normalize('NFKC').toLowerCase().replace(/\s/g, ''));
  if (new Set(labels).size !== labels.length) throw Error('品类不能重复，请保留 1 至 5 个明确品类');
  if (brief.featuredCategory && !brief.categories.includes(brief.featuredCategory.name)) throw Error('主推品类必须属于已确认的经营品类');
  return brief;
}
function briefFromPlan(plan) {
  const labels = plan.modules.filter(m => m.type.startsWith('navigation.')).flatMap(m => m.props.labels);
  return validateBrief({ version: 1, shop: plan.shop, categories: [...new Set(labels.length ? labels : plan.shop.category.split(/[、,，/]/).map(s => s.trim()).filter(Boolean))], theme: (plan.artDirection?.concept || '一起看看 ' + plan.shop.category).slice(0, 100), style: plan.style, navigationStyle: plan.navigationLibrary?.style || 'auto' });
}
function manualBrief({ name, categories, theme }) {
  const list = typeof categories === 'string' ? categories.split(/[、,，\n]/).map(s => s.trim()).filter(Boolean) : categories;
  return validateBrief({ version: 1, shop: { name, category: Array.isArray(list) ? list.join('、') : '', observations: ['用户填写的店名和品类，未进行截图识别'], uncertainties: ['主题为视觉提案，未知价格、销量和真实 SKU'] }, categories: list, theme: theme || '日常好物的不同面貌', style: defaultStyle, navigationStyle: 'auto' });
}
function exampleBrief(id) {
  if (id === 'beauty') return validateBrief({ version: 1, shop: { name: '可达鸭', category: '护肤、底妆、彩妆、香氛', observations: ['沿用已确认的示例店名和四个经营品类'], uncertainties: ['素材为品类示意，不代表真实 SKU；主题不是已知品牌定位'] }, categories: ['护肤', '底妆', '彩妆', '香氛'], theme: '出门前的梳妆时刻', style: defaultStyle, navigationStyle: 'auto' });
  if (id === 'apparel') return validateBrief({ version: 1, shop: { name: '日常衣橱 · 服装示例', category: '上衣、衬衫、裤装、连衣裙', observations: ['预设服装资料，用于检验组合规则能否迁移'], uncertainties: ['不代表实际商家；场景和细节素材尚待生成'] }, categories: ['上衣', '衬衫', '裤装', '连衣裙'], theme: '日常衣橱的层次与搭配', style: { ...defaultStyle, palette: ['#F2F4F6', '#353E48', '#B7C5D3'], background: '冷白背景、自然室内与面料局部，场景可以变化' }, navigationStyle: 'clean' });
  throw Error('示例不存在');
}

// These are photography proposals about recognizable categories, not product facts.
function sceneFor(category, index) {
  if (/护肤|护理/.test(category)) return ['使用护理用品的手部动作，保留商品轮廓', 'eye-level', 'human-use'];
  if (/底妆|粉底/.test(category)) return ['底妆用品与少量质地的俯拍组合，不承诺色号或效果', 'top-down', 'still-life'];
  if (/彩妆|眼影|唇/.test(category)) return ['局部上妆动作与彩妆用品，不做功效前后对比', 'eye-level', 'human-use'];
  if (/香氛|香水/.test(category)) return ['手腕与香水的使用动作，保留呼吸空间', 'eye-level', 'human-use'];
  if (/上衣|衬衫|衬衣|裤|裙|服装|针织/.test(category)) return [index % 2 ? '服装的俯拍搭配，展示轮廓与层次' : '日常穿着局部，展示衣服的形态，不宣称面料成分', index % 2 ? 'top-down' : 'eye-level', index % 2 ? 'still-life' : 'human-use'];
  return ['品类示意物件与使用环境的构图，不推断功能、材质或认证', index % 2 ? 'top-down' : 'eye-level', 'still-life'];
}
function tasksFor(brief, density, creative = false) {
  const tasks = [], nav = brief.categories.length >= 4;
  const add = (id, aspect, subject, composition, role, camera, treatment, background) => tasks.push({ id, aspect, subject: subject.slice(0, 180), composition, direction: { role, camera, treatment, background: background.slice(0, 180), accents: '使用共享色板中的少量颜色；保留品类自身形态，不统一包装' } });
  if (nav) brief.categories.forEach((c, i) => add(`nav-${i + 1}`, '1:1', `${c}的清楚品类示意，无品牌`, '单个或少量代表物居中，主体在中央65%，适应小尺寸圆形裁剪', 'category', 'eye-level', 'still-life', '干净浅色背景；同组导航保持一致'));
  add('overview', density === 'compact' ? '3:1' : '4:3', `${brief.theme}；围绕${brief.categories.join('、')}组织一个整体画面`, '建立一个视觉重点，前后景有层次；不做多格拼贴，不烘焙标题', 'hero', 'wide', 'environment', brief.style.background);
  brief.categories.forEach((c, i) => {
    const [description, camera, treatment] = creative ? ['根据已识别商品和联网风格设计具体画面', 'eye-level', 'still-life'] : sceneFor(c, i);
    add(`scene-${i + 1}`, '1:1', `${c}：${description}`, '本图只表达一个品类，主体与必要环境各有空间；适应方形画面', 'scene', camera, treatment, i % 2 ? '清楚简洁的局部背景，与整页保持白平衡联系' : '与主题相符的使用环境；不要求与其他图采用同一台面');
  });
  if (density === 'balanced') add('detail', '1:1', `${brief.categories[0]}的可见表面、形态或质地局部；不据此宣称真实商品材料或功效`, '近距离表达与场景图不同的信息，不再完整重复陈列同一商品', 'detail', 'macro', /护肤|底妆|彩妆|上衣|衬衫|裤|裙/.test(brief.categories[0]) ? 'texture' : 'still-life', '去掉场景道具，以局部明暗和质感建立联系');
  return tasks;
}
function decideStructure(brief) {
  const featured = brief.featuredCategory;
  const recipeId = featured || brief.categories.length <= 3 ? 'theme-first' : 'category-first';
  const density = featured || brief.categories.length >= 4 ? 'balanced' : 'compact';
  const reason = featured
    ? `资料明确主推 ${featured.name}，先呈现主题，再围绕该品类安排场景和局部。依据：${featured.evidence}`
    : brief.categories.length >= 4
      ? `已确认 ${brief.categories.length} 个品类，但没有可靠主推信息；先说明经营范围，再展示场景与整体联系。视觉主题提案不被当作主推证据。`
      : `已确认 ${brief.categories.length} 个品类，经营范围较集中；先用一个整体画面建立印象，再逐类展示，不为凑四列导航增加品类。`;
  return { recipeId, density, reason, lengthReason: density === 'compact' ? '品类较少且无主推细节依据，采用短横幅并省去独立细节图。' : '品类较多或有明确主推，保留主视觉和一张局部图；仍不补齐无用途模块。' };
}
function recommendPlan(input, options = {}) {
  const brief = validateBrief(input), choice = decideStructure(brief), { density } = choice;
  if (brief.featuredCategory) brief.categories = [brief.featuredCategory.name, ...brief.categories.filter(c => c !== brief.featuredCategory.name)];
  const recipe = recipes.find(r => r.id === choice.recipeId);
    const modules = [], decisions = [];
    function add(id, type, purpose, ids, why, remove, text = '', labels = []) {
      modules.push({ id, type, purpose, props: { assetIds: ids, text, labels, titles: [] } });
      decisions.push({ moduleId: id, why, remove });
    }
    add('identity', 'signboard.minimal', '确认店铺身份', [], '使用极简招牌，把首屏空间留给经营内容。', '保留唯一店铺身份，不增加装饰背景。');
    const navigation = () => {
      if (brief.categories.length >= 4) add('categories', brief.categories.length === 4 ? 'navigation.four' : 'navigation.five', '识别经营品类', brief.categories.map((_, i) => `nav-${i + 1}`), '只使用已提供品类；导航图优先保持清楚易识别。', '品类少于四个时省略导航，不凑数。', '', brief.categories);
      else add('category-copy', 'text.link', '说明经营范围', [], '固定文字行列出经营品类，让用户直接看清经营范围。这里不是可点击链接。', '没有图文导航时保留经营范围说明。', brief.categories.join(' · '));
    };
    const hero = () => add('overview', density === 'compact' ? 'carousel.small' : 'carousel.medium', '建立主题整体印象', ['overview'], recipe.id === 'theme-first' ? '主题先出现，让用户先看到整体画面，再逐类浏览。' : '分类之后呈现整体组合，为已经辨识的品类补充联系。', '整体画面需要说明品类之间的联系，不能重复小图的单品陈列。');
    const tiles = brief.categories.map((_, i) => `scene-${i + 1}`);
    if (density === 'balanced') tiles.splice(1, 0, 'detail');
    const group = (ids, combo = false) => {
      const names = ids.map(id => id === 'detail' ? `${brief.categories[0]}局部` : brief.categories[Number(id.split('-')[1]) - 1]);
      const index = modules.filter(m => m.type.startsWith('poster.')).length + 1;
      add(`content-${index}`, combo ? 'poster.combo1' : `poster.${['', 'single', 'two', 'three'][ids.length]}`, names.join(' / '), ids, combo ? `使用一大两小组织场景与局部。${brief.featuredCategory ? '强调已确认主推品类。' : '首个品类作为视觉起点，不代表销量排序。'}` : '并排展示相关内容，尽量平等地给出识别和比较空间。', ids.includes('detail') ? '局部需要补充形态或质地信息，不重复完整商品陈列。' : '覆盖已知经营范围，不为造型遗漏品类。');
    };
    if (recipe.id === 'theme-first') hero();
    navigation();
    if (recipe.id === 'theme-first' && tiles.length >= 3 && !(density === 'compact' && tiles.length === 4)) group(tiles.splice(0, 3), true);
    while (tiles.length) group(tiles.splice(0, tiles.length === 3 ? 3 : Math.min(2, tiles.length)));
    if (recipe.id === 'category-first') hero();
  // Decide one structure first. Only then allocate its image jobs and batches.
  const tasks = tasksFor(brief, density, options.creative);
  const plan = { version: 1, shop: brief.shop, navigationLibrary: { style: brief.navigationStyle }, summary: `${recipe.name}：${recipe.aim}。系统根据经营范围安排 ${modules.length} 个模块；每个品类都有对应画面，图片为装修示意。`, artDirection: { concept: brief.theme, narrative: recipe.aim, anchors: ['共享白平衡与色彩关系', '各图片按用途变化镜头与场景'], focalAssetId: 'overview' }, style: brief.style, modules, assets: tasks, batches: batchesFor(tasks) };
  return { ...validatePlan(plan), recommendation: { version: 1, method: 'reference-rules', name: recipe.name, ...choice, tradeoff: recipe.tradeoff, decisions, sources: sources.filter(s => recipe.evidence.includes(s.id)), brief } };
}

function batchesFor(tasks) {
  // Partition by count; group identical aspects into rows, at most three per row.
  // Hero goes first so later sheets can use it as a style reference.
  const ordered = [...tasks].sort((a, b) => Number(b.id === 'overview') - Number(a.id === 'overview'));
  const batches = [];
  for (let offset = 0; offset < ordered.length; offset += 6) {
    const part = ordered.slice(offset, offset + 6), groups = new Map();
    for (const a of part) { if (!groups.has(a.aspect)) groups.set(a.aspect, []); groups.get(a.aspect).push(a.id); }
    const rows = [];
    for (const ids of groups.values()) while (ids.length) rows.push(ids.splice(0, Math.min(3, ids.length)));
    const byId = new Map(tasks.map(a => [a.id, a]));
    const shape = rows.reduce((n, row) => n + 1 / (row.length * aspectRatios[byId.get(row[0]).aspect]), 0);
    if (shape < .45 && rows.length === 1 && rows[0].length > 1) rows.push(rows[0].splice(Math.ceil(rows[0].length / 2)));
    batches.push({ id: `structure-${batches.length + 1}`, rows });
  }
  return batches;
}
module.exports = { briefSchema, validateBrief, briefFromPlan, manualBrief, exampleBrief, recommendPlan, sources };

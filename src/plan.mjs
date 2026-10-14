/**
 * 设计决策层：让 AI 在这家店的语境下，从封闭的模块目录里做选择。
 *
 * 借鉴 json-render 的 catalog 模式：AI 只能选目录里的模块，张数与比例由目录约束，
 * 输出必须是可校验的 JSON。这里额外要求 AI 给出「每家店自己的理由」，
 * 因为本轮要验证的正是——AI 能不能选出有理由、适合这家店的组合，而不只是把模块填满。
 */
import { AppError, callTextModel } from './analyze.mjs';
import { catalogPromptText, MODULE_BY_TYPE } from './catalog.mjs';

const SYSTEM = `你是一名电商店铺视觉设计顾问。商家完全不懂设计，只提供了一张店铺截图。你要替他决定：这家店该用什么调性、页面放哪些模块、按什么顺序、每张图片画什么内容。

你不负责画图，也不负责写 HTML。你只做决策，输出一个可被程序执行的 JSON 计划。

## 一、你可以选择的模块（这是全部可选项，不能发明新模块）

{catalog}

## 二、必须遵守的硬约束

1. 只能使用上面列出的模块 type，一个字都不能改。
2. 每个模块能放几张图是固定的：目录里写了几张就必须给几张。图片数量不对，这一步就不通过。
3. 模块顺序就是你给的 modules 数组顺序，页面从上往下按此渲染。
4. 一个店铺招牌只能有一个，且必须在第一位。text 类模块可以多处使用。
5. 不要写 HTML、CSS、尺寸、坐标。位置和尺寸由固定模块决定，不归你管。
6. 不要填价格，除非商家截图里确实有价格。没有价格就不填 price 字段。
7. 不要编造品牌、销量、优惠、材质。

## 三、图片来源种类（这一步决定后面怎么生图）

每张图都要归入下面一种，写在 image.slots[].source：
- "product-photo"：商家自己商品的真实照片。程序会从截图里裁切，不生成，避免画错商品。
- "generated-scene"：由生图模型生成的场景图或氛围图（可用于招牌横幅、橱窗背景、氛围海报）。
- "generated-nav-icon"：由生图模型生成的导航小图标（简洁、扁平、无文字）。
- "generated-poster"：由生图模型生成的海报图（有构图和氛围，但不含任何文字）。

## 四、生图必须一次一张大图（重要）

你不写生图提示词，你只决定「这块画布上要画哪几个格子」。程序会把同一次生图里的多个格子拼成一张带分隔色的画布一次生成，再裁开使用。
- 一次生图 = 一个 image 对象。把所有需要生成的图尽量放进一个 image 里，减少调用次数。
- **同一个 image 里的格子必须有共同的艺术方向**（同一套色调、材质和光感），让整页看起来像一家店；
  但**不要要求每格长得一样**：程序已经按格子角色（招牌横幅／分类图标／主题海报／店铺头像）分别指定了不同的镜头、背景与构图，
  你的职责是把每个格子的「画什么内容」写得具体，不要写成「同样的产品白底图」。
- 真实商品照片（product-photo）不要放进生图的格子里，程序会从截图裁切。
- 每张图的 slotIds 必须精确对应 modules 里声明过的图；不能多也不能少。
- subject 请写具体画面（例如「白瓷台上的绿色精华瓶，旁边有龟背竹叶与浅色石块，侧逆光」），不要只写品类名。

## 五、输出格式

注意 constraints 只写**共同的调性**（色系、材质、光感），不要写成「全部格子都用同一个背景/同一套摆法」——
程序会按格子角色给每格不同的镜头、背景与构图，你写死统一背景会让整页看起来是同一张图复制出来的。
每格的 subject 要写得具体、彼此不同（例如「白瓷台上的绿色精华瓶，龟背竹叶与浅色石块，侧逆光」）。

只输出一个 JSON 对象，不要解释，不要 markdown 代码块：
{
  "design": {
    "title": "装修方案名称，12 字以内",
    "summary": "用一句商家能听懂的话说明这个方案，25 字以内",
    "decisions": [
      {"topic":"招牌","choice":"用了什么","reason":"为什么适合这家店"},
      {"topic":"主视觉尺寸","choice":"例如 4:3 中图","reason":"为什么"},
      {"topic":"商品陈列","choice":"例如 三列橱窗 6 件","reason":"为什么"},
      {"topic":"模块顺序","choice":"例如 招牌→导航→海报→橱窗","reason":"为什么这个顺序"}
    ],
    "palette": {"background":"#RRGGBB","accent":"#RRGGBB","text":"#RRGGBB"},
    "styleKeywords": ["3-6 个风格关键词"],
    "imagePlan": {
      "constraints": ["这一批图共同遵守的艺术方向，例如 统一的暖白与浅绿点缀、柔和侧光、不出现任何文字"],
      "images": [
        {
          "id": "sheet1",
          "purpose": "这批图用来做什么",
          "slots": [
            {"slotId":"m02.img1","source":"generated-nav-icon","subject":"针织衫图标","aspect":"1:1"},
            {"slotId":"m04.img1","source":"generated-poster","subject":"秋季女装氛围海报","aspect":"1:1"}
          ]
        }
      ]
    }
  },
  "modules": [
    {"id":"m01","type":"signboard.default","label":"默认招牌","reason":"为什么用这个模块","content":{"background":"m01.img1","shop":{"name":"店名","avatar":"m01.img2","vip":false,"newCount":"0","totalCount":"0"}},"images":[{"slotId":"m01.img1","source":"generated-scene","subject":"...","aspect":"483:258"}]}
  ]
}

补充说明：
- modules[].content 里凡是要放图片的字段，值统一写成 slotId（例如 "m04.img1"）。程序会把它换成实际图片文件。
- **slotId 的编号规则**：模块 id 是 mNN 时，它的第 k 张图必须叫 mNN.imgk。
  不同模块的编号不能互相借用（把招牌的 m01.img1 写进轮播是不允许的），每张图只能属于一个图片位。
- **字段名必须用下面这套，不能自己改名**（写成别的名字这个模块就读不到图片）：
  · 招牌 signboard.*：{"background":"mNN.img1","shop":{"name":"店名","avatar":"mNN.img2","vip":false,"newCount":"0","totalCount":"0"}}
  · 导航 navigation.*：{"images":["mNN.img1","mNN.img2","mNN.img3","mNN.img4"]}
  · 海报 poster.*（除 combo）：{"images":["mNN.img1", ...]}；三图组合 poster.combo1/2/3 同样是 {"images":[三张]}
  · 轮播 carousel.*：{"images":["mNN.img1"]}（注意是 images，不是 slides）
  · 商品橱窗 showcase.*：{"items":[{"image":"mNN.img1","title":"商品名","price":"199","currency":"¥"}]}
  · 公告与文本 text.*：{"text":"文案"}
  注意：只有商品橱窗才用 items；海报、轮播、导航一律用 images。
- 招牌的 shop.name 用识别到的店名；newCount/totalCount 不确定就写 "0"；avatar 也当作一个图片槽位处理。
- 商品橱窗的 content.items[] 里每件商品：image 写 slotId，title 写商品名（可含换行），price/currency 只在截图确实有价格时才写。
- 只用一个 image 就能装下所有生成图时，不要拆成两个。`;

/** 组织给 AI 的输入：店铺事实 + 模块目录。 */
export async function planDesign(env, shop, log = () => {}) {
  log('AI 正在做装修决策');
  const catalogText = catalogPromptText(await import('./catalog.mjs').then(m => m.CATALOG));
  const system = SYSTEM.replace('{catalog}', catalogText);

  const user = [
    '商家店铺信息（来自截图识别）：',
    JSON.stringify(shop, null, 2),
    '',
    '请为这家店做装修决策，按约定输出 JSON 计划。',
    '记住：所有图片槽位都必须被分配，且每张图都要归入四种来源之一。',
  ].join('\n');

  const { value, usage } = await callTextModel(env, { system, user, maxTokens: 12_000, timeoutMs: 300_000 });
  const plan = normalizePlan(value, shop);
  // 编号归属裁决：模型可能把别的模块的图片编号复制过来，这里按「先声明者拥有」定归属，
  // 并把生图计划里指向旧编号的格子重定向到正确编号。
  const renames = normalizeSlotIds(plan);
  if (renames.length) plan.slotRenames = renames;
  // 生图计划补全：模型漏写的格子由程序按同类推断补上，而不是让整份计划作废
  const added = completeImagePlan(plan);
  if (added.length) plan.imagePlanAdditions = added;
  const { validatePlan } = await import('./validate.mjs');
  const check = validatePlan(plan);
  if (!check.ok) {
    // 失败也要留下证据：把模型原始输出一并带上，便于诊断是提示词问题还是模型问题。
    throw new AppError('AI 的装修计划不合法，已停止执行（不会带着错误计划去生图）。', {
      stage: 'plan',
      hint: check.errors.join(' / '),
      raw: JSON.stringify(value, null, 1).slice(0, 12000) || String(value),
    });
  }
  // 计划被收窄过（例如橱窗商品超出模块容量）时如实记录，不静默改内容。
  const shrunk = [];
  for (const module_ of value?.modules || []) {
    const items = module_?.content?.items;
    const normalizedModule = plan.modules.find(m => m.id === module_.id);
    if (Array.isArray(items) && normalizedModule && Array.isArray(normalizedModule.content?.items) && items.length !== normalizedModule.content.items.length) {
      shrunk.push(`${module_.type}：原计划 ${items.length} 件，该模块只能放 ${normalizedModule.content.items.length} 件，已按容量保留前 ${normalizedModule.content.items.length} 件。`);
    }
  }
  plan.notes = shrunk;
  plan.validation = check;
  log(`计划通过校验：${plan.modules.length} 个模块，${check.slotCount} 张图，分 ${plan.design.imagePlan.images.length} 次生图`);
  return { plan, usage };
}

/** 把模型输出收敛成可控结构；这里只做形状修正，不做宽松兜底（非法由 validate 拦截）。 */
export function normalizePlan(value, shop = {}) {
  const palette = value?.design?.palette || {};
  const imagePlan = value?.design?.imagePlan || {};
  const modules = (Array.isArray(value?.modules) ? value.modules : []).map((m, i) => {
    const type = clampText(m?.type, 40);
    const id = clampText(m?.id, 12) || `m${String(i + 1).padStart(2, '0')}`;
    const images = (Array.isArray(m?.images) ? m.images : []).map(img => ({
      slotId: clampText(img?.slotId, 24),
      source: clampText(img?.source, 24),
      subject: clampText(img?.subject, 120),
      aspect: clampText(img?.aspect, 12),
    })).filter(img => img.slotId);
    const normalized = normalizeContent(type, m?.content, images, id);
    return {
      id,
      type,
      label: clampText(m?.label, 20) || MODULE_BY_TYPE.get(type)?.name || '',
      reason: clampText(m?.reason, 160),
      content: normalized.content,
      options: m?.options && typeof m.options === 'object' ? m.options : {},
      images: normalized.images || images,
    };
  }).filter(m => m.type);

  const plan = {
    design: {
      title: clampText(value?.design?.title, 24) || '店铺装修方案',
      summary: clampText(value?.design?.summary, 60),
      decisions: (Array.isArray(value?.design?.decisions) ? value.design.decisions : []).slice(0, 8).map(d => ({
        topic: clampText(d?.topic, 12),
        choice: clampText(d?.choice, 40),
        reason: clampText(d?.reason, 120),
      })).filter(d => d.topic && d.choice),
      palette: {
        background: hex(palette.background, shop?.designReading?.palette?.background || '#F5F3EF'),
        accent: hex(palette.accent, shop?.designReading?.palette?.accent || '#B4553C'),
        text: hex(palette.text, shop?.designReading?.palette?.text || '#1F1D1B'),
      },
      styleKeywords: (Array.isArray(value?.design?.styleKeywords) ? value.design.styleKeywords : []).slice(0, 6).map(k => clampText(k, 12)).filter(Boolean),
      imagePlan: {
        constraints: (Array.isArray(imagePlan.constraints) ? imagePlan.constraints : []).slice(0, 8).map(c => clampText(c, 100)).filter(Boolean),
        images: (Array.isArray(imagePlan.images) ? imagePlan.images : []).slice(0, 4).map((img, i) => ({
          id: clampText(img?.id, 20) || `sheet${i + 1}`,
          purpose: clampText(img?.purpose, 80),
          slots: (Array.isArray(img?.slots) ? img.slots : []).map(s => ({
            slotId: clampText(s?.slotId, 24),
            source: clampText(s?.source, 24),
            subject: clampText(s?.subject, 120),
            aspect: clampText(s?.aspect, 12),
          })).filter(s => s.slotId),
        })),
      },
    },
    modules,
  };
  return plan;
}

/**
 * 内容字段消歧。
 *
 * 组件库对每个模块的图片字段名是固定的（图片类统一叫 images），
 * 但模型偶尔会按自己的直觉写成 slides / items[].icon / items[].image。
 * 这些变体的含义是明确的，因此在这里安全地映射到规范字段，
 * 而不是把一份判断合理的计划整份丢掉——丢掉的代价是一次真实调用和一次等待。
 * 只处理语义明确的变体；真正缺内容的情况仍然会被校验拦下。
 */
function normalizeContent(type, rawContent, images, moduleId = 'm') {
  const content = rawContent && typeof rawContent === 'object' ? { ...rawContent } : {};
  const spec = MODULE_BY_TYPE.get(type);
  if (!spec) return { content };
  const slotIds = images.map(i => i.slotId);
  // 兜底编号只能来自本模块自己。曾经这里回退到「本模块声明的编号」，
  // 但声明为空时会拿到空数组，再由上游错误地把别的模块编号填进来，造成跨模块串号。
  const ownId = index => `${moduleId}.img${index + 1}`;
  let rebuiltImages = null;

  if (spec.group === '图片海报' || spec.group === '轮播图' || spec.group === '分类导航') {
    const expected = spec.slotCount;
    if (!Array.isArray(content.images) || !content.images.length) {
      // 组件库要求这些模块统一用 images；以下是语义明确的同义变体写法。
      // 导航：items[].icon；轮播：slides；海报：items[].image。
      const asStrings = list => (Array.isArray(list) ? list.map(v => (typeof v === 'string' ? v : (v?.image ?? v?.src ?? v?.icon))).filter(v => typeof v === 'string' && v) : []);
      const fromSlides = asStrings(content.slides);
      const fromItems = asStrings(content.items);
      const candidate = fromSlides.length ? fromSlides : fromItems;
      if (candidate.length) content.images = candidate;
      else if (slotIds.length === expected) content.images = slotIds;
      else content.images = Array.from({ length: expected }, (_, i) => ownId(i));
    }
    // 数量与该模块槽位数不符时，用「本模块自己的编号」补齐或截断。
    // 编号归属（谁拥有哪个编号、外来编号怎么改）统一交给 normalizeSlotIds 裁决，
    // 这里不再自行改名，避免和归属裁决互相打架。
    const expectedCount = expected;
    const ids = (Array.isArray(content.images) ? content.images : []).slice(0, expectedCount);
    while (ids.length < expectedCount) ids.push(ownId(ids.length));
    content.images = ids;
    rebuiltImages = ids.map((slotId, index) => {
      const declared = images.find(i => i.slotId === slotId) || images[index] || {};
      return {
        slotId,
        source: declared.source || (spec.group === '分类导航' ? 'generated-nav-icon' : 'generated-poster'),
        subject: declared.subject || '',
        aspect: declared.aspect || '',
      };
    });
  } else if (spec.group === '店铺招牌') {
    if (!content.background && images[0]) content.background = images[0].slotId;
    if (content.shop && typeof content.shop === 'object') {
      const shop = { ...content.shop };
      if (!shop.avatar && images[1]) shop.avatar = images[1].slotId;
      for (const key of ['newCount', 'totalCount']) if (shop[key] === undefined) shop[key] = '0';
      if (shop.vip === undefined) shop.vip = false;
      content.shop = shop;
    }
  } else if (spec.group === '商品橱窗') {
    if (Array.isArray(content.items)) {
      // 商品数超出该模块容量时按容量裁剪（三列橱窗向下取到 3 的倍数），
      // 多出的商品在页面上没有位置。
      const max = spec.capacity.max;
      if (content.items.length > max) {
        const keep = spec.type === 'showcase.three' ? Math.max(3, Math.floor(max / 3) * 3) : max;
        content.items = content.items.slice(0, keep);
      }
      // 槽位以「实际商品列表」为准：模型声明的 images 数量多一个少一个都不会再造成不一致。
      content.items = content.items.map((item, index) => {
        const out = item && typeof item === 'object' ? { ...item } : {};
        const declared = images[index]?.slotId;
        const fromItem = typeof out.image === 'string' && out.image ? out.image : null;
        out.image = fromItem || declared || slotIds[index] || '';
        // 标题里常被商家写上「🅿️150」「放💰235」这类价格暗号。它属于原始文案，
        // 不是可靠价格来源，因此从标题里去掉，同时不把它当价格使用。
        if (typeof out.title === 'string' && /[🅿️💰¥￥$]|\bp\d{2,}\b/i.test(out.title)) {
          const cleaned = out.title
            .split('\n')
            .filter(line => !/[🅿️💰¥￥$]|\bp\d{2,}\b/i.test(line))
            .join('\n')
            .trim();
          if (cleaned) out.title = cleaned;
          out.titlePriceMarkRemoved = true;
        }
        // 组件库要求每件商品都有价格字段。没有可靠价格时给空字符串（页面上不显示金额），
        // 而不是编一个价格，也不是把整份计划丢掉。
        if (out.price === undefined || out.price === null) {
          out.price = '';
          out.priceNote = '截图里没有可确认的价格，已按空价格处理';
        }
        if (out.currency === undefined || out.currency === null) out.currency = '¥';
        return out;
      });
      // 商品橱窗的槽位一律来自商家截图裁切：商品图绝不能交给生图模型（会画错商品）。
      // 因此来源不依赖模型声明——模型漏写第 9 件的来源时，也不会被误判成「需要生成」。
      rebuiltImages = content.items.map((item, index) => {
        const declared = images[index] || {};
        return {
          slotId: item.image,
          source: 'product-photo',
          subject: declared.subject || item.title || '商品照片',
          aspect: declared.aspect || '1:1',
        };
      });
    }
  }
  return { content, images: rebuiltImages };
}

/**
 * 槽位编号归属裁决。
 *
 * 模型有时会把一个模块的图片编号复制到另一个模块（例如把招牌的 m01.img1 写进轮播），
 * 那会让两个模块抢同一张图。这里按「谁先声明谁拥有」的原则定归属：
 * 抢用别人编号的模块改用自己前缀的编号，并把这次替换记下来，
 * 生图计划稍后按同一张映射表重定向（同一模块内被顶掉的编号也要往后顺延）。
 */
export function normalizeSlotIds(plan) {
  const owner = new Map();     // slotId -> 拥有它的模块 id
  const adopt = new Map();     // slotId -> 该改用的编号
  const replacements = [];     // { moduleId, from, to }：只对该模块的该项生效，不影响真正的拥有者

  for (const module_ of plan.modules) {
    for (const entry of module_.images) {
      const takenByOther = entry.slotId && owner.has(entry.slotId) && owner.get(entry.slotId) !== module_.id;
      const foreignPrefix = entry.slotId && !entry.slotId.startsWith(`${module_.id}.img`);
      if (!takenByOther && !foreignPrefix) {
        if (entry.slotId) owner.set(entry.slotId, module_.id);
        continue;
      }
      // 外来编号：换成该模块自己的、还没被占用的编号
      let index = 1;
      let candidate = `${module_.id}.img${index}`;
      const busy = id => owner.has(id) || module_.images.some(i => i !== entry && i.slotId === id) || [...adopt.values()].includes(id);
      while (busy(candidate)) { index += 1; candidate = `${module_.id}.img${index}`; }
      replacements.push({ moduleId: module_.id, from: entry.slotId, to: candidate });
      adopt.set(entry.slotId, candidate);
      owner.set(candidate, module_.id);
      entry.slotId = candidate;
    }
  }

  if (!replacements.length) return [];

  // 只改「被替换的那个模块」的内容字段，不动真正拥有该编号的模块
  for (const { moduleId, from, to } of replacements) {
    const module_ = plan.modules.find(m => m.id === moduleId);
    if (!module_) continue;
    const fix = value => (value === from ? to : value);
    const content = module_.content || {};
    if (typeof content.background === 'string') content.background = fix(content.background);
    if (Array.isArray(content.images)) content.images = content.images.map(fix);
    if (content.shop && typeof content.shop.avatar === 'string') content.shop.avatar = fix(content.shop.avatar);
    if (Array.isArray(content.items)) content.items = content.items.map(item => (item && typeof item.image === 'string' ? { ...item, image: fix(item.image) } : item));
  }

  // 生图计划重定向：只改「在模块内容里已经不存在、但属于被替换模块」的那些引用。
  // 真正拥有该编号的模块，其引用保持不变。
  const referenced = new Set();
  for (const module_ of plan.modules) {
    const content = module_.content || {};
    if (typeof content.background === 'string') referenced.add(content.background);
    if (Array.isArray(content.images)) content.images.forEach(v => typeof v === 'string' && referenced.add(v));
    if (content.shop && typeof content.shop.avatar === 'string') referenced.add(content.shop.avatar);
    if (Array.isArray(content.items)) content.items.forEach(i => i && typeof i.image === 'string' && referenced.add(i.image));
  }
  for (const { from, to } of replacements) {
    if (referenced.has(from)) continue; // 该编号仍被真正的主人使用，不能动
    for (const image of plan.design?.imagePlan?.images || []) {
      image.slots = image.slots.map(slot => (slot.slotId === from ? { ...slot, slotId: to } : slot));
    }
  }
  return replacements.map(r => ({ from: r.from, to: r.to, moduleId: r.moduleId }));
}

/**
 * 生图计划补全：每个要生成的槽位都必须在生图计划里有归属。
 *
 * 模型经常漏写某一格的来源（实测：轮播的格子没进生图计划、橱窗第 9 件漏了声明）。
 * 漏一个格子就让整份计划作废，代价是一次真实调用和一次等待，并不划算。
 * 这里按已有格子推断补上：先找同一模块的兄弟格子，再找同类型的其他格子，
 * 最后按模块分组给一个保守的默认来源。补出来的格子会在计划说明里如实标注。
 */
export function completeImagePlan(plan) {
  const declared = new Map();
  for (const image of plan.design?.imagePlan?.images || []) {
    for (const slot of image.slots) declared.set(slot.slotId, { imageId: image.id, slot });
  }
  const groupOf = new Map(plan.modules.map(m => [m.id, MODULE_BY_TYPE.get(m.type)?.group]));
  const defaultSourceFor = group => {
    if (group === '分类导航') return 'generated-nav-icon';
    if (group === '店铺招牌') return 'generated-scene';
    if (group === '轮播图' || group === '图片海报') return 'generated-poster';
    return 'generated-scene';
  };
  const additions = [];
  for (const module_ of plan.modules) {
    const group = groupOf.get(module_.id);
    for (const entry of module_.images) {
      if (declared.has(entry.slotId)) continue;
      // 真实商品照片来自截图裁切，不参与生图，不需要进生图计划
      if ((entry.source || '') === 'product-photo') continue;
      // 同一个模块里已经有格子被声明过 → 并到那张画布；否则新建一张
      const sibling = module_.images.map(e => declared.get(e.slotId)).find(Boolean);
      const targetImage = sibling
        ? (plan.design.imagePlan.images.find(i => i.id === sibling.imageId) || plan.design.imagePlan.images[0])
        : null;
      const slot = {
        slotId: entry.slotId,
        source: entry.source || defaultSourceFor(group),
        subject: entry.subject || '',
        aspect: entry.aspect || '',
      };
      if (targetImage) targetImage.slots.push(slot);
      else if (plan.design.imagePlan.images.length) plan.design.imagePlan.images[0].slots.push(slot);
      else plan.design.imagePlan.images.push({ id: 'sheet1', purpose: '按模块需要生成素材', slots: [slot] });
      declared.set(entry.slotId, { imageId: targetImage?.id || 'sheet1', slot });
      additions.push(slot.slotId);
    }
  }
  return additions;
}

function clampText(value, limit) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}
function hex(value, fallback) {
  const s = String(value ?? '').trim();
  return /^#[0-9a-f]{6}$/i.test(s) ? s.toUpperCase() : fallback;
}

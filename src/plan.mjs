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
- 同一个 image 里的所有格子必须风格统一（同一场景、同一光线、同一色调）。
- 真实商品照片（product-photo）不要放进生图的格子里，程序会从截图裁切。
- 每张图的 slotIds 必须精确对应 modules 里声明过的图；不能多也不能少。

## 五、输出格式

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
      "constraints": ["这一批图共同遵守的约束，例如 统一暖色木质背景、柔和侧光、不出现任何文字"],
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

  const { value, usage } = await callTextModel(env, { system, user, maxTokens: 6000, timeoutMs: 240_000 });
  const plan = normalizePlan(value, shop);
  const { validatePlan } = await import('./validate.mjs');
  const check = validatePlan(plan);
  if (!check.ok) {
    throw new AppError('AI 的装修计划不合法，已停止执行（不会带着错误计划去生图）。', {
      stage: 'plan',
      hint: check.errors.join(' / '),
    });
  }
  plan.validation = check;
  log(`计划通过校验：${plan.modules.length} 个模块，${check.slotCount} 张图，分 ${plan.design.imagePlan.images.length} 次生图`);
  return { plan, usage };
}

/** 把模型输出收敛成可控结构；这里只做形状修正，不做宽松兜底（非法由 validate 拦截）。 */
export function normalizePlan(value, shop = {}) {
  const palette = value?.design?.palette || {};
  const imagePlan = value?.design?.imagePlan || {};
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
    modules: (Array.isArray(value?.modules) ? value.modules : []).map((m, i) => ({
      id: clampText(m?.id, 12) || `m${String(i + 1).padStart(2, '0')}`,
      type: clampText(m?.type, 40),
      label: clampText(m?.label, 20) || MODULE_BY_TYPE.get(clampText(m?.type, 40))?.name || '',
      reason: clampText(m?.reason, 160),
      content: m?.content && typeof m.content === 'object' ? m.content : {},
      options: m?.options && typeof m.options === 'object' ? m.options : {},
      images: (Array.isArray(m?.images) ? m.images : []).map(img => ({
        slotId: clampText(img?.slotId, 24),
        source: clampText(img?.source, 24),
        subject: clampText(img?.subject, 120),
        aspect: clampText(img?.aspect, 12),
      })).filter(img => img.slotId),
    })).filter(m => m.type),
  };
  return plan;
}

function clampText(value, limit) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}
function hex(value, fallback) {
  const s = String(value ?? '').trim();
  return /^#[0-9a-f]{6}$/i.test(s) ? s.toUpperCase() : fallback;
}

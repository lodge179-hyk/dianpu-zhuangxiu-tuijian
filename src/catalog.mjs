/**
 * 从固定组件库提取「AI 可选模块目录」。
 *
 * 这是整个方案的约束边界（借鉴 json-render 的 catalog 思路）：
 * AI 只能从这份目录里挑模块，每个模块能放几张图、每张图什么比例、有哪些文案字段，
 * 全部来自组件库的真实实现（lib/modules/*.cjs 的校验逻辑），不是我们自己编的。
 *
 * 目录同时用于两件事：
 * 1. 生成给 AI 的系统提示词（它能看到什么可选）；
 * 2. 校验 AI 的计划（选错模块、张数不对、比例不匹配都在提交前拦下）。
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const LIB = path.resolve(here, '../vendor-component-library/lib');
const styles = require(path.join(LIB, 'styles.snapshot.json'));

const rd = n => Math.round(n * 100) / 100;

/** 一个模块的图片槽位：名字、矩形、比例、原生像素。 */
function slotsOf(type) {
  const module_ = styles[type];
  if (!module_) throw new Error(`组件库里没有模块 ${type}`);

  // 招牌的横幅位不是 IMG 节点（组件库用 background-image 实现），必须单独补上，
  // 否则目录会漏报槽位，AI 也就无法为招牌背景图安排素材。
  if (type.startsWith('signboard.')) {
    const banner = module_.nodes.find(n => /DecorateSignboard_banner|SignboardSwiper_image|SignboardSwiper_banner/.test(n.name));
    const avatar = module_.nodes.find(n => n.name === 'SignboardInfo_icon.1');
    const slots = [];
    if (type !== 'signboard.minimal' && banner) {
      slots.push(makeSlot(1, banner, 'banner'));
    }
    if (avatar) slots.push(makeSlot(slots.length + 1, avatar, 'avatar'));
    return slots;
  }

  // 与 media.cjs 的取法一致：IMG 且名字不像购物车/图标
  let imgs = module_.nodes.filter(n => n.tag === 'IMG' && !/cart|icon/i.test(n.name));
  // showcase 的图片槽位命名规则
  const showcaseImgs = module_.nodes.filter(n => /^CommodityItem_image\.\d+$/.test(n.name));
  if (showcaseImgs.length) imgs = showcaseImgs;
  // 与组件库一致的裁剪规则
  if (type === 'navigation.five') imgs = imgs.slice(0, 5);
  if (type === 'poster.single') imgs = imgs.slice(0, 1);
  return imgs.map((n, i) => makeSlot(i + 1, n, /^CommodityItem_image/.test(n.name) ? 'product'
    : type.startsWith('navigation') ? 'nav-icon'
      : /banner|SignboardSwiper/i.test(n.name) ? 'banner'
        : 'poster'));
}

function makeSlot(index, node, role) {
  return {
    index,
    node: node.name,
    rect: node.rect.map(rd),
    width: rd(node.rect[2]),
    height: rd(node.rect[3]),
    ratio: rd(node.rect[2] / node.rect[3]),
    role,
  };
}

/** 分组：把 23 种模块按业务用途归类，便于 AI 有结构地挑选。 */
const GROUP = {
  signboard: '店铺招牌',
  navigation: '分类导航',
  poster: '图片海报',
  carousel: '轮播图',
  showcase: '商品橱窗',
  text: '公告与文本',
};

const NAME = {
  'signboard.default': '默认招牌', 'signboard.classic': '经典招牌', 'signboard.minimal': '极简招牌', 'signboard.fullscreen': '全屏轮播招牌',
  'navigation.four': '导航·每行4个', 'navigation.five': '导航·每行5个',
  'poster.single': '海报·单列', 'poster.two': '海报·双列', 'poster.three': '海报·三列',
  'poster.combo1': '三图组合·左大右小', 'poster.combo2': '三图组合·右大左小', 'poster.combo3': '三图组合·上大下小', 'poster.sliding': '海报·多图滑动',
  'carousel.small': '轮播·小图3:1', 'carousel.medium': '轮播·中图4:3', 'carousel.large': '轮播·大图3:4',
  'showcase.single': '橱窗·单列', 'showcase.two': '橱窗·双列', 'showcase.three': '橱窗·三列', 'showcase.sliding': '橱窗·滑动',
  'text.single': '公告·单行', 'text.multiline': '公告·多行', 'text.link': '文字链接',
};

/** 选型提示：写在目录里给 AI 看，说明什么场景适合用。 */
const HINT = {
  'signboard.default': '默认招牌：整张横幅图打底，上方叠店铺信息，适合有品牌大图的店铺。最常用的开场。',
  'signboard.classic': '经典招牌：结构更简洁，适合没有强品牌图的店铺。',
  'signboard.minimal': '极简招牌：平台固定背景，不放自定义横幅图，适合小店铺或不想开图的情况。',
  'signboard.fullscreen': '全屏轮播招牌：占屏很高，适合品牌感强、有多张大图的店铺；小店铺不建议。',
  'navigation.four': '导航·每行4个：图标较大，适合导航项少（正好4个）的店铺。',
  'navigation.five': '导航·每行5个：图标较小，默认单行5个，适合导航项多（5个以上）的店铺。',
  'poster.single': '海报·单列：一行一张大图，视觉冲击强，适合主推款或活动主图。',
  'poster.two': '海报·双列：一行两张方图，适合并排展示两个主题。',
  'poster.three': '海报·三列：一行三张小方图，适合多个并列卖点或分类入口。',
  'poster.combo1': '三图组合·左大右小：一张主图配两张小图，有主次关系。',
  'poster.combo2': '三图组合·右大左小：与 combo1 镜像，适合把重点放右侧时使用。',
  'poster.combo3': '三图组合·上大下小：一张大图配底部两张小图，适合主图加细节。',
  'poster.sliding': '海报·多图滑动：一行可横向滑动多张图，适合图片多但不想占太高。',
  'carousel.small': '轮播·小图3:1：细长横幅，占高小，适合作为过渡或公告位。',
  'carousel.medium': '轮播·中图4:3：最通用的主视觉尺寸，适合大多数店铺。',
  'carousel.large': '轮播·大图3:4：竖长主视觉，占屏高，适合服装等需要展示整体造型的品类。',
  'showcase.single': '橱窗·单列：一行一件大商品，适合主推单品。',
  'showcase.two': '橱窗·双列：一行两件商品，适合客单价较高、需要看清细节的品类。',
  'showcase.three': '橱窗·三列：一行三件商品，最适合商品多、想快速铺满的店铺。容量 3 的倍数。',
  'showcase.sliding': '橱窗·滑动：横向滑动展示多件商品，适合商品多但页面高度有限的店铺。',
  'text.single': '公告·单行：一行短公告，适合活动提示、发货说明。',
  'text.multiline': '公告·多行：可折行公告，适合规则说明、售后政策。',
  'text.link': '文字链接：单个可点文字，适合“查看全部”之类入口。',
};

export function buildCatalog() {
  const modules = [];
  for (const type of Object.keys(styles)) {
    if (type === 'showcase.three-repeat') continue; // 重复样本，不作为可选项
    const group = GROUP[type.split('.')[0]];
    const slots = slotsOf(type);
    const module_ = styles[type];
    // 容量：与组件库校验一致
    let capacity = { min: 1, max: Math.max(1, slots.length) };
    if (type === 'showcase.three') capacity = { min: 3, max: 9, step: 3 };
    if (type === 'showcase.two') capacity = { min: 2, max: 2 };
    if (type === 'showcase.single') capacity = { min: 1, max: 1 };
    if (type === 'showcase.sliding') capacity = { min: 1, max: 5 };
    if (type.startsWith('poster.combo')) capacity = { min: slots.length, max: slots.length };
    if (type === 'navigation.five') capacity = { min: 1, max: 5 };
    if (type.startsWith('navigation.')) capacity = { min: slots.length, max: slots.length };
    if (type === 'poster.single') capacity = { min: 1, max: 2 };

    // 内容字段：来自各渲染器的 keys() 声明
    let content;
    if (type.startsWith('signboard.')) {
      content = type === 'signboard.minimal'
        ? { fields: ['shop'], note: '极简招牌不接受自定义背景图，只放店铺信息。' }
        : { fields: ['background', 'shop'], note: 'background 是一张横幅图；shop 里是店名、头像、上新数、总数。' };
    } else if (type.startsWith('showcase.')) {
      content = { fields: ['items[]'], itemFields: ['image', 'title', 'price', 'currency'], note: '每件商品一张方图 + 名称 + 价格。商品数必须等于槽位数。' };
    } else if (type.startsWith('text.')) {
      content = { fields: ['text'], note: '纯文字，不需要图片。' };
    } else {
      content = { fields: ['images[]'], note: `需要 ${capacity.min}${capacity.max !== capacity.min ? '~' + capacity.max : ''} 张图，按顺序对应槽位。` };
    }

    modules.push({
      type,
      name: NAME[type] || type,
      group,
      hint: HINT[type] || '',
      nativeWidth: module_.width,
      nativeHeight: rd(module_.height),
      slotCount: slots.length,
      capacity,
      content,
      slots: slots.map(s => ({ index: s.index, role: s.role, width: s.width, height: s.height, ratio: s.ratio })),
    });
  }
  return {
    version: 1,
    generatedFrom: 'vendor-component-library/lib/styles.snapshot.json + lib/modules/*.cjs',
    note: '模块与槽位来自真实网页采集数据的固定封装；程序按此渲染，AI 只做选择与内容配置。',
    pageWidth: styles['signboard.default'].width,
    groups: GROUP,
    modules,
  };
}

/** 供提示词使用的紧凑目录文本。 */
export function catalogPromptText(catalog, { groups = null } = {}) {
  const lines = [];
  for (const [key, label] of Object.entries(catalog.groups)) {
    const items = catalog.modules.filter(m => m.group === label && (!groups || groups.includes(key)));
    if (!items.length) continue;
    lines.push(`【${label}】`);
    for (const m of items) {
      const cap = m.capacity.min === m.capacity.max ? `${m.capacity.min}` : `${m.capacity.min}-${m.capacity.max}`;
      const slotText = m.slotCount ? `图片槽位 ${m.slotCount} 个（比例 ${[...new Set(m.slots.map(s => s.ratio))].join('/')}），可放 ${cap} 张` : '无图片槽位';
      lines.push(`- ${m.type}（${m.name}）：${slotText}。${m.hint}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export const CATALOG = buildCatalog();
export const MODULE_BY_TYPE = new Map(CATALOG.modules.map(m => [m.type, m]));

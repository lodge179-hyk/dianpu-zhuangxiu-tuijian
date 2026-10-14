// Build the AI-facing module catalog from the frozen a9 component library.
// Slot counts/rects come from styles.snapshot.json so the catalog can never
// drift from what the renderer actually supports.
const styles = require('../../experiments/store-decoration/a9-component-library/lib/styles.snapshot.json');

// Mirror the slicing rules implemented in media.cjs.
function mediaSlots(type, nodes) {
  const imgs = nodes.filter(n => n.tag === 'IMG' && !/cart|icon/i.test(n.name));
  if (type === 'navigation.five') return imgs.slice(0, 5);
  if (type === 'poster.single') return imgs.slice(0, 1);
  return imgs;
}

const USAGE = {
  'signboard.default': '页首店铺招牌：一张 483×258 背景图 + 店名/头像/上新数/总数。需要店铺数据齐全时使用。',
  'signboard.classic': '页首店铺招牌（经典版）：不使用自定义背景图，仅店名与数据，适合想保持简洁的店铺。',
  'signboard.minimal': '页首店铺招牌（极简版）：只显示店名与头像，无法提供上新/总数数据时的稳妥选择。',
  'signboard.fullscreen': '页首店铺招牌（全屏版）：一张约 2:3 的竖版大图，视觉冲击强，适合有主视觉海报的店铺。',
  'navigation.four': '四列圆形图标导航：4 个方形素材（圆形裁切显示），每个入口代表一个品类或专区。',
  'navigation.five': '五列圆形图标导航：5 个方形素材（圆形裁切显示），入口更多但每个更小。',
  'text.single': '单行滚动公告：一句短文案（≤30字），用于分区引导或上新提醒。',
  'text.multiline': '多行公告：品牌故事或店铺说明（≤90字），常放页尾。',
  'text.link': '单行文字链接：一句引导语（≤30字）。',
  'poster.three': '三列方形海报：3 个方形图槽，适合品类入口或主打商品并列。',
  'poster.two': '双列方形海报：2 个方形图槽，两个主题并列。',
  'poster.single': '单列大图海报：1 个方形图槽纵向大图，单个主打商品或主题。',
  'poster.combo1': '三图组合（左大右小）：3 个方形图槽拼成一张组合海报。',
  'poster.combo2': '三图组合（右大左小）：3 个方形图槽拼成一张组合海报。',
  'poster.combo3': '三图组合（上大下小）：3 个方形图槽纵向排列，占位更高。',
  'poster.sliding': '横向滑动海报：最多 4 个方形图槽横向排列。',
  'carousel.small': '小图轮播（3:1 横幅）：1 张超宽横幅素材，适合气氛/促销横幅。',
  'carousel.medium': '中图轮播（4:3）：1 张横版素材，适合场景化主推。',
  'carousel.large': '大图轮播（3:4 竖版）：1 张竖版素材，适合穿搭/主视觉。',
  'showcase.three': '三列商品橱窗：最多 9 张方形商品图 + 名称，适合商品较多的店铺。',
  'showcase.two': '双列商品橱窗：2 张方形商品图 + 名称，单行标题。',
  'showcase.single': '单列大图橱窗：1 张方形商品大图 + 名称，适合主推单品。',
  'showcase.sliding': '横向商品橱窗：最多 5 张方形商品图 + 名称横向排列。',
};

const FAMILY = t => t.split('.')[0];
const ratioText = rect => {
  const g = (a, b) => (b ? g(b, a % b) : a);
  const w = Math.round(rect[2]), h = Math.round(rect[3]);
  const d = g(w, h) || 1;
  return `${Math.round(w / d)}:${Math.round(h / d)}`;
};

function buildCatalog() {
  const list = [];
  for (const [type, source] of Object.entries(styles)) {
    const family = FAMILY(type);
    let slots = [];
    if (family === 'signboard') {
      if (type === 'signboard.default') slots = [[0, 0, 483, 258]];
      if (type === 'signboard.fullscreen') {
        const n = source.nodes.find(n => n.tag === 'IMG' && !/cart|icon/i.test(n.name));
        if (n) slots = [n.rect];
      }
    } else if (family === 'navigation' || family === 'poster' || family === 'carousel') {
      slots = mediaSlots(type, source.nodes).map(n => n.rect);
    } else if (family === 'showcase') {
      slots = source.nodes.filter(n => /^CommodityItem_image\.\d+$/.test(n.name)).map(n => n.rect);
    }
    const entry = {
      type,
      family,
      usage: USAGE[type] || '',
      imageSlots: slots.length,
      slotRects: slots,
      ratio: slots.length ? ratioText(slots[0]) : null,
      ratios: slots.length ? [...new Set(slots.map(ratioText))] : [],
      contentFields:
        family === 'text' ? ['text']
        : family === 'signboard' ? ['background(招牌图槽)','shop:{name,avatar,上新数,总数}']
        : family === 'showcase' ? ['items:{image槽位,商品名,价格(可选)}']
        : ['images(按槽位顺序)'],
    };
    list.push(entry);
  }
  list._sources = styles;
  return list;
}

// Decision subset: only types whose image slots are near-square (or have no
// image slots). Wide banners / tall posters / special signboards are excluded
// so every generated asset can come from one uniform square grid.
function decisionSubset(list) {
  const ok = entry => {
    if (entry.family === 'text') return true;
    if (entry.type === 'signboard.minimal') return true;
    if (entry.family === 'signboard') return false;
    if (!entry.imageSlots) return true;
    return entry.slotRects.every(r => {
      const ratio = r[2] / r[3];
      return ratio >= 0.8 && ratio <= 1.45;
    });
  };
  const subset = list.filter(ok);
  subset._sources = list._sources;
  return subset;
}

module.exports = { buildCatalog, decisionSubset, USAGE, mediaSlots };

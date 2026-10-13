export const DEFAULT_PALETTE = { background: '#F7F5F0', surface: '#FFFFFF', accent: '#496151', text: '#25352C', muted: '#646D65' };

const text = (value, fallback, limit) => String(typeof value === 'string' ? value : fallback).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit) || fallback;
const safeCopy = (value, fallback, limit) => {
  const result = text(value, fallback, limit);
  return /热销|爆款|销量|人气|限时|特价|折扣|优惠|秒杀|满减|正品保证|官方授权|改善|修复|抗衰|美白|祛|功效|全球第一|最佳/.test(result) ? fallback : result;
};
const hex = (value, fallback) => /^#[\da-f]{6}$/i.test(value || '') ? value.toUpperCase() : fallback;
const luminance = color => {
  const channels = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
const mix = (color, target, ratio) => `#${[1, 3, 5].map(i => Math.round(parseInt(color.slice(i, i + 2), 16) * (1 - ratio) + target * ratio).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

// Model proposals choose the direction and products. Layout geometry is a
// finite, shared contract rather than a second unconstrained generation.
const COMPOSITIONS = {
  editorial: {
    solo: [{ role: 'primary', x: 21, y: 10, w: 58, h: 80 }],
    duo: [{ role: 'primary', x: 8, y: 10, w: 49, h: 80 }, { role: 'secondary', x: 61, y: 29, w: 30, h: 58 }],
  },
  soft: {
    solo: [{ role: 'primary', x: 24, y: 12, w: 52, h: 76 }],
    duo: [{ role: 'primary', x: 11, y: 13, w: 47, h: 77 }, { role: 'secondary', x: 62, y: 31, w: 29, h: 55 }],
  },
  graphic: {
    solo: [{ role: 'primary', x: 18, y: 9, w: 64, h: 82 }],
    duo: [{ role: 'primary', x: 8, y: 10, w: 49, h: 80 }, { role: 'secondary', x: 61, y: 23, w: 31, h: 64 }],
  },
};
const DIRECTION_DETAILS = {
  editorial: { title: '留白与材质', environment: '浅色哑光台面与细腻纸感背景，单一低矮展台，保留充分呼吸感', lighting: '来自左上方的大面积柔光，细腻接触阴影，保持真实包装质感' },
  soft: { title: '柔光日常', environment: '柔和暖白背景与浅色石材台面，低对比连续场景，简洁自然', lighting: '柔和侧窗光，轻微明暗层次，不用强反光遮挡商品' },
  graphic: { title: '清晰色彩', environment: '从商品主色提取少量色块与几何台面，背景简洁，商品颜色保持真实', lighting: '干净的棚拍主光与克制轮廓光，边缘清楚，阴影方向统一' },
};

export function normalizeDesign(rawDesign, products, shopName = '店铺预览') {
  const raw = rawDesign && typeof rawDesign === 'object' ? rawDesign : {};
  const list = Array.isArray(products) ? products : [];
  const available = new Set(list.map(p => p.id));
  const ids = values => Array.isArray(values) ? [...new Set(values.filter(id => typeof id === 'string' && available.has(id)))] : [];
  const direction = Object.hasOwn(COMPOSITIONS, raw.direction) ? raw.direction : 'editorial';
  const details = DIRECTION_DETAILS[direction];
  const palette = Object.fromEntries(Object.entries(DEFAULT_PALETTE).map(([key, fallback]) => [key, hex(raw.palette?.[key], fallback)]));
  // The current renderer is a light storefront; reject illegible model colors.
  while (luminance(palette.background) < .7) palette.background = mix(palette.background, 255, .15);
  while (luminance(palette.surface) < .9) palette.surface = mix(palette.surface, 255, .2);
  for (const key of ['text', 'muted', 'accent']) {
    // Keep the proposed hue: pale cosmetics and bright digital palettes should
    // not all collapse into the default green when used for readable text.
    while ([palette.surface, palette.background].some(bg => contrast(palette[key], bg) < 4.5)) palette[key] = mix(palette[key], 0, .12);
  }
  let heroIds = ids(raw.hero?.productIds).slice(0, 2);
  if (!heroIds.length && list.length) heroIds = [list[0].id];
  if (raw.hero?.composition === 'solo') heroIds = heroIds.slice(0, 1);
  const composition = heroIds.length > 1 ? 'duo' : 'solo';
  const heroProducts = heroIds.map(id => list.find(p => p.id === id));
  const heroCategories = [...new Set(heroProducts.map(p => p.category).filter(v => v && v !== '商品'))];
  const headline = heroCategories.length === 1 ? `${heroCategories[0]} · 细节之间` : '好物，自有风格';
  const rawSections = Array.isArray(raw.sections) ? raw.sections : [];
  const posterSection = rawSections.find(section => section?.kind === 'poster') || {};
  const posterCandidates = [...new Set([...ids(posterSection.productIds), ...list.map(p => p.id)])].slice(0, 3);
  // Three slots are part of the accepted UI. Reuse a known product when fewer
  // are available; do not change the number/shape of slots or invent products.
  const posters = Array.from({ length: 3 }, (_, i) => {
    const productId = posterCandidates[i % Math.max(1, posterCandidates.length)];
    const product = list.find(p => p.id === productId);
    return { id: `poster_${i + 1}`, productId, title: product?.category || '商品展示', source: 'source-composite' };
  });
  const catalog = rawSections.find(section => section?.kind === 'catalog') || {};
  const sections = [
    { id: 'poster_row', kind: 'poster', title: '三列海报', subtitle: '在固定竖向槽位内搭配商品与视觉', productIds: posters.map(p => p.productId) },
    { id: 'catalog_1', kind: 'catalog', title: '三列商品橱窗', subtitle: '方形商品图片，名称与购物车在图下', productIds: [...new Set([...ids(catalog.productIds), ...list.map(p => p.id)])] },
  ];
  return {
    title: safeCopy(raw.title, details.title, 28),
    summary: safeCopy(raw.summary, `在已确认的微购UI内，为${shopName === '店铺预览' ? '截图中的商品' : shopName}搭配统一的轮播与海报视觉。`, 180),
    direction, palette,
    uiContract: 'confirmed-wego-v1',
    moduleOrder: ['shop_header', 'benefits', 'category_navigation', 'carousel', 'poster_row', 'product_showcase'],
    posters,
    hero: {
      headline: safeCopy(raw.hero?.headline, headline, 22),
      subheadline: safeCopy(raw.hero?.subheadline, '以商品本身，呈现店铺气质', 42),
      composition, productIds: heroIds,
      slots: COMPOSITIONS[direction][composition].slice(0, heroIds.length).map((slot, i) => ({ id: `hero.image.${slot.role}`, productId: heroIds[i], ...slot })),
      environment: text(raw.hero?.environment, details.environment, 240),
      lighting: text(raw.hero?.lighting, details.lighting, 180),
    },
    sections,
  };
}

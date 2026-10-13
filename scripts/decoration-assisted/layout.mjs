import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { DEFAULT_PALETTE, normalizeDesign } from './design.mjs';
export { DEFAULT_PALETTE } from './design.mjs';

const WIDTH = 365, SCALE = 3, HS = WIDTH / 1240;
const HEADER_SOURCE = new URL('../decoration-mvp/fixed-header-clean.png', import.meta.url);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const unique = values => [...new Set(values)];
const byId = (products, id) => products.find(product => product.id === id);

/** User-approved geometry stays fixed; design choices only fill the image slots. */
export function layout(productCount, bannerCount = 1, options = {}) {
  if (!Number.isInteger(productCount) || productCount < 1 || productCount > 6) throw new Error('本次布局支持 1 至 6 件选品');
  const products = options.products || Array.from({ length: productCount }, (_, i) => ({ id: `product_${i + 1}`, name: `商品 ${i + 1}`, category: '商品' }));
  const confirmed = options.shopIdentity?.confirmed === true, shopName = confirmed ? options.shopName : '店铺装修预览';
  const design = normalizeDesign(options.design, products, shopName), colors = { ...DEFAULT_PALETTE, ...design.palette };
  const nodes = [], ids = new Set();
  const add = (id, parent, role, x, y, w, h, kind = 'container', source = 'locked-layout', attrs = {}) => {
    if (ids.has(id)) throw new Error(`重复布局组件 ${id}`);
    ids.add(id);
    const node = { id, parent, role, source, x, y, w, h, kind, fit: kind === 'image' ? 'contain' : 'fixed', overflow: kind === 'text' ? 'ellipsis-and-clip' : 'clip', constraint: '已确认固定区域；风格、图片、文字不改变位置、比例、顺序', ...attrs };
    nodes.push(node); return node;
  };
  const rect = (id, parent, role, x, y, w, h, fill, attrs = {}) => add(id, parent, role, x, y, w, h, 'rect', 'locked-layout', { fill, ...attrs });
  const text = (id, parent, role, value, x, y, w, h, attrs = {}) => add(id, parent, role, x, y, w, h, 'text', attrs.source || 'locked-layout', { value, fontSize: 11, lineHeight: 15, maxLines: 1, color: '#333333', weight: 400, ...attrs });
  const image = (id, parent, role, product, x, y, w, h, attrs = {}) => add(id, parent, role, x, y, w, h, 'image', `screenshot.${product.id}`, { file: `product-${products.findIndex(item => item.id === product.id)}.png`, background: colors.surface, productId: product.id, ...attrs });
  const icon = (id, parent, role, symbol, x, y, w, h, color = '#C68443') => add(id, parent, role, x, y, w, h, 'icon', 'fixed-platform-ui', { symbol, color });
  const page = add('page', null, '完整装修效果图', 0, 0, WIDTH, 1);
  const background = rect('page.background', 'page', '整页固定白底', 0, 0, WIDTH, 1, '#FFFFFF');
  const signHeight = 880 * HS;
  add('shop_sign', 'page', '固定双绿色三角招牌与原平台操作栏', 0, 0, WIDTH, signHeight, 'container', 'fixed-header-clean.png');
  add('shop_sign.background', 'shop_sign', '原样板背景及平台信息', 0, 0, WIDTH, signHeight, 'image', 'fixed-header-clean.png', { file: '@fixed-header', background: '#FFFFFF' });
  const headerRegion = (id, role, left, top, width, height) => add(id, 'shop_sign', role, left * HS, top * HS, width * HS, height * HS, 'image', 'fixed-header-clean.png', { file: '@fixed-header', sourceRect: { left, top, width, height }, background: '#FFFFFF' });
  headerRegion('shop_sign.back', '平台返回按钮', 54, 154, 118, 120);
  headerRegion('shop_sign.search', '平台搜索栏', 196, 155, 368, 118);
  headerRegion('shop_sign.print', '平台打印按钮', 589, 154, 118, 120);
  headerRegion('shop_sign.share', '平台分享按钮', 731, 154, 118, 120);
  headerRegion('shop_sign.platform_menu', '平台菜单与关闭入口', 873, 154, 341, 120);
  headerRegion('shop_sign.appointment', '原平台预约入口', 984, 657, 201, 90);
  headerRegion('shop_sign.badges', '原样板平台认证标记', 248, 765, 254, 64);
  headerRegion('shop_sign.update_count', '原样板上新信息', 537, 764, 254, 65);
  const ax = 49 * HS, ay = 651 * HS, avatarSize = 184 * HS;
  rect('shop_sign.avatar.background', 'shop_sign', '店名首字头像底板', ax, ay, avatarSize, avatarSize, '#F5E8D3', { radius: avatarSize / 2 });
  text('shop_sign.avatar.initial', 'shop_sign', '未识别原头像时使用店名首字', confirmed ? Array.from(shopName)[0] : '店', ax, ay + 10, avatarSize, 36, { fontSize: 28, lineHeight: 34, align: 'center', color: '#803948', source: confirmed ? 'screenshot.shopName' : 'preview-label' });
  text('shop_sign.name', 'shop_sign', '截图确认的店铺昵称', shopName, 254 * HS, 672 * HS, 660 * HS, 73 * HS, { fontSize: 48 * HS, lineHeight: 65 * HS, color: '#FFFFFF', source: confirmed ? 'screenshot.shopName' : 'preview-label' });

  let y = signHeight;
  const benefitsHeight = 70;
  add('platform_benefits', 'page', '会员权益与积分商城固定区域', 0, y, WIDTH, benefitsHeight, 'container', 'fixed-platform-ui');
  rect('platform_benefits.background', 'platform_benefits', '薄浅米色权益横条', 0, y, WIDTH, benefitsHeight, '#FCF8F1');
  const benefit = (id, label, symbol, x) => {
    add(id, 'platform_benefits', '平台权益入口', x, y, WIDTH / 2, benefitsHeight, 'container', 'fixed-platform-ui');
    icon(`${id}.icon`, id, '小号橙色线框图标', symbol, x + 17, y + 24, 21, 21);
    text(`${id}.label`, id, '平台入口名称', label, x + 48, y + 25, 91, 20, { fontSize: 12, lineHeight: 18, color: '#876C4F' });
    icon(`${id}.arrow`, id, '浅色细箭头', 'arrow', x + 157, y + 28, 11, 15, '#CFBAA3');
  };
  benefit('platform_benefits.membership', '会员权益', 'membership', 0);
  benefit('platform_benefits.points', '积分商城', 'gift', WIDTH / 2);
  rect('platform_benefits.divider', 'platform_benefits', '权益细分隔线', WIDTH / 2, y + 22, .6, 26, '#EDE4D8');
  y += benefitsHeight;

  const navigation = unique(products.map(p => p.category).filter(v => v && !['商品', '未知', '全部商品', '全部'].includes(v))).slice(0, 3);
  for (const label of ['商品展示', '店内商品', '商品分类']) { if (navigation.length >= 3) break; if (!navigation.includes(label)) navigation.push(label); }
  navigation.push('全部');
  const navHeight = 106, navCell = WIDTH / 4, diameter = WIDTH * .15;
  add('navigation', 'page', '四个等大正圆导航与图下标签', 0, y, WIDTH, navHeight);
  rect('navigation.background', 'navigation', '固定白色导航背景', 0, y, WIDTH, navHeight, '#FFFFFF');
  navigation.forEach((label, i) => {
    const id = `navigation.entry_${i + 1}`, x = i * navCell, product = products.find(p => p.category === label) || products[i % products.length];
    add(id, 'navigation', '固定四列导航入口', x, y, navCell, navHeight, 'container', `screenshot.${product.id}`);
    image(`${id}.image`, id, '固定直径正圆导航图片', product, x + (navCell - diameter) / 2, y + 14, diameter, diameter, { radius: diameter / 2, background: '#F6F4EF' });
    text(`${id}.label`, id, '圆图下方导航标签', label, x + 3, y + 77, navCell - 6, 18, { fontSize: 11, lineHeight: 16, align: 'center', source: 'screenshot.categories-or-generic-label' });
  });
  y += navHeight;

  const heroTop = y, heroHeight = WIDTH * 3 / 4;
  add('hero', 'page', '4:3 贴边直角轮播', 0, y, WIDTH, heroHeight, 'container', 'fixed-platform-ui');
  add('hero.image', 'hero', '轮播图片完整展示商品，不增设图外标题', 0, y, WIDTH, heroHeight, 'image', options.bannerSource === 'source-composite' ? 'source-composite' : 'generated', { file: 'banner.png', background: colors.background, radius: 0 });
  add('hero.indicators', 'hero', '原样板图内轮播指示点；静态UI示意', WIDTH / 2 - 12, y + heroHeight - 15, 24, 5, 'container', 'fixed-platform-ui');
  for (let i = 0; i < 3; i++) rect(`hero.indicators.dot_${i + 1}`, 'hero.indicators', '图内轮播指示点', WIDTH / 2 - 11 + i * 9, y + heroHeight - 15, 4, 4, i === 0 ? '#FFFFFF' : '#D2D2D2', { radius: 2 });
  const panels = [{ id: 'hero', file: 'hero-panel.png', label: '轮播区域', y, height: heroHeight }];
  y += heroHeight;

  const separator = .7, posterWidth = (WIDTH - separator * 2) / 3, posterHeight = posterWidth * 1.3, posterTop = y + separator;
  rect('hero.poster_separator', 'page', '轮播与海报之间细白线', 0, y, WIDTH, separator, '#FFFFFF');
  add('posters', 'page', '三列等宽等高竖海报，无外边距，仅细白线', 0, posterTop, WIDTH, posterHeight, 'container', 'fixed-platform-ui');
  rect('posters.background', 'posters', '海报细白色分隔背景', 0, posterTop, WIDTH, posterHeight, '#FFFFFF');
  const posterPlan = design.posters || options.design?.posters;
  const sectionPosters = (design.sections || []).filter(section => section.kind === 'poster').flatMap(section => section.productIds || []);
  const posterIds = Array.isArray(posterPlan) ? posterPlan.map(item => typeof item === 'string' ? item : item.productId || item.productIds?.[0]) : posterPlan?.productIds || sectionPosters;
  const selectedPosters = Array.from({ length: 3 }, (_, i) => byId(products, posterIds[i]) || products[i % products.length]);
  selectedPosters.forEach((product, i) => {
    const id = `posters.poster_${i + 1}`, x = i * (posterWidth + separator), fill = i === 1 ? colors.surface : colors.background;
    add(id, 'posters', '独立商品素材竖海报，不切分轮播图充数', x, posterTop, posterWidth, posterHeight, 'container', `source-composite.${product.id}`, { productId: product.id });
    rect(`${id}.background`, id, '海报内部设计底色', x, posterTop, posterWidth, posterHeight, fill);
    text(`${id}.category`, id, '海报品类短标题', product.category || '店内商品', x + 8, posterTop + 9, posterWidth - 16, 16, { fontSize: 10, lineHeight: 14, color: colors.accent, align: 'center', source: `screenshot.${product.id}.category` });
    rect(`${id}.accent`, id, '海报内部细装饰线', x + posterWidth / 2 - 9, posterTop + 29, 18, .7, colors.accent, { opacity: .4 });
    image(`${id}.image`, id, '完整商品等比放入，不裁切主体', product, x + 5, posterTop + 38, posterWidth - 10, posterHeight - 46, { background: fill });
  });
  panels.push({ id: 'feature', file: 'feature-panel.png', label: '三列海报', y: posterTop, height: posterHeight });
  y = posterTop + posterHeight;

  const catalogSection = (design.sections || []).find(section => section.kind === 'catalog');
  const catalogProducts = unique([...(catalogSection?.productIds || []), ...products.map(p => p.id)]).map(id => byId(products, id)).filter(Boolean).slice(0, 6);
  const catalogTop = y, side = WIDTH * .30, outer = 10, gap = (WIDTH - outer * 2 - side * 3) / 2;
  const cardHeight = side + 59, rows = Math.ceil(catalogProducts.length / 3), catalogHeight = 12 + rows * cardHeight + (rows - 1) * 10 + 10;
  add('catalog', 'page', '固定三列橱窗：方图、图下名称与购物车', 0, y, WIDTH, catalogHeight, 'container', 'fixed-platform-ui');
  rect('catalog.background', 'catalog', '固定白色橱窗背景', 0, y, WIDTH, catalogHeight, '#FFFFFF');
  catalogProducts.forEach((product, i) => {
    const id = `catalog.${product.id}`, x = outer + i % 3 * (side + gap), top = catalogTop + 12 + Math.floor(i / 3) * (cardHeight + 10);
    add(id, 'catalog', '三列商品卡片，不足三件不扩列', x, top, side, cardHeight, 'container', `screenshot.${product.id}`);
    image(`${id}.image`, id, '1:1 方形商品图；完整等比容纳', product, x, top, side, side, { background: '#FFFFFF', radius: 0 });
    text(`${id}.name`, id, '方图下方商品名；固定两行', product.name, x + 2, top + side + 6, side - 4, 30, { fontSize: 10.5, lineHeight: 14, maxLines: 2, source: `screenshot.${product.id}.name` });
    icon(`${id}.cart`, id, '信息区右下方购物车', 'cart', x + side - 22, top + side + 36, 19, 19, '#565656');
  });
  y += catalogHeight;
  panels.push({ id: 'catalog', file: 'catalog-panel.png', label: '商品橱窗', y: catalogTop, height: catalogHeight });
  page.h = Math.ceil(y); background.h = page.h;
  const heroComposition = design.hero.slots.map(slot => ({ ...slot, parent: 'hero.image', source: `screenshot.${slot.productId}`, constraint: '模型构图软约束；轮播外框及位置是程序硬约束', canvasBox: { x: slot.x / 100 * WIDTH, y: heroTop + slot.y / 100 * heroHeight, w: slot.w / 100 * WIDTH, h: slot.h / 100 * heroHeight }, outputPixelBox: { x: slot.x / 100 * WIDTH * SCALE, y: (heroTop + slot.y / 100 * heroHeight) * SCALE, w: slot.w / 100 * WIDTH * SCALE, h: slot.h / 100 * heroHeight * SCALE } }));
  return {
    version: 'assisted-v4-locked-ui', width: WIDTH, height: page.h, scale: SCALE, nodes, design, panels, navigation, heroComposition,
    sections: [{ id: 'posters', kind: 'poster', title: '三列海报', productIds: selectedPosters.map(p => p.id), source: 'source-composite', purpose: '三格分别用原商品素材排版，非三次独立生图' }, { id: 'catalog', kind: 'catalog', title: '商品橱窗', productIds: catalogProducts.map(p => p.id), source: 'screenshot' }],
    shopIdentity: { confirmed, source: options.shopIdentity?.source || 'unconfirmed', displayedName: shopName }, bannerCount: 1, requestedBannerCount: bannerCount,
    platformReferences: [{ source: 'scripts/decoration-mvp/current-page-spec.md', appliedTo: 'page', rule: '招牌→权益→四圆形导航→4:3轮播→三列竖海报→三列橱窗', kind: 'locked-user-approved-ui' }, { source: 'scripts/decoration-mvp/layout-acceptance.md', appliedTo: 'hero,posters,catalog', rule: '贴边直角、细白线、方形商品图、图下名称与购物车', kind: 'locked-user-approved-ui' }],
    limitations: ['使用已确认样板的真实招牌与原平台控件；样板搜索文字、认证标记、上新信息是静态参考，不代表读取了当前店铺状态。', '只替换昵称及首字头像；旧昵称处底色由相邻像素插值恢复，并非原始分层背景。', '轮播内部商品构图是模型软约束；模块与小组件位置、尺寸由程序固定。', '三列海报使用原商品分别排版，不冒充三次生图；商品较少时复用原商品。', '导航、轮播指示点、购物车是静态UI示意；未确认价格不补写。'],
  };
}

function wrappedLines(value, size, maxWidth, limit) {
  const units = ch => /[\u2e80-\uffff]/.test(ch) ? 1 : /[MW@#%]/.test(ch) ? .8 : /[il.,:;'!| ]/.test(ch) ? .3 : .57;
  const widthOf = value => Array.from(value).reduce((sum, ch) => sum + units(ch) * size, 0);
  const lines = []; let line = '', width = 0;
  for (const ch of Array.from(value)) { const weight = units(ch) * size; if (line && width + weight > maxWidth) { lines.push(line.trim()); line = ''; width = 0; } line += ch; width += weight; }
  if (line) lines.push(line.trim());
  if (lines.length <= limit) {
    if (lines.length >= 2 && /^[\u2e80-\uffff]$/.test(lines.at(-1))) { const previous = Array.from(lines.at(-2)); if (previous.length >= 4) { const moved = previous.splice(-2).join(''); lines[lines.length - 2] = previous.join(''); lines[lines.length - 1] = moved + lines.at(-1); } }
    return lines;
  }
  const result = lines.slice(0, limit), last = Array.from(result[limit - 1]);
  while (last.length && widthOf(last.join('')) + size > maxWidth) last.pop();
  result[limit - 1] = `${last.join('').trim()}…`; return result;
}

async function fixedHeader() {
  const { data, info } = await sharp(await readFile(HEADER_SOURCE)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== 1240 || info.height !== 880) throw new Error('固定招牌素材尺寸与已确认样板不一致');
  // Match build-header.ps1, keeping all pixels outside the old nickname intact.
  for (let x = 247; x <= 455; x++) {
    const upper = (663 * info.width + x) * info.channels, lower = (747 * info.width + x) * info.channels;
    for (let y = 664; y < 747; y++) {
      const mix = (y - 663) / 84, pixel = (y * info.width + x) * info.channels;
      for (let c = 0; c < 3; c++) data[pixel + c] = Math.round(data[upper + c] * (1 - mix) + data[lower + c] * mix);
      data[pixel + 3] = 255;
    }
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

const ICONS = {
  membership: '<path d="M5 7h14l-1 12H6L5 7Zm3 0V5h8v2M8 11l4 4 4-4"/>',
  gift: '<path d="M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9C4 9 5 2 8 4l4 5Zm0 0c8 0 7-7 4-5l-4 5Z"/>',
  arrow: '<path d="m8 4 8 8-8 8"/>',
  cart: '<path d="M2 4h3l3 12h11l3-9H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
};

/** Compose existing run assets, without model calls, inside the fixed registry. */
export async function render(analysis, dir, bannerCount = 1) {
  const spec = layout(analysis.products.length, bannerCount, { products: analysis.products, shopName: analysis.shopName, shopIdentity: analysis.shopIdentity, design: analysis.design, bannerSource: analysis.bannerSource });
  const parts = [], children = new Map(), prepared = new Map(), header = await fixedHeader();
  for (const node of spec.nodes) { if (!children.has(node.parent)) children.set(node.parent, []); children.get(node.parent).push(node); }
  const draw = async node => {
    const clip = `clip_${node.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    parts.push(`<defs><clipPath id="${clip}"><rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="${node.radius || 0}"/></clipPath></defs>`);
    if (node.kind === 'container') { parts.push(`<g id="${esc(node.id)}" clip-path="url(#${clip})">`); for (const child of children.get(node.id) || []) await draw(child); parts.push('</g>'); return; }
    if (node.kind === 'rect') { parts.push(`<rect id="${esc(node.id)}" x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="${node.radius || 0}" fill="${esc(node.fill)}" opacity="${node.opacity ?? 1}"/>`); return; }
    if (node.kind === 'text') {
      const values = wrappedLines(String(node.value || '').replace(/[\u0000-\u001f]/g, ' '), node.fontSize, Math.max(1, node.w - 2), Math.max(1, Math.min(node.maxLines, Math.floor(node.h / node.lineHeight))));
      const anchor = node.align === 'center' ? 'middle' : node.align === 'right' ? 'end' : 'start', x = node.x + (node.align === 'center' ? node.w / 2 : node.align === 'right' ? node.w : 0);
      parts.push(`<text id="${esc(node.id)}" font-size="${node.fontSize}" font-weight="${node.weight}" fill="${esc(node.color)}" text-anchor="${anchor}" clip-path="url(#${clip})">${values.map((line, i) => `<tspan x="${x}" y="${node.y + node.fontSize + i * node.lineHeight}">${esc(line)}</tspan>`).join('')}</text>`); return;
    }
    if (node.kind === 'icon') { parts.push(`<g id="${esc(node.id)}" clip-path="url(#${clip})"><g transform="translate(${node.x} ${node.y}) scale(${node.w / 24} ${node.h / 24})" fill="none" stroke="${esc(node.color)}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${ICONS[node.symbol] || ''}</g></g>`); return; }
    if (node.kind === 'image') {
      const key = `${node.file}:${JSON.stringify(node.sourceRect)}:${node.w}:${node.h}:${node.background}`;
      if (!prepared.has(key)) {
        let pipeline = sharp(node.file === '@fixed-header' ? header : await readFile(`${dir}/${node.file}`));
        if (node.sourceRect) pipeline = pipeline.extract(node.sourceRect);
        const buffer = await pipeline.resize(Math.max(1, Math.round(node.w * SCALE)), Math.max(1, Math.round(node.h * SCALE)), { fit: node.fit, background: node.background }).png().toBuffer();
        prepared.set(key, buffer.toString('base64'));
      }
      parts.push(`<image id="${esc(node.id)}" x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" href="data:image/png;base64,${prepared.get(key)}" preserveAspectRatio="xMidYMid meet" clip-path="url(#${clip})"/>`); return;
    }
    throw new Error(`未知布局节点 ${node.kind}`);
  };
  await draw(spec.nodes[0]);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH * SCALE}" height="${spec.height * SCALE}" viewBox="0 0 ${WIDTH} ${spec.height}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif">${parts.join('')}</svg>`;
  await writeFile(`${dir}/preview.svg`, svg);
  const preview = await sharp(Buffer.from(svg)).png().toBuffer();
  await writeFile(`${dir}/preview.png`, preview);
  const artifacts = [{ file: 'preview.png', label: '完整装修长图' }];
  for (const panel of spec.panels) {
    const top = Math.max(0, Math.floor(panel.y * SCALE)), bottom = Math.min(spec.height * SCALE, Math.ceil((panel.y + panel.height) * SCALE));
    await sharp(preview).extract({ left: 0, top, width: WIDTH * SCALE, height: bottom - top }).png().toFile(`${dir}/${panel.file}`);
    artifacts.push({ file: panel.file, label: panel.label });
  }
  spec.artifacts = artifacts;
  await writeFile(`${dir}/layout.json`, JSON.stringify(spec, null, 2));
  await writeFile(`${dir}/design.json`, JSON.stringify({ ...spec.design, sections: spec.sections, source: '在已确认固定UI内规划图片内容', shopIdentity: spec.shopIdentity, bannerSource: analysis.bannerSource || 'generated', productCount: analysis.products.length, navigation: spec.navigation, heroComposition: spec.heroComposition, artifacts, rules: spec.limitations }, null, 2));
  return spec;
}

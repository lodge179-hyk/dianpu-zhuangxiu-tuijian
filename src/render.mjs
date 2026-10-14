/**
 * 渲染层：把「计划 + 素材」交给固定组件库渲染成完整页面。
 *
 * 关键点：模块的布局、尺寸、位置全部由组件库的冻结样式决定，程序不参与排版决策；
 * 这里只做一件事——把计划里的 slotId 换成真实图片路径，再调用 renderPage。
 * 这样「AI 的选择」与「稳定的呈现」是分离的：换店铺只换计划，页面骨架不变。
 */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from './analyze.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const LIB = path.resolve(here, '../vendor-component-library/lib');
const library = require(path.join(LIB, 'index.cjs'));

/** 把 slotId 换成相对 output 目录的素材路径。 */
function resolveValue(value, assetsBySlot, missing, slotIds) {
  if (typeof value !== 'string') return value;
  if (assetsBySlot.has(value)) return `assets/${assetsBySlot.get(value).file}`;
  if (slotIds.has(value)) missing.add(value);
  return value;
}

function deepResolve(node, assetsBySlot, missing, slotIds) {
  if (Array.isArray(node)) return node.map(item => deepResolve(item, assetsBySlot, missing, slotIds));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(node)) out[key] = deepResolve(child, assetsBySlot, missing, slotIds);
    return out;
  }
  return resolveValue(node, assetsBySlot, missing, slotIds);
}

/**
 * 组件库对模块内容的字段名是严格白名单，内部标记字段不能传进去。
 * 这里在渲染前剥离我们自己加的元数据，元数据仍然保留在计划与清单里供用户查看。
 */
const INTERNAL_KEYS = new Set(['priceNote', 'titlePriceMarkRemoved', 'note', 'accurate']);
function stripInternal(node) {
  if (Array.isArray(node)) { node.forEach(stripInternal); return; }
  if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      if (INTERNAL_KEYS.has(key)) delete node[key];
      else stripInternal(node[key]);
    }
  }
}

/**
 * @param {object} plan 已校验的计划
 * @param {Map<string, {file:string}>} assetsBySlot slotId -> 素材
 * @param {string} outDir 输出目录（HTML 与 assets 子目录所在）
 */
export async function renderPlan(plan, assetsBySlot, outDir, log = () => {}) {
  const missing = new Set();
  // 本次计划里声明过的全部槽位编号。只有确定属于本计划的这些字符串才会被换成素材或占位图，
  // 不用正则去猜——否则文件名恰好形似编号时会被误替换。
  const slotIds = new Set((plan.validation?.slots || []).map(s => s.slotId));
  if (!slotIds.size) {
    const scan = node => {
      if (typeof node === 'string') { if (/^[\w-]+\.img\d+$/.test(node)) slotIds.add(node); return; }
      if (Array.isArray(node)) { node.forEach(scan); return; }
      if (node && typeof node === 'object') Object.values(node).forEach(scan);
    };
    plan.modules.forEach(m => scan(m.content));
  }

  const modules = plan.modules.map(m => ({
    id: m.id,
    type: m.type,
    label: m.label,
    content: deepResolve(m.content, assetsBySlot, missing, slotIds),
    options: m.options || {},
  }));
  modules.forEach(m => stripInternal(m.content));

  // 缺图时保持布局可用：组件库要求图片字段存在，用一张明确的占位图顶上并标注
  if (missing.size) {
    const placeholder = await makePlaceholder(outDir);
    for (const module_ of modules) fillMissing(module_, placeholder, slotIds);
    log(`有 ${missing.size} 个槽位缺图，已用标注占位图保持布局`);
  }

  const page = { width: 483, title: `${plan.design.title} · 装修预览`, modules };
  let result;
  try {
    result = library.renderPage(page);
  } catch (error) {
    throw new AppError('固定模块渲染失败，计划里可能有模块内容不符合组件库要求。', { stage: 'render', hint: error.message });
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'preview.html'), result.html);

  // 每个图片槽位在页面上的真实位置（供清单与对照使用）
  const photos = result.photos.map(p => ({
    id: p.id,
    moduleId: p.moduleId,
    rect: p.rect.map(v => Math.round(v * 100) / 100),
    src: p.src,
  }));

  log(`已渲染完整页面 ${result.width}×${Math.round(result.height)}px，${result.moduleCount} 个模块，${photos.length} 个图片位`);
  return {
    html: result.html,
    htmlFile: path.join(outDir, 'preview.html'),
    width: result.width,
    height: Math.round(result.height * 100) / 100,
    moduleCount: result.moduleCount,
    components: result.components.map(c => ({ id: c.id, role: c.role, moduleId: c.moduleId, rect: c.rect.map(v => Math.round(v * 100) / 100) })),
    photos,
    missingSlots: [...missing],
  };
}

function fillMissing(node, placeholder, slotIds) {
  if (Array.isArray(node)) { node.forEach((item, i) => { if (typeof item === 'string' && slotIds.has(item)) node[i] = placeholder; else fillMissing(item, placeholder, slotIds); }); return; }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string' && slotIds.has(value)) node[key] = placeholder;
      else fillMissing(value, placeholder, slotIds);
    }
  }
}

async function makePlaceholder(outDir) {
  const sharp = require('sharp');
  await mkdir(path.join(outDir, 'assets'), { recursive: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
    <rect width="400" height="400" fill="#EDEAE4"/>
    <rect x="8" y="8" width="384" height="384" fill="none" stroke="#C9C2B6" stroke-width="3" stroke-dasharray="12 10"/>
    <text x="200" y="196" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="30" fill="#8A8375">图片缺失</text>
    <text x="200" y="236" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="20" fill="#A79F92">这一格没有拿到素材</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(outDir, 'assets', '_missing.png'));
  return 'assets/_missing.png';
}

/** 交付清单：模块顺序 + 每个图片位对应哪个文件、放到微购的哪个模块。 */
export function buildManifest(plan, rendered, assets, shop) {
  const assetsBySlot = new Map(assets.map(a => [a.slotId, a]));
  const modules = plan.modules.map(m => {
    const slots = [];
    for (const photo of rendered.photos.filter(p => p.moduleId === m.id)) {
      const asset = assetsBySlot.get(photo.id);
      if (!asset) continue;
      slots.push({
        slotId: photo.id,
        role: photo.id.split('.').pop(),
        file: `assets/${asset.file}`,
        source: asset.source,
        subject: asset.subject,
        pageRect: photo.rect,
        slotPixels: asset.slotPixels,
        deliveredPixels: asset.deliveredPixels,
        nativePixels: asset.nativePixels,
        upscaled: !!asset.upscaled,
        note: asset.note || '',
      });
    }
    return {
      order: plan.modules.indexOf(m) + 1,
      id: m.id,
      type: m.type,
      label: m.label,
      reason: m.reason,
      photoCount: slots.length,
      slots,
      ...(Array.isArray(m.content?.items) ? { items: m.content.items.map(i => ({ title: i.title, price: i.price ?? null, currency: i.currency ?? null })) } : {}),
      ...(m.content?.text ? { text: m.content.text } : {}),
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    shop: { name: shop?.shopName || '', category: shop?.category || '', positioning: shop?.positioning || '' },
    design: plan.design,
    page: { width: rendered.width, height: rendered.height, htmlFile: 'preview.html' },
    modules,
    assetFiles: assets.map(a => ({
      slotId: a.slotId, file: `assets/${a.file}`, source: a.source, subject: a.subject,
      deliveredPixels: a.deliveredPixels, nativePixels: a.nativePixels, upscaled: !!a.upscaled,
      separatorPixels: a.separatorPixels ?? null, removedAreaPercent: a.removedAreaPercent ?? null,
      reliability: a.reliability ?? null, note: a.note || '',
    })),
    howToUse: [
      '打开 preview.html 看整体效果（页面宽度 483px，与真实店铺页面一致）。',
      '在微购相册装修后台，按下面 modules 的顺序依次添加对应模块。',
      '每个模块的每个图片位，上传同一行 slots 里对应 file 的文件。',
      '商品名称可以直接用 items 里的 title；没有可靠价格就不要填价格。',
    ],
  };
}

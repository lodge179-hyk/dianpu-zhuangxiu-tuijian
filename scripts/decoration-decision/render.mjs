// Fill the fixed a9 modules with the produced assets and render the full page.
// Failed slots degrade honestly: substitution from the ready pool (generated
// assets + real product crops), item drop, module drop — all recorded.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { renderPage } = require('../../experiments/store-decoration/a9-component-library/lib/index.cjs');

const sameRatio = (a, b) => Math.abs(a[0] / a[1] - b[0] / b[1]) < 0.02;
// slotRects entries are full [x,y,w,h] rects; ratios compare width/height only.
const slotWH = (m, slot) => {
  const r = m.catalog.slotRects[Math.min(slot, m.catalog.slotRects.length) - 1];
  return r ? [r[2], r[3]] : [1, 1];
};

function resolveSlots(plan, degradations) {
  const ready = plan.assets.filter(a => a.status === 'ready');
  const fileOf = new Map(ready.map(a => [a.id, a.file]));
  // Substitution pool: every ready image is a square, so any can back any slot.
  const pool = [
    ...ready.map(a => ({ file: a.file, label: `${a.use}`, ratio: a.ratio })),
    ...plan.products.filter(p => p.status === 'ready').map(p => ({ file: p.file, label: `商品「${p.name}」`, ratio: p.ratio })),
  ];
  const useCount = new Map();
  const slotAsset = new Map(); // "moduleId.slot" -> file|null|undefined( needs substitution)

  const productFile = idx => (idx && plan.products[idx - 1]?.status === 'ready' ? plan.products[idx - 1].file : null);

  for (const m of plan.modules) {
    for (const f of m.fills) {
      const key = `${m.id}.${f.slot}`;
      if (f.source === 'product') {
        const file = productFile(f.productIdx);
        if (file) { slotAsset.set(key, file); useCount.set(file, (useCount.get(file) || 0) + 1); }
        else { degradations.push(`「${m.label}」槽位 ${f.slot} 的商品照片不可用，已改为替代素材。`); slotAsset.set(key, undefined); }
        continue;
      }
      if (f.source === 'reuse' && f.reuseKey) {
        const targetFile = slotAsset.get(f.reuseKey);
        const ratio = slotWH(m, f.slot);
        const targetAsset = ready.find(a => a.file === targetFile);
        if (targetFile && targetAsset && sameRatio(targetAsset.ratio, ratio)) {
          slotAsset.set(key, targetFile);
          useCount.set(targetFile, (useCount.get(targetFile) || 0) + 1);
        } else {
          degradations.push(`「${m.label}」槽位 ${f.slot} 的复用目标不可用，已改为替代素材。`);
          slotAsset.set(key, undefined);
        }
        continue;
      }
      const assetId = f.assetId;
      if (assetId && fileOf.has(assetId)) {
        const file = fileOf.get(assetId);
        slotAsset.set(key, file);
        useCount.set(file, (useCount.get(file) || 0) + 1);
      } else {
        slotAsset.set(key, undefined);
      }
    }
  }
  // pass 2: substitute every unresolved slot with the least-used pool image
  for (const m of plan.modules) {
    for (const f of m.fills) {
      const key = `${m.id}.${f.slot}`;
      if (slotAsset.get(key) !== undefined) continue;
      const ratio = slotWH(m, f.slot);
      const candidates = pool
        .filter(p => sameRatio(p.ratio, ratio))
        .sort((a, b) => (useCount.get(a.file) || 0) - (useCount.get(b.file) || 0));
      const sub = candidates[0];
      if (sub) {
        slotAsset.set(key, sub.file);
        useCount.set(sub.file, (useCount.get(sub.file) || 0) + 1);
        degradations.push(`「${m.label}」槽位 ${f.slot} 的原定素材未能生成，已用${sub.label}替代，画面主体可能与原计划不同。`);
      } else {
        slotAsset.set(key, null);
      }
    }
  }
  return slotAsset;
}

export function renderStore(plan, dir) {
  const degradations = [];
  const slotAsset = resolveSlots(plan, degradations);
  const modulesOut = [];

  for (const m of plan.modules) {
    const slotCount = m.catalog.imageSlots;
    const fileFor = slot => slotAsset.get(`${m.id}.${slot}`);
    const content = {};
    let keep = true;
    let type = m.type;

    if (m.family === 'signboard') {
      // a9 requires all shop fields to exist, even when empty.
      const shop = { name: (m.shop?.name || '店铺预览').slice(0, 20), avatar: 'avatar.png', vip: false, newCount: String(m.shop?.newCount || '').slice(0, 10), totalCount: String(m.shop?.totalCount || '').slice(0, 10) };
      const bg = slotCount ? fileFor(1) : null;
      if (type === 'signboard.default') {
        if (!bg || !m.shop?.newCount || !m.shop?.totalCount) {
          type = 'signboard.minimal';
          degradations.push(bg ? '招牌数据（上新/总数）缺失，默认招牌已降级为极简招牌。' : '招牌背景图未生成，默认招牌已降级为极简招牌。');
        } else {
          content.background = bg;
          Object.assign(shop, { vip: false, newCount: String(m.shop.newCount).slice(0, 10), totalCount: String(m.shop.totalCount).slice(0, 10) });
        }
      }
      if (type === 'signboard.minimal' || type === 'signboard.classic') content.shop = shop;
      else if (type === 'signboard.fullscreen') {
        if (!bg) { keep = false; degradations.push('全屏招牌背景图未生成且无替代素材，该模块已移除。'); }
        else { content.background = bg; content.shop = shop; }
      } else if (type === 'signboard.default') content.shop = shop;
    } else if (m.family === 'text') {
      const text = (m.text || '').replace(/[\u0000-\u001f]/g, ' ').trim();
      if (!text) { keep = false; degradations.push(`「${m.label}」缺少文案，该模块已移除。`); }
      else content.text = text.slice(0, type === 'text.multiline' ? 120 : 40);
    } else if (m.family === 'showcase') {
      const items = [];
      for (const f of m.fills) {
        const file = fileFor(f.slot);
        const meta = m.items.find(it => Number(it.slot) === f.slot) || {};
        const title = (meta.title || '').trim() || '店铺商品';
        if (!file) { degradations.push(`「${m.label}」商品「${title}」的图片不可用，该商品卡已移除。`); continue; }
        const price = meta.price ?? '';
        items.push({ image: file, title: title.replace(/\s+/g, ' ').slice(0, 40), price, currency: price ? '$' : '' });
      }
      if (!items.length) { keep = false; degradations.push(`「${m.label}」没有可用商品卡，该模块已移除。`); }
      else content.items = items.slice(0, slotCount);
    } else {
      const images = m.fills.map(f => fileFor(f.slot)).filter(Boolean).map(src => ({ src }));
      const min = type.startsWith('poster.combo') ? 3 : (m.family === 'navigation' ? 3 : 1);
      if (images.length < Math.min(min, slotCount)) { keep = false; degradations.push(`「${m.label}」可用图片不足（${images.length}/${slotCount}），该模块已移除。`); }
      else content.images = images;
    }
    if (keep) modulesOut.push({ id: m.id, type, label: m.label, content, options: type === 'showcase.two' ? { singleLineTitles: true } : {} });
  }

  if (!modulesOut.length) throw Object.assign(new Error('所有模块都因素材或内容缺失被移除，无法渲染页面。'), { phase: 'render' });
  const page = { width: 483, title: `${plan.design.title} · 店铺装修方案`, modules: modulesOut };
  const result = renderPage(page);
  fs.writeFileSync(path.join(dir, 'page.json'), JSON.stringify(page, null, 2));
  fs.writeFileSync(path.join(dir, 'shop.html'), result.html);
  const slotMap = plan.modules.flatMap(m => m.fills.map(f => {
    const asset = plan.assets.find(a => a.id === f.assetId);
    const product = f.source === 'product' && f.productIdx ? plan.products[f.productIdx - 1] : null;
    const finalFile = slotAsset.get(`${m.id}.${f.slot}`) || null;
    return {
      moduleId: m.id, moduleLabel: m.label, slot: f.slot,
      plannedSource: f.source,
      assetId: f.assetId || null,
      file: finalFile,
      ratio: asset ? `${asset.ratio[0]}:${asset.ratio[1]}` : (product ? '1:1' : ''),
      status: finalFile ? (f.source === 'product' ? (productFileMatches(product, finalFile) ? 'ready' : 'substituted') : (asset?.status === 'ready' && asset.file === finalFile ? 'ready' : 'substituted')) : 'missing',
      note: asset?.note || '',
    };
  }));
  return { html: 'shop.html', width: result.width, height: result.height, moduleCount: result.moduleCount, photoSlots: result.photos.length, slotMap, degradations };
}

const productFileMatches = (product, file) => !!product && product.file === file;

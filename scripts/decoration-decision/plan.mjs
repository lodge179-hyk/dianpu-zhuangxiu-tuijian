// Turn the AI's design decision into a validated, executable plan.
// Showcase slots are filled with real product crops (source 'product');
// navigation/poster/carousel slots become generate assets planned as uniform
// squares so one regular sheet grid can carry them all.
const MODULE_CAP = 12;
const GENERATE_CAP = 8;

const clean = (value, fallback = '', length = 100) => String(value ?? fallback).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, length);

export function buildPlan(decision, analysis, catalog) {
  const degradations = [];
  const byType = new Map(catalog.map(c => [c.type, c]));
  // Products that actually have a croppable photo, reindexed product_1..M.
  const usableProducts = analysis.products.filter(p => p.box);
  const products = usableProducts.map((p, i) => ({
    id: `product_${i + 1}`, oldId: p.id, name: p.name,
    file: `product-${i + 1}.png`, ratio: [1, 1], status: 'pending', note: '',
  }));
  const productIdMap = new Map(usableProducts.map((p, i) => [p.id, i + 1]));
  let productCursor = 0;
  const nextProductIdx = () => (products.length ? (productCursor++ % products.length) + 1 : null);

  // --- normalize AI modules ---
  const rawModules = Array.isArray(decision.modules) ? decision.modules : [];
  const modules = [];
  let droppedUnknown = 0;
  let hadSignboard = false;
  for (const raw of rawModules) {
    if (modules.length >= MODULE_CAP) { degradations.push(`模块数量超出上限，已丢弃「${clean(raw.label || raw.type, '未命名', 20)}」及之后的模块。`); break; }
    const type = String(raw.type || '');
    if (type.startsWith('signboard')) { hadSignboard = true; continue; }
    const entry = byType.get(type);
    if (!entry) { droppedUnknown++; continue; }
    let id = /^[A-Za-z][\w-]*$/.test(String(raw.id || '')) ? String(raw.id) : '';
    if (!id || modules.some(m => m.id === id)) id = 'm' + String(modules.length + 1).padStart(2, '0');
    modules.push({
      id, type: entry.type, family: entry.family,
      label: clean(raw.label, entry.usage.split('：')[0], 20),
      reason: clean(raw.reason, '', 160),
      catalog: entry,
      text: typeof raw.text === 'string' ? raw.text : '',
      items: Array.isArray(raw.items) ? raw.items.filter(it => it && typeof it === 'object') : [],
      fills: Array.isArray(raw.fills) ? raw.fills.filter(f => f && typeof f === 'object') : [],
    });
  }
  if (droppedUnknown) degradations.push(`有 ${droppedUnknown} 个模块使用了目录之外的类型，已从方案中剔除。`);
  if (hadSignboard) degradations.push('页首招牌由程序统一提供（极简版），AI 给出的招牌模块已忽略。');

  // --- signboard is always program-controlled (minimal, no image slot) ---
  const sbEntry = byType.get('signboard.minimal');
  modules.unshift({
    id: 'sb0', type: 'signboard.minimal', family: 'signboard',
    label: '店铺招牌', reason: '页首招牌，展示店名与头像。',
    catalog: sbEntry, shop: { name: analysis.shopName }, text: '', items: [], fills: [],
  });
  if (modules.length < 5) throw Object.assign(new Error(`AI 决策只给出 ${modules.length - 1} 个有效模块，不足以组成店铺页面，请重试。`), { phase: 'decide' });

  // --- per-family fill normalization ---
  for (const m of modules) {
    const slotCount = m.catalog.imageSlots;
    const aiFill = slot => m.fills.find(f => Number(f.slot) === slot) || m.fills[slot - 1];

    if (!slotCount) { m.fills = []; continue; }

    if (m.family === 'navigation') {
      // icon tiles are generated (square)
      m.fills = Array.from({ length: slotCount }, (_, i) => {
        const f = aiFill(i + 1) || {};
        return { slot: i + 1, source: 'generate', reuseKey: '', prompt: clean(f.prompt, '', 200), auto: !clean(f.prompt, '', 200) };
      });
    } else if (m.family === 'showcase') {
      // real product photos, chosen by the AI per slot or round-robin
      const items = [];
      m.fills = Array.from({ length: slotCount }, (_, i) => {
        const slot = i + 1;
        const it = m.items.find(x => Number(x.slot) === slot) || m.items[i] || {};
        const refRaw = typeof it.product === 'string' ? it.product : (typeof it.productRef === 'string' ? it.productRef : '');
        let productIdx = productIdMap.get(refRaw.trim()) || (Number.isInteger(it.productIdx) ? it.productIdx : null);
        if (productIdx && (productIdx < 1 || productIdx > products.length)) productIdx = null;
        if (!productIdx && products.length) productIdx = nextProductIdx();
        const title = clean(it.title, '', 40);
        if (title) items.push({ slot, title, price: /^\d{1,6}(\.\d{1,2})?$/.test(String(it.price ?? '')) ? String(it.price) : '', productIdx });
        return { slot, source: 'product', productIdx, reuseKey: '', prompt: '', auto: false };
      });
      m.items = items;
    } else {
      // poster / carousel: AI-planned generate slots, missing slots auto-filled
      const seen = new Set();
      const normalized = [];
      m.fills.forEach((f, i) => {
        let slot = Number.isInteger(f.slot) ? f.slot : i + 1;
        if (slot < 1) slot = 1;
        if (slot > slotCount || seen.has(slot)) return;
        seen.add(slot);
        const source = f.source === 'reuse' ? 'reuse' : 'generate';
        normalized.push({ slot, source, reuseKey: typeof f.reuseKey === 'string' ? f.reuseKey : '', prompt: clean(f.prompt, '', 200), auto: source === 'generate' && !clean(f.prompt, '', 200) });
      });
      for (let s = 1; s <= slotCount; s++) {
        if (!seen.has(s)) { seen.add(s); normalized.push({ slot: s, source: 'generate', reuseKey: '', prompt: '', auto: true }); }
      }
      normalized.sort((a, b) => a.slot - b.slot);
      m.fills = normalized;
    }
  }

  // --- reuse resolution: target must be a generate fill of another module ---
  const generateFills = [];
  for (const m of modules) for (const f of m.fills) if (f.source === 'generate' && !f.reuseKey) generateFills.push({ m, f });
  for (const m of modules) for (const f of m.fills) {
    if (f.source !== 'reuse' || !f.reuseKey) continue;
    const [mid, slotRaw] = String(f.reuseKey).split('.');
    const target = generateFills.find(g => g.m.id === mid && g.f.slot === Number(slotRaw));
    if (!target) {
      f.source = 'generate'; f.reuseKey = ''; f.prompt = ''; f.auto = true;
      degradations.push(`「${m.label}」槽位 ${f.slot} 的复用指向无效，已改为生成素材。`);
    }
  }

  // --- generate cap: overflow falls back to product photos ---
  const allGenerate = [];
  for (const m of modules) for (const f of m.fills) if (f.source === 'generate' && !f.reuseKey) allGenerate.push({ m, f });
  if (allGenerate.length > GENERATE_CAP) {
    for (const { m, f } of allGenerate.slice(GENERATE_CAP)) {
      f.source = 'product'; f.productIdx = nextProductIdx(); f.prompt = '';
      degradations.push(`「${m.label}」槽位 ${f.slot} 超出生图数量上限，已改用商品照片填充。`);
    }
  }
  if (!products.length) {
    // no usable products at all: product fills have nothing to reference
    for (const m of modules) for (const f of m.fills) {
      if (f.source === 'product') { f.source = 'generate'; f.prompt = f.prompt || `与店铺品类一致的干净商品摄影画面。`; f.auto = true; }
    }
    degradations.push('截图中没有可用的商品照片，橱窗槽位已改为生成素材。');
  }

  // --- flatten generate assets (all planned as 1:1 squares) ---
  const assets = [];
  let assetSeq = 0;
  for (const m of modules) for (const f of m.fills) {
    if (f.source !== 'generate') continue;
    assetSeq++;
    const id = 'a' + String(assetSeq).padStart(2, '0');
    f.assetId = id;
    assets.push({
      id, moduleId: m.id, slot: f.slot,
      ratio: [1, 1],
      use: m.label + (m.catalog.imageSlots > 1 ? ` · 槽位 ${f.slot}` : ''),
      prompt: f.prompt,
      auto: !!f.auto,
      status: 'pending',
    });
  }
  return { design: sanitizeDesign(decision.design, analysis), modules, assets, products, degradations };
}

function sanitizeDesign(design, analysis) {
  const hex = (v, fb) => /^#[\da-f]{6}$/i.test(v || '') ? v.toUpperCase() : fb;
  return {
    title: clean(design?.title, analysis.design.title, 28),
    summary: clean(design?.summary, analysis.design.summary, 180),
    style: clean(design?.style, analysis.style, 500),
    palette: Object.fromEntries(Object.entries(analysis.design.palette).map(([k, v]) => [k, hex(design?.palette?.[k], v)])),
  };
}

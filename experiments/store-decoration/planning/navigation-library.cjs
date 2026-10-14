const fs = require('fs');
const path = require('path');
const { entries } = require('./catalog.cjs');

const root = path.join(__dirname, 'navigation-library');
const categories = [
  { id: 'tops', name: '上衣', aliases: ['上衣', 'T恤', 'T-shirt', 'T-shirts', 'tee', 'tops'] },
  { id: 'shirts', name: '衬衫', aliases: ['衬衫', '衬衣', 'shirt', 'shirts'] },
  { id: 'pants', name: '裤装', aliases: ['裤装', '裤子', '长裤', 'pants', 'trousers'] },
  { id: 'dresses', name: '连衣裙', aliases: ['连衣裙', '裙装', 'dress', 'dresses'] },
];
const styles = [{ id: 'clean', name: '冷白简约' }, { id: 'warm', name: '暖色自然' }];
const assets = styles.flatMap(style => categories.map(category => ({
  id: `${style.id}-${category.id}-v1`, categoryId: category.id, styleId: style.id,
  file: `${style.id}-${category.id}-v1.png`,
})));
const normalize = label => label.normalize('NFKC').toLowerCase().replace(/[\s·_-]/g, '');
const categoryFor = label => categories.find(c => c.aliases.some(alias => normalize(alias) === normalize(label)));
const assetFile = id => { const asset = assets.find(a => a.id === id); return asset ? path.join(root, asset.file) : null; };

function selectStyle(plan) {
  const requested = plan.navigationLibrary?.style || 'auto';
  if (requested !== 'auto') return { id: requested, reason: '按方案指定的导航风格选择' };
  // A deliberately small, inspectable fallback. The planner can choose a style
  // explicitly when the first palette color does not represent the background.
  const color = plan.style.palette[0];
  const rgb = color.slice(1).match(/../g).map(v => parseInt(v, 16));
  const warm = rgb[0] - rgb[2] >= 12 && rgb[0] >= rgb[1] && Math.max(...rgb) >= 180;
  return { id: warm ? 'warm' : 'clean', reason: warm ? `按主色 ${color} 的明亮暖色倾向选择` : `按主色 ${color} 选择中性简约底图` };
}

function resolveNavigation(plan, exists = fs.existsSync) {
  if (!plan.navigationLibrary) return { enabled: false, matched: [], unmatched: [] };
  const style = selectStyle(plan), candidates = new Map(), unmatched = [], matched = [];
  for (const module of plan.modules.filter(m => m.type.startsWith('navigation.'))) {
    module.props.assetIds.forEach((assetId, index) => {
      const label = module.props.labels[index], category = categoryFor(label);
      const list = candidates.get(assetId) || [];
      list.push({ moduleId: module.id, label, categoryId: category?.id }); candidates.set(assetId, list);
    });
  }
  for (const [assetId, uses] of candidates) {
    let reason;
    if (uses.some(use => !use.categoryId)) reason = '分类尚未覆盖，保留本店生成计划';
    else if (new Set(uses.map(use => use.categoryId)).size !== 1) reason = '同一素材对应多个分类，保留本店生成计划';
    else if (plan.modules.some(m => m.props.assetIds.some((id, i) => id === assetId && !(m.type.startsWith('navigation.') || (m.type.startsWith('showcase.') && entries[m.type].slots[i].width <= 200))))) reason = '素材同时用于大画面，保留独立生成计划';
    else if (plan.assets.find(a => a.id === assetId)?.aspect !== '1:1') reason = '非方形素材保留独立生成计划';
    const asset = assets.find(a => a.categoryId === uses[0].categoryId && a.styleId === style.id);
    if (!reason && (!asset || !exists(assetFile(asset.id)))) reason = '图库素材暂不可用，保留本店生成计划';
    if (reason) unmatched.push({ assetId, uses, reason });
    else matched.push({ assetId, libraryId: asset.id, categoryId: asset.categoryId, styleId: style.id, uses });
  }
  return { enabled: true, version: 1, style: { ...style, name: styles.find(s => s.id === style.id).name }, matched, unmatched };
}

function publicNavigationLibrary() {
  return { version: 1, categories, styles, assets: assets.map(a => ({ ...a, available: fs.existsSync(assetFile(a.id)), url: `/navigation-assets/${a.id}.png` })) };
}
module.exports = { categories, styles, assets, assetFile, categoryFor, selectStyle, resolveNavigation, publicNavigationLibrary };

const fs = require('fs');
const path = require('path');
const { renderPage } = require('../a9-component-library/lib/index.cjs');
const { validatePlan, buildBatches } = require('./plan.cjs');
const black = path.join(__dirname, '../a10-black-module-review/black.png');

function compose(folder, input) {
  const validated = validatePlan(input), { plan } = validated;
  fs.mkdirSync(path.join(folder, 'assets'), { recursive: true });
  for (const asset of plan.assets) {
    const target = path.join(folder, 'assets', asset.id + '.png');
    if (!fs.existsSync(target)) fs.copyFileSync(black, target);
  }
  if (!fs.existsSync(path.join(folder, 'assets/avatar.png'))) fs.copyFileSync(black, path.join(folder, 'assets/avatar.png'));
  const image = id => `assets/${id}.png`;
  const page = { width: 483, title: `${plan.shop.name} · 装修参考`, modules: plan.modules.map(m => {
    let content;
    if (m.type.startsWith('signboard.')) content = { ...(m.type === 'signboard.minimal' ? {} : { background: image(m.props.assetIds[0]) }), shop: { name: plan.shop.name, avatar: 'assets/avatar.png', vip: false, newCount: '—', totalCount: '—' } };
    else if (m.type.startsWith('text.')) content = { text: m.props.text };
    else if (m.type.startsWith('showcase.')) content = { items: m.props.assetIds.map((id, i) => ({ image: image(id), title: m.props.titles[i], price: '', currency: '' })) };
    else content = { images: m.props.assetIds.map((id, i) => ({ src: image(id), ...(m.type.startsWith('navigation.') ? { label: m.props.labels[i] } : {}) })) };
    return { id: m.id, type: m.type, label: m.purpose, content, options: {} };
  }) };
  const result = renderPage(page);
  fs.writeFileSync(path.join(folder, 'page.json'), JSON.stringify(page, null, 2));
  fs.writeFileSync(path.join(folder, 'shop.html'), result.html);
  const bindings = plan.modules.flatMap(m => result.photos.filter(p => p.moduleId === m.id).map((p, i) => ({ ...p, assetId: m.props.assetIds[i] })));
  const layout = { width: result.width, height: result.height, moduleCount: result.moduleCount, components: result.components, photos: bindings };
  fs.writeFileSync(path.join(folder, 'layout.json'), JSON.stringify(layout, null, 2));
  const batches = buildBatches(plan);
  for (const batch of batches) fs.writeFileSync(path.join(folder, `${batch.id}-prompt.txt`), batch.prompt);
  fs.writeFileSync(path.join(folder, 'generation-batches.json'), JSON.stringify(batches, null, 2));
  return { ...validated, layout: { width: result.width, height: result.height }, batches };
}
module.exports = { compose };

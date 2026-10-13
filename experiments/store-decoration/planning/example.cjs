const fs = require('fs');
const path = require('path');
const { compose } = require('./compose.cjs');
const base = path.join(__dirname, '../a13-complete-store');
function examplePlan() {
  const original = JSON.parse(fs.readFileSync(path.join(base, 'page.json'), 'utf8'));
  const aliases = { '01-banner': 'banner', '02-sweatshirt': 'sweatshirt', '03-tote': 'tote', '04-shoes': 'shoes', '05-coat': 'coat', '06-outfit': 'outfit', 'coat-square': 'coat', 'outfit-square': 'outfit', 'outfit-lower': 'outfit', 'medium-square': 'medium' };
  const assetId = value => { const name = path.basename(value, '.png'); return aliases[name] || name; };
  const subjects = [
    ['banner', '3:1', '燕麦色大衣、棕色手提包与浅色运动鞋的横幅', '横向留白，允许大衣下沿在画外'],
    ['sweatshirt', '1:1', '炭灰色圆领卫衣', '单件居中，主体完整'], ['tote', '1:1', '棕色手提包', '单件居中，清楚显示提手'], ['shoes', '1:1', '白蓝色运动鞋', '一双鞋居中'],
    ['coat', '3:4', '燕麦色长大衣', '竖向摄影，展示轮廓与面料'], ['outfit', '3:4', '米白针织衫与炭灰长裤搭配', '竖向搭配陈列，突出上下装关系'],
    ['signboard', '483:258', '外套、鞋包组成的店铺氛围背景', '主体在上方，下35%留给固定招牌信息'],
    ['medium', '4:3', '针织衫、长裤与鞋包的日常搭配', '俯视平铺，画面边缘留安全空间'],
    ['nav-sweater', '1:1', '炭灰卫衣品类图', '主体在中央65%'], ['nav-shoes', '1:1', '白蓝运动鞋品类图', '主体在中央65%'], ['nav-bag', '1:1', '棕色包品类图', '主体在中央65%'], ['nav-knit', '1:1', '米白针织衫品类图', '主体在中央65%'],
  ];
  return { version: 1, shop: { name: '服饰鞋包 · 装修示例', category: '服饰、鞋履、包袋', observations: ['根据已保存的A13服饰鞋包示例整理，未分析新的客户截图'], uncertainties: ['商品均为装修示意，非客户真实SKU'] }, summary: '沿用已确认的完整长页，展示模块、素材复用和两批总图之间的对应关系。这里只复用已有素材，没有新调用AI。', style: { palette: ['#E8E4DD', '#333333', '#997251'], background: '暖灰摄影棚与干净台面', lighting: '柔和侧光，统一自然阴影', photography: '服饰鞋包的克制编辑式摄影' }, modules: original.modules.map(m => {
    const sources = m.content.background ? [m.content.background] : m.content.images ? m.content.images.map(i => i.src) : m.content.items ? m.content.items.map(i => i.image) : [];
    return { id: m.id, type: m.type, purpose: m.label, props: { assetIds: sources.map(assetId), text: m.content.text || '', labels: m.type.startsWith('navigation.') ? ['服饰', '鞋履', '包袋', '针织'] : [], titles: m.content.items ? m.content.items.map(i => i.title.split('\n')[0]) : [] } };
  }), assets: subjects.map(([id, aspect, subject, composition]) => ({ id, aspect, subject, composition })), batches: [{ id: 'batch-a', rows: [['banner'], ['sweatshirt', 'tote', 'shoes'], ['coat', 'outfit']] }, { id: 'batch-b', rows: [['signboard'], ['medium'], ['nav-sweater', 'nav-shoes', 'nav-bag', 'nav-knit']] }] };
}
function createExample(folder) {
  const plan = examplePlan();
  const originals = { banner: '01-banner', sweatshirt: '02-sweatshirt', tote: '03-tote', shoes: '04-shoes', coat: '05-coat', outfit: '06-outfit' };
  fs.mkdirSync(path.join(folder, 'assets'), { recursive: true });
  for (const asset of plan.assets) fs.copyFileSync(path.join(base, 'assets', (originals[asset.id] || asset.id) + '.png'), path.join(folder, 'assets', asset.id + '.png'));
  const compiled = compose(folder, plan);
  fs.writeFileSync(path.join(folder, 'plan.json'), JSON.stringify(plan, null, 2));
  return compiled;
}
if (require.main === module) {
  const folder = path.resolve(__dirname, 'output/example');
  const result = createExample(folder);
  console.log(JSON.stringify({ folder, ...result.metrics, actualNewGenerationCalls: 0 }));
}
module.exports = { createExample, examplePlan };

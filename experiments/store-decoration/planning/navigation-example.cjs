const { categories } = require('./navigation-library.cjs');

function navigationExamplePlan(style = 'clean') {
  if (!['clean', 'warm'].includes(style)) throw new Error('导航示例不存在');
  const warm = style === 'warm';
  const assets = categories.map(c => ({ id: `nav-${c.id}`, aspect: '1:1', subject: `${c.name}的通用品类示意图，无品牌和文字`, composition: '主体完整居中，留足圆形裁剪空间', direction: { role: 'category', camera: 'eye-level', background: warm ? '暖白自然背景' : '中性冷白背景', accents: '适合店铺的克制配色', treatment: 'still-life' } }));
  const empty = { assetIds: [], text: '', labels: [], titles: [] };
  return {
    version: 1, navigationLibrary: { style: 'auto' },
    shop: { name: warm ? '柔和日常 · 服装示例' : '简约通勤 · 服装示例', category: '上衣、衬衫、裤装、连衣裙', observations: ['预设服装店示例，用于检查分类和风格分配；未分析新的客户截图'], uncertainties: ['导航为通用品类图，不代表真实在售商品'] },
    summary: '根据这家示例店的分类和主色自动分配已有导航图。只展示导航素材复用，不重复生成整店海报。',
    style: { palette: warm ? ['#FAF1E5', '#BC9F82', '#C4AAB5'] : ['#F2F4F6', '#353E48', '#B7C5D3'], background: warm ? '暖白亚麻与自然光' : '冷白干净背景', lighting: '柔和自然光，清楚辨识衣服轮廓', photography: '通用品类摄影；主视觉另按店铺内容安排' },
    modules: [
      { id: 'shop-sign', type: 'signboard.minimal', purpose: '示例店铺身份', props: { ...empty } },
      { id: 'category-nav', type: 'navigation.four', purpose: '按店铺分类和风格自动分配的导航图', props: { ...empty, assetIds: ['nav-shirts', 'nav-pants', 'nav-tops', 'nav-dresses'], labels: ['衬衫', '裤装', '上衣', '连衣裙'] } },
      { id: 'shop-notice', type: 'text.single', purpose: '说明导航示例', props: { ...empty, text: '分类图自动匹配｜商品仅为品类示意' } },
    ],
    assets,
    // Uncovered items retain this fallback brief; compilation removes library hits.
    batches: [{ id: 'navigation-fallback', rows: [['nav-tops', 'nav-shirts'], ['nav-pants', 'nav-dresses']] }],
  };
}
module.exports = { navigationExamplePlan };

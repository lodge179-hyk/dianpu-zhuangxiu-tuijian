const { z } = require('zod');
const { defineSchema, defineCatalog } = require('@json-render/core');
const styles = require('../a9-component-library/lib/styles.snapshot.json');

const purposes = {
  signboard: '店铺身份。全页只能一个且位于第一位；未知数据留空，不编造会员或商品数。极简不使用背景图片。全屏仅在确有沉浸式展示需要时考虑。',
  navigation: '品类入口。只有可辨识的不同品类才使用；四列四项、五列五项，都是一行。圆形裁剪需要主体居中。',
  poster: '展示系列、搭配或主题。单列一张；组合三图主次分明；图中不包含平台 UI。',
  carousel: '主视觉或横幅，预览只显示一帧，没有指示点。小图约3:1、中图4:3、大图3:4。',
  showcase: '商品橱窗。用于展示品类示意，不能把示意商品当作真实在售 SKU，价格留空。',
  text: '公告或段落衔接。只用已知事实与中性设计文案；不编造优惠、销量、功效、配送承诺。',
};
const catalogEntries = Object.entries(styles).map(([type, style]) => {
  let slots = style.nodes.filter(n => n.tag === 'IMG' && !/cart|icon/i.test(n.name)).map(n => n.rect);
  if (type === 'poster.single') slots = slots.slice(0, 1);
  if (type === 'navigation.five') slots = slots.slice(0, 5);
  if (type.startsWith('signboard.')) {
    const background = style.nodes.find(n => n.name === 'DecorateSignboard_banner.1' || n.name === 'SignboardSwiper_image.1');
    slots = type === 'signboard.minimal' ? [] : [type === 'signboard.default' ? [0, 0, 483, 258] : background.rect];
  }
  const family = type.split('.')[0];
  const max = slots.length;
  const min = family === 'text' || type === 'signboard.minimal' ? 0 : type === 'showcase.three' ? 3 : type.endsWith('.sliding') ? 2 : max;
  const props = z.object({
    assetIds: z.array(z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/)).min(min).max(max),
    text: z.string().max(family === 'text' ? 180 : 0),
    labels: z.array(z.string().max(24)).max(family === 'navigation' ? max : 0),
    titles: z.array(z.string().max(48)).max(family === 'showcase' ? max : 0),
  }).strict();
  return [type, { type, family, min, max, slots: slots.map((r, i) => ({ index: i + 1, width: r[2], height: r[3], aspect: +(r[2] / r[3]).toFixed(4) })), description: purposes[family], props }];
});
const entries = Object.fromEntries(catalogEntries);
const schema = defineSchema(s => ({
  spec: s.object({ modules: s.array(s.object({ id: s.string(), type: s.ref('catalog.components'), props: s.propsOf('catalog.components') })) }),
  catalog: s.object({ components: s.map({ props: s.zod(), description: s.string() }) }),
}), {
  // The stock prompt describes streamed UI-tree patches. This adapter uses one complete plan JSON.
  promptTemplate: ({ catalog: data, componentNames, formatZodType }) => '允许的固定组件（仅描述完整方案中的modules）：\n' + componentNames.map(type => `${type}: ${data.components[type].description}\nprops: ${formatZodType(data.components[type].props)}`).join('\n\n'),
});
const catalog = defineCatalog(schema, { components: Object.fromEntries(catalogEntries.map(([type, e]) => [type, { props: e.props, description: `${e.description} 此样式需要 ${e.min}..${e.max} 张素材；槽位比例：${e.slots.map(s => s.aspect).join(', ') || '无图片槽位'}。` }])) });
const publicCatalog = () => catalogEntries.map(([, { props, ...entry }]) => entry);
module.exports = { catalog, entries, publicCatalog };

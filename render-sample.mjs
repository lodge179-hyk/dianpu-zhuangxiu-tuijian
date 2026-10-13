/**
 * 用仓库里已有的示例素材渲染一个完整页面，确认「固定模块 + 真实素材」这条路走通。
 * 不调用任何模型。
 */
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderPlan } from './src/render.mjs';
import { normalizePlan } from './src/plan.mjs';
import { validatePlan } from './src/validate.mjs';

const out = path.join(process.cwd(), 'output', 'sample-render');
const assetsDir = path.join(out, 'assets');
await mkdir(assetsDir, { recursive: true });

// 用 vendor 示例素材充当「已生成/已裁切」的成品
const mapping = {
  'm01.img1': 'signboard.png',
  'm01.img2': 'ui-0.jpg',
  'm02.img1': 'nav-bag.png',
  'm02.img2': 'nav-shoes.png',
  'm02.img3': 'nav-sweater.png',
  'm02.img4': 'nav-top.png',
  'm04.img1': 'sweater-detail.png',
  'm04.img2': 'bag-detail.png',
  'm04.img3': 'trousers.png',
  'm05.img1': 'casual-outfit.png',
  'm06.img1': 'coat.png',
  'm06.img2': 'blue-shoes.png',
  'm06.img3': 'tote.png',
};
const refDir = path.join(process.cwd(), 'reference-assets');
const assetsBySlot = new Map();
for (const [slotId, file] of Object.entries(mapping)) {
  const target = `${slotId.replace(/\./g, '_')}.png`;
  try {
    await copyFile(path.join(refDir, file), path.join(assetsDir, target));
    assetsBySlot.set(slotId, { slotId, file: target, source: 'generated-scene', subject: slotId, slotPixels: [100, 100], deliveredPixels: [100, 100], nativePixels: [100, 100] });
  } catch (error) {
    console.log(`跳过 ${slotId}：找不到 ${file}`);
  }
}

const plan = normalizePlan({
  design: {
    title: '暖调针织女装陈列', summary: '用暖色木质场景承接秋冬针织与外套',
    styleKeywords: ['暖色', '简约', '秋冬'],
    palette: { background: '#F5F3EF', accent: '#B4553C', text: '#1F1D1B' },
    decisions: [
      { topic: '招牌', choice: '默认招牌', reason: '店铺已有可用的品牌大图，直接沿用最省事' },
      { topic: '主视觉', choice: '4:3 中图轮播', reason: '商品以服装为主，4:3 能在不占太高的情况下看清整体' },
      { topic: '商品陈列', choice: '三列橱窗 3 件', reason: '首屏只放一行，避免页面过长' },
    ],
    imagePlan: {
      constraints: ['暖木色统一场景', '画面里不出现任何文字'],
      images: [{
        id: 'sheet1', purpose: '横幅、导航图标与主视觉底图',
        slots: [
          { slotId: 'm01.img1', source: 'generated-scene', subject: '秋冬暖木场景横幅', aspect: '483:258' },
          { slotId: 'm02.img1', source: 'generated-nav-icon', subject: '针织上衣图标', aspect: '1:1' },
          { slotId: 'm02.img2', source: 'generated-nav-icon', subject: '运动鞋图标', aspect: '1:1' },
          { slotId: 'm02.img3', source: 'generated-nav-icon', subject: '针织衫图标', aspect: '1:1' },
          { slotId: 'm02.img4', source: 'generated-nav-icon', subject: '上衣图标', aspect: '1:1' },
          { slotId: 'm05.img1', source: 'generated-poster', subject: '秋冬主推造型氛围图', aspect: '4:3' },
        ],
      }],
    },
  },
  modules: [
    { id: 'm01', type: 'signboard.default', label: '默认招牌', reason: '沿用品牌大图', content: { background: 'm01.img1', shop: { name: '山谷衣橱', avatar: 'm01.img2', vip: false, newCount: '128', totalCount: '536' } },
      images: [
        { slotId: 'm01.img1', source: 'generated-scene', subject: '秋冬暖木场景横幅', aspect: '483:258' },
        { slotId: 'm01.img2', source: 'product-photo', subject: '店铺头像' },
      ] },
    { id: 'm02', type: 'navigation.four', label: '四列导航', reason: '四个主要品类', content: { images: ['m02.img1', 'm02.img2', 'm02.img3', 'm02.img4'] },
      images: [1, 2, 3, 4].map(i => ({ slotId: `m02.img${i}`, source: 'generated-nav-icon', subject: `导航图标 ${i}`, aspect: '1:1' })) },
    { id: 'm04', type: 'poster.three', label: '三列海报', reason: '并排展示三个主题', content: { images: ['m04.img1', 'm04.img2', 'm04.img3'] },
      images: [1, 2, 3].map(i => ({ slotId: `m04.img${i}`, source: 'product-photo', subject: `商品照片 ${i}`, aspect: '1:1' })) },
    { id: 'm05', type: 'carousel.medium', label: '中图轮播', reason: '主推秋冬造型', content: { images: ['m05.img1'] },
      images: [{ slotId: 'm05.img1', source: 'generated-poster', subject: '秋冬主推造型氛围图', aspect: '4:3' }] },
    { id: 'm06', type: 'showcase.three', label: '三列橱窗', reason: '首屏三件主推', content: { items: [
      { image: 'm06.img1', title: '燕麦色长款大衣\n羊毛混纺 · 直筒版型', price: '399', currency: '¥' },
      { image: 'm06.img2', title: '白蓝拼色运动鞋\n轻量缓震 · 日常百搭', price: '259', currency: '¥' },
      { image: 'm06.img3', title: '棕色皮质托特包\n通勤容量 · 头层牛皮', price: '469', currency: '¥' },
    ] },
      images: [1, 2, 3].map(i => ({ slotId: `m06.img${i}`, source: 'product-photo', subject: `橱窗商品 ${i}`, aspect: '1:1' })) },
  ],
}, {});

const check = validatePlan(plan);
console.log('校验：', check.ok ? '通过' : '失败 ' + check.errors.join('；'));
if (!check.ok) throw new Error('示例计划不合法');

const rendered = await renderPlan(plan, assetsBySlot, out, m => console.log('  ' + m));
await writeFile(path.join(out, 'README.txt'), [
  '这是不调用模型的样例渲染，用于确认固定模块 + 真实素材能渲染成完整页面。',
  `页面尺寸：${rendered.width} × ${rendered.height} px`,
  `模块数：${rendered.moduleCount}，图片位：${rendered.photos.length}`,
  '素材来自 vendor 示例，不代表任何真实店铺。',
].join('\n'), 'utf8');
console.log('输出：', rendered.htmlFile);
console.log('图片位：', rendered.photos.map(p => `${p.id}@${p.rect.join(',')}`).join('  '));

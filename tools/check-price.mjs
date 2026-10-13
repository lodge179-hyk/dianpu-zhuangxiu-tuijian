// 验证：空价格字符串在组件库里能正常渲染（不显示金额），且整页能渲染出来。
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderPlan } from '../src/render.mjs';
import { normalizePlan } from '../src/plan.mjs';
import { validatePlan } from '../src/validate.mjs';

const plan = normalizePlan({
  design: { title: '价格缺省测试' },
  modules: [
    { id: 'm01', type: 'showcase.three', content: { items: [
      { image: 'm01.img1', title: '商品一' },
      { image: 'm01.img2', title: '商品二', price: '199', currency: '¥' },
      { image: 'm01.img3', title: '商品三', price: '' },
    ] }, images: [1, 2, 3].map(i => ({ slotId: `m01.img${i}`, source: 'product-photo', subject: 'x' })) },
  ],
}, {});
const check = validatePlan(plan);
console.log('校验：', check.ok ? '通过' : '失败 ' + check.errors.join('；'));
console.log('价格字段：', plan.modules[0].content.items.map(i => JSON.stringify({ title: i.title, price: i.price })).join('  '));

const dir = await mkdtemp(path.join(tmpdir(), 'price-'));
try {
  const assets = new Map([1, 2, 3].map(i => [`m01.img${i}`, { file: 'x.png' }]));
  const r = await renderPlan(plan, assets, dir, () => {});
  console.log('渲染成功：', r.width + '×' + r.height, `${r.moduleCount} 个模块，${r.photos.length} 个图片位`);
} catch (error) {
  console.log('渲染失败：', error.message, error.hint || '');
} finally {
  await rm(dir, { recursive: true, force: true });
}

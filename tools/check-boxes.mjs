import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const d = process.argv[2];
const shop = JSON.parse(await readFile(`${d}/shop.json`, 'utf8'));
const meta = await sharp(`${d}/screenshot.png`).metadata();
console.log(`截图（规范化后）：${meta.width}×${meta.height}`);
console.log('\n识别到的商品框（归一化 → 实际像素）：');
for (const [i, p] of (shop.visibleProducts || []).entries()) {
  const box = p.box;
  if (!box) { console.log(`  ${i + 1}. ${p.name} —— 无框`); continue; }
  const left = Math.round(box.x * meta.width);
  const top = Math.round(box.y * meta.height);
  const w = Math.round(box.w * meta.width);
  const h = Math.round(box.h * meta.height);
  console.log(`  ${i + 1}. ${p.name}`);
  console.log(`     box=${JSON.stringify(box)}`);
  console.log(`     → 像素 left=${left} top=${top} ${w}×${h}  比例 ${(w / h).toFixed(2)}`);
}

// 把第一个框画出来看一眼
const first = (shop.visibleProducts || []).find(p => p.box);
if (first) {
  const left = Math.max(0, Math.round(first.box.x * meta.width));
  const top = Math.max(0, Math.round(first.box.y * meta.height));
  const w = Math.min(meta.width - left, Math.round(first.box.w * meta.width));
  const h = Math.min(meta.height - top, Math.round(first.box.h * meta.height));
  await sharp(`${d}/screenshot.png`).extract({ left, top, width: w, height: h }).png().toFile('output/box-probe.png');
  console.log(`\n第一个框已裁出：output/box-probe.png（${w}×${h}）`);
}

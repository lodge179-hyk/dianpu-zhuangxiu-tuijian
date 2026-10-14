import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const d = process.argv[2];
const manifest = JSON.parse(await readFile(`${d}/manifest.json`, 'utf8'));

console.log('商品照片裁切质量：');
for (const a of manifest.assetFiles.filter(a => a.source === 'product-photo')) {
  const file = `${d}/${a.file}`;
  const meta = await sharp(file).metadata();
  const stat = await sharp(file).stats();
  const mean = stat.channels.slice(0, 3).map(c => Math.round(c.mean)).join(',');
  console.log(`  ${a.slotId.padEnd(11)} ${a.file.padEnd(20)} 交付 ${a.deliveredPixels.join('×')} 均值RGB(${mean}) ${a.upscaled ? '放大' : ''} ${a.note || ''}`);
}
console.log('\n页面尺寸：', manifest.page.width + '×' + manifest.page.height, '模块', manifest.modules.length);

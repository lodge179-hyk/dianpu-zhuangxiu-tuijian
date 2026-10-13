import sharp from 'sharp';
import { detectProductGrid } from '../src/grid.mjs';

const file = process.argv[2];
const outImage = process.argv[3] || 'output/grid-test.png';
const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const cells = detectProductGrid(data, info.width, info.height, info.channels);
console.log(`检测到 ${cells.length} 个商品照片格（图片 ${info.width}×${info.height}）：`);
for (const [i, c] of cells.entries()) {
  console.log(`  ${String(i + 1).padStart(2)}. left=${c.left} top=${c.top} ${c.width}×${c.height}  比例 ${(c.width / c.height).toFixed(3)}  占宽 ${(c.width / info.width * 100).toFixed(1)}%`);
}
const tiles = [];
for (const [i, c] of cells.slice(0, 8).entries()) {
  const buf = await sharp(file).extract({ left: c.left, top: c.top, width: c.width, height: c.height }).resize(200, 200, { fit: 'cover' }).png().toBuffer();
  tiles.push({ input: buf, left: 10 + (i % 4) * 210, top: 10 + Math.floor(i / 4) * 210 });
}
if (tiles.length) {
  await sharp({ create: { width: 850, height: 430, channels: 3, background: '#dddddd' } }).composite(tiles).png().toFile(outImage);
  console.log(`验证图：${outImage}`);
} else {
  console.log('没有可验证的格子');
}

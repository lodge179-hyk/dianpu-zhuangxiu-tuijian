import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const src = process.argv[2];
const out = process.argv[3] || 'output/inspect';
await mkdir(out, { recursive: true });
const meta = await sharp(src, { limitInputPixels: 500_000_000 }).metadata();
console.log(`原图：${meta.width}×${meta.height}  ${meta.format}  ${Math.round(meta.size / 1024)}KB  宽高比 1:${(meta.height / meta.width).toFixed(2)}`);

// 整图缩略（看整体结构）
const s = Math.min(1, 1500 / Math.max(meta.width, meta.height));
await sharp(src, { limitInputPixels: 500_000_000 }).resize({ width: Math.round(meta.width * s) }).jpeg({ quality: 82 }).toFile(`${out}/whole.jpg`);
console.log(`整图预览：${out}/whole.jpg`);

// 上中下三段（看清内容）
const segH = Math.round(meta.height / 3);
for (const [i, top] of [0, segH, segH * 2].entries()) {
  const h = Math.min(segH, meta.height - top);
  const seg = await sharp(src, { limitInputPixels: 500_000_000 }).extract({ left: 0, top, width: meta.width, height: h }).toBuffer();
  const m2 = await sharp(seg).metadata();
  const s2 = Math.min(1, 1400 / Math.max(m2.width, m2.height));
  await sharp(seg).resize({ width: Math.round(m2.width * s2) }).jpeg({ quality: 82 }).toFile(`${out}/part${i + 1}.jpg`);
  console.log(`第 ${i + 1} 段：${out}/part${i + 1}.jpg  (原图 y=${top} 起，高 ${h})`);
}

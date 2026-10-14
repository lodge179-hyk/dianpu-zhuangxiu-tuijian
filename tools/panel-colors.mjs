import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const dir = process.argv[2];
const layout = JSON.parse(await readFile(`${dir}/sheets/sheet1-grid-layout.json`, 'utf8'));
const { width, height } = await sharp(`${dir}/sheets/sheet1-grid.png`).metadata();
console.log(`画布 ${width}×${height}，${layout.panels.length} 个面板：`);
for (const p of layout.panels) {
  const { left, top, width: w, height: h } = p.panelRect;
  const crop = await sharp(`${dir}/sheets/sheet1-grid.png`).extract({
    left: Math.min(width - 2, Math.max(0, left + 6)),
    top: Math.min(height - 2, Math.max(0, top + 6)),
    width: Math.max(4, w - 12), height: Math.max(4, h - 12),
  }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data, info } = crop;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += info.channels) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1; }
  console.log(`  ${p.slotId.padEnd(12)} 均值RGB(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})  面板${w}×${h}`);
}

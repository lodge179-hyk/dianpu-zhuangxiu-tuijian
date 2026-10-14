import sharp from 'sharp';

const file = process.argv[2];
const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels } = info;
const lum = (x, y) => { const p = (y * W + x) * channels; return (data[p] + data[p + 1] + data[p + 2]) / 3; };

// 纯白占比：商品照片区域（即使白底也有阴影与渐变）不会几乎全为 255
const whiteFrac = new Float32Array(H);
for (let y = 0; y < H; y += 1) {
  let w = 0;
  let n = 0;
  for (let x = 0; x < W; x += 2) { if (lum(x, y) >= 249) w += 1; n += 1; }
  whiteFrac[y] = w / n;
}
const runs = (flags, min) => { const out = []; let s = null; for (let i = 0; i <= flags.length; i += 1) { if (i < flags.length && flags[i]) { if (s === null) s = i; } else if (s !== null) { if (i - s >= min) out.push([s, i]); s = null; } } return out; };

console.log('行白占比分段（每 100 行）：');
for (let y = 0; y < H; y += 100) {
  const seg = whiteFrac.slice(y, Math.min(H, y + 100));
  const avg = seg.reduce((a, c) => a + c, 0) / seg.length;
  console.log(`  y=${String(y).padStart(5)}  白占比 ${(avg * 100).toFixed(1)}%`);
}

// 商品区域候选：白占比明显低于 95% 的行
const contentRows = Array.from(whiteFrac).map(v => v < 0.95);
const bands = runs(contentRows, 80);
console.log(`\n非纯白内容带 ${bands.length} 条（可能是商品照片行）：`);
for (const [y0, y1] of bands) {
  const colFrac = new Float32Array(W);
  for (let x = 0; x < W; x += 1) {
    let w = 0;
    let n = 0;
    for (let y = y0; y < y1; y += 2) { if (lum(x, y) >= 249) w += 1; n += 1; }
    colFrac[x] = w / n;
  }
  const cols = runs(Array.from(colFrac).map(v => v < 0.9), 60);
  console.log(`  y=${String(y0).padStart(4)}..${String(y1).padStart(4)} 高 ${String(y1 - y0).padStart(4)} 列 ${cols.length}: ${cols.map(([a, b]) => `${a}..${b}(${b - a})`).join(' ')}`);
}

import sharp from 'sharp';

const file = process.argv[2];
const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels } = info;
const lum = (x, y) => { const p = (y * W + x) * channels; return (data[p] + data[p + 1] + data[p + 2]) / 3; };

// 每行的深色像素占比（商品照片里商品本身是深色的）
const darkFrac = new Float32Array(H);
for (let y = 0; y < H; y += 1) {
  let dark = 0;
  let n = 0;
  for (let x = 0; x < W; x += 2) { if (lum(x, y) < 150) dark += 1; n += 1; }
  darkFrac[y] = dark / n;
}
// 每列的深色像素占比（用于在带内切列）
const runs = (flags, min) => { const out = []; let s = null; for (let i = 0; i <= flags.length; i += 1) { if (i < flags.length && flags[i]) { if (s === null) s = i; } else if (s !== null) { if (i - s >= min) out.push([s, i]); s = null; } } return out; };

const bands = runs(Array.from(darkFrac).map(v => v > 0.03), 60);
console.log(`深色内容带 ${bands.length} 条：`);
for (const [y0, y1] of bands) {
  // 带内按列深色占比切列
  const colFrac = new Float32Array(W);
  for (let x = 0; x < W; x += 1) {
    let dark = 0;
    let n = 0;
    for (let y = y0; y < y1; y += 2) { if (lum(x, y) < 150) dark += 1; n += 1; }
    colFrac[x] = dark / n;
  }
  const cols = runs(Array.from(colFrac).map(v => v > 0.02), 40);
  console.log(`  y=${String(y0).padStart(4)}..${String(y1).padStart(4)} 高 ${String(y1 - y0).padStart(4)}  列 ${cols.length} 个: ${cols.map(([a, b]) => `x${a}..${b}(${b - a})`).join(' ')}`);
}

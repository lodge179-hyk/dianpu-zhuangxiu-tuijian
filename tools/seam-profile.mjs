import sharp from 'sharp';

const file = process.argv[2];
const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels } = info;
const lum = (x, y) => { const p = (y * W + x) * channels; return (data[p] + data[p + 1] + data[p + 2]) / 3; };
const white = v => v >= 246;

// 在第一行商品带 y=700..1200 里，找每列的白色占比
const y0 = 700, y1 = 1200;
const colWhite = [];
for (let x = 0; x < W; x += 1) {
  let w = 0, n = 0;
  for (let y = y0; y < y1; y += 2) { if (white(lum(x, y))) w += 1; n += 1; }
  colWhite.push(w / n);
}
console.log('第一行商品带 y=700..1200 的列白色占比（每 10px 打印一次）：');
for (let x = 0; x < W; x += 10) {
  console.log(`${String(x).padStart(4)} ${colWhite[x].toFixed(2)} ${'#'.repeat(Math.round(colWhite[x] * 40))}`);
}

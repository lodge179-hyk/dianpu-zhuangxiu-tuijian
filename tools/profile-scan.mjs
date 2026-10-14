import sharp from 'sharp';

const file = process.argv[2];
const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels } = info;
const lum = (x, y) => { const p = (y * W + x) * channels; return (data[p] + data[p + 1] + data[p + 2]) / 3; };

// 在商品区取一条水平剖面，找列边界（低亮度细线或纯白缝）
const y0 = Number(process.argv[3] || 600);
const y1 = Number(process.argv[4] || 700);
console.log(`水平剖面 y=${y0}..${y1}（每列取该区间均值）：`);
const colAvg = [];
for (let x = 0; x < W; x += 1) {
  let s = 0;
  for (let y = y0; y < y1; y += 1) s += lum(x, y);
  colAvg.push(s / (y1 - y0));
}
// 找局部低谷（可能是列边界）
const dips = [];
for (let x = 3; x < W - 3; x += 1) {
  if (colAvg[x] < 246 && colAvg[x] < colAvg[x - 3] && colAvg[x] < colAvg[x + 3]) dips.push({ x, v: Math.round(colAvg[x]) });
}
console.log(`  低谷候选（亮度 <246 的局部最小）${dips.length} 个：${dips.slice(0, 40).map(d => `${d.x}(${d.v})`).join(' ')}`);

// 竖直剖面：找行边界
const x0 = Number(process.argv[5] || 40);
const x1 = Number(process.argv[6] || 520);
console.log(`\n竖直剖面 x=${x0}..${x1}（每行取该区间均值，仅打印 <250 的行）：`);
const rowAvg = [];
for (let y = 0; y < H; y += 1) {
  let s = 0;
  for (let x = x0; x < x1; x += 1) s += lum(x, y);
  rowAvg.push(s / (x1 - x0));
}
const lowRows = [];
let run = null;
for (let y = 0; y < H; y += 1) {
  if (rowAvg[y] < 250) { if (run === null) run = [y, y]; else run[1] = y; } else if (run) { lowRows.push(run); run = null; }
}
if (run) lowRows.push(run);
console.log(`  低亮度行段 ${lowRows.length} 条：`);
for (const [a, b] of lowRows.slice(0, 40)) console.log(`    y=${a}..${b} 高 ${b - a + 1} 均值 ${Math.round(rowAvg.slice(a, b + 1).reduce((s, v) => s + v, 0) / (b - a + 1))}`);

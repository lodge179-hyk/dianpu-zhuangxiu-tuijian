import sharp from 'sharp';

const file = process.argv[2];
const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels } = info;
console.log(`截图 ${W}×${H}`);

// 行亮度：商品照片区域是浅色底，App 头部是深色
const rowBrightness = new Float32Array(H);
for (let y = 0; y < H; y += 1) {
  let sum = 0;
  for (let x = 0; x < W; x += 4) {
    const p = (y * W + x) * channels;
    sum += (data[p] + data[p + 1] + data[p + 2]) / 3;
  }
  rowBrightness[y] = sum / Math.ceil(W / 4);
}
console.log('\n行亮度分段（每 40 行一个采样）：');
for (let y = 0; y < H; y += 200) {
  const b = rowBrightness.slice(y, Math.min(H, y + 200)).reduce((a, c) => a + c, 0) / Math.min(200, H - y);
  console.log(`  y=${String(y).padStart(5)}  平均亮度 ${b.toFixed(1)}`);
}

// 找出连续的高亮行区间（商品区）
const bright = Array.from(rowBrightness).map(b => b > 200);
const runs = [];
let s = null;
for (let i = 0; i <= H; i += 1) {
  if (i < H && bright[i]) { if (s === null) s = i; } else if (s !== null) { if (i - s > 30) runs.push([s, i]); s = null; }
}
console.log('\n浅色内容行区间（商品图区域候选）：');
for (const [a, b] of runs) console.log(`  y=${a}..${b}  高 ${b - a}`);

// 第一个区间的列结构
const first = runs.find(([a, b]) => b - a > 200);
if (first) {
  const [y0, y1] = first;
  const colContent = [];
  for (let x = 0; x < W; x += 1) {
    let bright2 = 0;
    for (let y = y0; y < y1; y += 2) {
      const p = (y * W + x) * channels;
      if ((data[p] + data[p + 1] + data[p + 2]) / 3 > 190) bright2 += 1;
    }
    colContent.push(bright2 / Math.ceil((y1 - y0) / 2));
  }
  const colRuns = [];
  let cs = null;
  for (let i = 0; i <= W; i += 1) {
    if (i < W && colContent[i] > 0.5) { if (cs === null) cs = i; } else if (cs !== null) { if (i - cs > 40) colRuns.push([cs, i]); cs = null; }
  }
  console.log(`\n第一个内容区 y=${y0}..${y1} 的列区间（商品照片列）：`);
  for (const [a, b] of colRuns) console.log(`  x=${a}..${b}  宽 ${b - a}`);
}

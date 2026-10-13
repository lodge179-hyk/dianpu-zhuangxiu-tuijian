import sharp from 'sharp';

const f = process.argv[2];
const { data, info } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels } = info;
const isSep = (x, y) => { const p = (y * W + x) * channels; const r = data[p], g = data[p + 1], b = data[p + 2]; return r > 170 && b > 170 && g < 140 && r - g > 70 && b - g > 70; };

const rowFlags = Array.from({ length: H }, (_, y) => {
  let content = 0;
  for (let x = 0; x < W; x += 1) if (!isSep(x, y)) content += 1;
  return content / W > 0.1;
});
const runs = (values, min) => { const out = []; let s = null; for (let i = 0; i <= values.length; i += 1) { if (i < values.length && values[i]) { if (s === null) s = i; } else if (s !== null) { if (i - s >= min) out.push([s, i]); s = null; } } return out; };

console.log(`画布 ${W}×${H}`);
const rows = runs(rowFlags, 20);
console.log('检测到的内容行:', JSON.stringify(rows));
for (const [y0, y1] of rows) {
  const colFlags = Array.from({ length: W }, (_, x) => {
    let content = 0;
    for (let y = y0; y < y1; y += 1) if (!isSep(x, y)) content += 1;
    return content / (y1 - y0) > 0.9;
  });
  const cols = runs(colFlags, 20);
  console.log(`  行 y=${y0}..${y1}（高 ${y1 - y0}）→ ${cols.length} 列: ${JSON.stringify(cols.map(([a, b]) => [a, b, b - a]))}`);
}
// 逐行打印边界处的品红宽度，确认分隔带位置
console.log('\n前 40 行与每个内容行边界附近的行旗标:');
for (const y of [0, 5, 10, 28, 30, 33, 36, 40, 100, 505, 510, 515, 520, 525, 530, 535, 540, 1020, 1030, 1040, 1050, 1060, 1550, 1570, 1579]) {
  if (y >= H) continue;
  let content = 0;
  for (let x = 0; x < W; x += 1) if (!isSep(x, y)) content += 1;
  console.log(`  y=${String(y).padStart(4)}  内容像素占比 ${(content / W * 100).toFixed(1)}%  → 行旗标 ${rowFlags[y]}`);
}

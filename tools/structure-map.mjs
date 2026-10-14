import sharp from 'sharp';

const file = process.argv[2];
const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels } = info;
const lum = (x, y) => { const p = (y * W + x) * channels; return (data[p] + data[p + 1] + data[p + 2]) / 3; };

console.log(`截图 ${W}×${H}`);

// 用缩略图看结构：每 8px 取样，输出亮度与"竖向白缝"的位置
const step = 8;
const rows = Math.floor(H / step);
const cols = Math.floor(W / step);
const grid = [];
for (let r = 0; r < rows; r += 1) {
  const line = [];
  for (let c = 0; c < cols; c += 1) {
    const v = lum(c * step, r * step);
    line.push(v > 245 ? '.' : v > 200 ? '-' : v > 120 ? '+' : '#');
  }
  grid.push(line.join(''));
}
// 只打印前 120 行（前 960px）与每 40 行一个刻度
console.log('\n前 960px 的结构图（. 近白 / - 浅 / + 中 / # 深，每个字符 8px）：');
for (let r = 0; r < Math.min(120, grid.length); r += 1) {
  console.log(String(r * step).padStart(5) + ' ' + grid[r]);
}
console.log('\n列刻度（每个字符 8px）：');
let ruler = '';
for (let c = 0; c < cols; c += 1) ruler += (c % 10 === 0 ? '|' : ' ');
console.log('      ' + ruler);

import sharp from 'sharp';

const file = process.argv[2];
const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels } = info;
const lum = (x, y) => { const p = (y * W + x) * channels; return (data[p] + data[p + 1] + data[p + 2]) / 3; };

// 只看第一行商品区域：y 650..1250，按行打印左列(x150..400)、右列(x560..900)的平均亮度
console.log('y    左列亮度  右列亮度  全行白占比');
for (let y = 650; y < 1250; y += 10) {
  let ls = 0, rs = 0, lw = 0, rw = 0, ws = 0;
  let n = 0;
  for (let x = 150; x < 400; x += 2) { ls += lum(x, y); lw += 1; }
  for (let x = 560; x < 900; x += 2) { rs += lum(x, y); rw += 1; }
  for (let x = 0; x < W; x += 4) { if (lum(x, y) >= 250) ws += 1; n += 1; }
  console.log(`${String(y).padStart(4)}  ${(ls / lw).toFixed(0).padStart(5)}     ${(rs / rw).toFixed(0).padStart(5)}     ${((ws / n) * 100).toFixed(0).padStart(3)}%`);
}

import sharp from 'sharp';

/**
 * 检测商品照片格（两列商品网格）。
 *
 * 策略：
 * 1. 跳过顶部深色 App 头（近白比例极低的连续区域）；
 * 2. 按「整行几乎全白的横缝」把剩余内容切成行；
 * 3. 每行固定左右两列（页面是左右对称的两列网格），不猜中央缝位置；
 * 4. 在每个单元格里按内容收缩到商品照片的真实边界（去掉四周白边）；
 * 5. 只保留高 >= 300px（商品照片）且比例接近方形的格子。
 */
export function detectProductGrid(data, W, H, channels, options = {}) {
  const whiteT = options.whiteThreshold ?? 246;
  const lum = (x, y) => { const p = (y * W + x) * channels; return (data[p] + data[p + 1] + data[p + 2]) / 3; };
  const white = v => v >= whiteT;
  const runs = (flags, min) => {
    const out = [];
    let s = null;
    for (let i = 0; i <= flags.length; i += 1) {
      if (i < flags.length && flags[i]) { if (s === null) s = i; } else if (s !== null) { if (i - s >= min) out.push([s, i]); s = null; }
    }
    return out;
  };

  const rowWhite = new Float32Array(H);
  for (let y = 0; y < H; y += 1) {
    let w = 0, n = 0;
    for (let x = 0; x < W; x += 2) { if (white(lum(x, y))) w += 1; n += 1; }
    rowWhite[y] = w / n;
  }

  // 1) 顶部深色头：从第一行起，找到第一个"接近全白"的行作为商品区起点
  let top = 0;
  for (let y = 0; y < H; y += 1) if (rowWhite[y] > 0.8) { top = y; break; }

  // 2) 横缝切行
  const gapRows = [];
  for (let y = top; y < H; y += 1) if (rowWhite[y] > 0.965) gapRows.push(y);
  const gapRuns = runs(gapRows.map((_, i) => i === 0 || gapRows[i] - gapRows[i - 1] === 1), 25)
    .map(([a, b]) => [gapRows[a], gapRows[b - 1] + 1]);
  const rows = [];
  let prev = top;
  for (const [g0, g1] of gapRuns) {
    if (g0 - prev > 120) rows.push([prev, g0]);
    prev = g1;
  }
  if (H - prev > 120) rows.push([prev, H]);

  // 3) 每行左右两列（固定），再收缩到内容
  const cells = [];
  for (const [ry0, ry1] of rows) {
    for (const [cx0, cx1] of [[0, Math.floor(W / 2)], [Math.floor(W / 2), W]]) {
      // 在单元格内收缩：去掉四周接近全白的边
      let left = cx0, right = cx1, topR = ry0, bottomR = ry1;
      while (left < right) {
        let w = 0, n = 0;
        for (let y = topR; y < bottomR; y += 4) { if (white(lum(left, y))) w += 1; n += 1; }
        if (w / n > 0.9) left += 1; else break;
      }
      while (right > left) {
        let w = 0, n = 0;
        for (let y = topR; y < bottomR; y += 4) { if (white(lum(right - 1, y))) w += 1; n += 1; }
        if (w / n > 0.9) right -= 1; else break;
      }
      while (topR < bottomR) {
        let w = 0, n = 0;
        for (let x = left; x < right; x += 4) { if (white(lum(x, topR))) w += 1; n += 1; }
        if (w / n > 0.9) topR += 1; else break;
      }
      while (bottomR > topR) {
        let w = 0, n = 0;
        for (let x = left; x < right; x += 4) { if (white(lum(x, bottomR - 1))) w += 1; n += 1; }
        if (w / n > 0.9) bottomR -= 1; else break;
      }
      const width = right - left, height = bottomR - topR, ratio = width / height;
      if (height < 300 || width < 100 || ratio < 0.5 || ratio > 2.2) continue;
      cells.push({ left, top: topR, width, height });
    }
  }
  return cells;
}

if (process.argv[2]) {
  const file = process.argv[2];
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const cells = detectProductGrid(data, info.width, info.height, info.channels);
  console.log(`检测到 ${cells.length} 个候选商品格（${info.width}×${info.height}）：`);
  for (const [i, c] of cells.entries()) console.log(`  ${String(i + 1).padStart(2)}. left=${String(c.left).padStart(4)} top=${String(c.top).padStart(4)} ${String(c.width).padStart(4)}×${String(c.height).padStart(4)} 比例 ${(c.width / c.height).toFixed(2)}`);
  const out = process.argv[3];
  if (out && cells.length) {
    const cols = 4, size = 190, tiles = [];
    for (const [i, c] of cells.slice(0, 16).entries()) {
      const buf = await sharp(file).extract({ left: c.left, top: c.top, width: c.width, height: c.height }).resize(size, size, { fit: 'cover' }).png().toBuffer();
      tiles.push({ input: buf, left: 10 + (i % cols) * (size + 10), top: 10 + Math.floor(i / cols) * (size + 10) });
    }
    const rowsN = Math.ceil(tiles.length / cols);
    await sharp({ create: { width: 10 + cols * (size + 10), height: 10 + rowsN * (size + 10), channels: 3, background: '#cccccc' } }).composite(tiles).png().toFile(out);
    console.log(`验证拼图：${out}`);
  }
}

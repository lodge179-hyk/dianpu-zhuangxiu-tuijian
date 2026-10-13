import sharp from 'sharp';

/**
 * 从店铺截图里实测商品照片格。
 *
 * 为什么需要它：视觉模型给的坐标在长截图上不可靠（实测把 15% 宽度当成 15% 高度），
 * 而这类截图的商品区结构其实很好识别——浅色底、成行排列、行间有白色间隔带。
 * 因此用纯像素分析定位格子，模型只负责"这个格子里是什么商品"。
 */
export function detectProductGrid(data, W, H, channels) {
  const lum = (x, y) => {
    const p = (y * W + x) * channels;
    return (data[p] + data[p + 1] + data[p + 2]) / 3;
  };
  const rowBright = new Float32Array(H);
  for (let y = 0; y < H; y += 1) {
    let sum = 0;
    let n = 0;
    for (let x = 0; x < W; x += 4) { sum += lum(x, y); n += 1; }
    rowBright[y] = sum / n;
  }
  // 浅色内容区（商品照片多为浅底）
  const isContentRow = Array.from(rowBright).map(b => b > 195);
  const runs = [];
  let start = null;
  for (let i = 0; i <= H; i += 1) {
    if (i < H && isContentRow[i]) { if (start === null) start = i; } else if (start !== null) { if (i - start > 60) runs.push([start, i]); start = null; }
  }

  // 在一个行区间内按"色彩丰富度"切列：商品照片有内容，列间隙是纯白
  const cells = [];
  for (const [y0, y1] of runs) {
    const colVariance = new Float32Array(W);
    for (let x = 0; x < W; x += 1) {
      let min = 255;
      let max = 0;
      for (let y = y0; y < y1; y += 4) {
        const v = lum(x, y);
        if (v < min) min = v;
        if (v > max) max = v;
      }
      colVariance[x] = max - min;
    }
    const hasContent = Array.from(colVariance).map(v => v > 26);
    const colRuns = [];
    let cs = null;
    for (let i = 0; i <= W; i += 1) {
      if (i < W && hasContent[i]) { if (cs === null) cs = i; } else if (cs !== null) { if (i - cs > 60) colRuns.push([cs, i]); cs = null; }
    }
    for (const [x0, x1] of colRuns) {
      const width = x1 - x0;
      const height = y1 - y0;
      if (width < 60 || height < 60) continue;
      cells.push({ left: x0, top: y0, width, height });
    }
  }
  return cells;
}

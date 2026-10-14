import sharp from 'sharp';

/**
 * 从截图里程序实测主色，作为"这家店真实视觉基调"喂给 AI。
 *
 * 原因：视觉模型对品类有刻板印象（美妆→粉色），每次都默认生成粉色系，
 * 而不是从截图里真实的颜色（例如绿/金/棕）出发。这里用像素统计把真实主色拿出来。
 */
export async function extractPalette(buffer, options = {}) {
  const maxPixels = options.maxPixels ?? 200_000;
  const meta = await sharp(buffer).metadata();
  const { width, height } = meta;
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  const resized = await sharp(buffer)
    .resize({ width: Math.max(8, Math.round(width * scale)), height: Math.max(8, Math.round(height * scale)) })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data, info } = resized;

  // 量化到 32 级颜色桶，统计出现频率
  const buckets = new Map();
  const keyOf = (r, g, b) => `${Math.floor(r / 32) * 32},${Math.floor(g / 32) * 32},${Math.floor(b / 32) * 32}`;
  for (let i = 0; i < data.length; i += info.channels) {
    const key = keyOf(data[i], data[i + 1], data[i + 2]);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1]);

  // 过滤掉接近纯白/纯黑/灰的颜色，取前 5 个有彩色
  const colorful = [];
  for (const [key, count] of sorted) {
    const [r, g, b] = key.split(',').map(Number);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max - min;
    const light = (max + min) / 2;
    if (sat < 20) continue;          // 太灰
    if (light < 40 || light > 225) continue; // 太黑/太白
    colorful.push({ r, g, b, count, share: +(count / (info.width * info.height) * 100).toFixed(2) });
    if (colorful.length >= 5) break;
  }
  const hex = ({ r, g, b }) => '#' + [r, g, b].map(v => Math.min(255, v).toString(16).padStart(2, '0')).join('').toUpperCase();
  return {
    sampledAt: { width: info.width, height: info.height },
    dominant: colorful.map(c => ({ ...c, hex: hex(c) })),
    background: colorful[0] ? hex(colorful[0]) : '#F5F3EF',
    accent: colorful[1] ? hex(colorful[1]) : '#B4553C',
    muted: colorful[2] ? hex(colorful[2]) : '#7A7A80',
  };
}

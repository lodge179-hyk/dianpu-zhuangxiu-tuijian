// Model coordinates are data, not trusted geometry. Never infer percentage or
// pixel units from magnitude: a wrong unit can select a different product.
const number = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string' || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return NaN;
  return Number(value);
};

export function normalizeBox(raw, { space = 'normalized', width, height } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: '缺少照片矩形' };
  const x = number(raw.x ?? raw.left), y = number(raw.y ?? raw.top);
  let w = number(raw.w ?? raw.width), h = number(raw.h ?? raw.height);
  if (raw.w == null && raw.width == null && raw.right != null) w = number(raw.right) - x;
  if (raw.h == null && raw.height == null && raw.bottom != null) h = number(raw.bottom) - y;
  let values = [x, y, w, h];
  if (!values.every(Number.isFinite) || w <= 0 || h <= 0) return { error: '矩形字段缺失或不是有效数字' };
  const unit = String(space).trim().toLowerCase();
  if (unit === 'percent' || unit === 'percentage') values = [x / 100, y / 100, w / 100, h / 100];
  else if (unit === 'pixels' || unit === 'pixel') {
    if (!(width > 0 && height > 0)) return { error: '缺少对应图片的像素尺寸' };
    values = [x / width, y / height, w / width, h / height];
  } else if (unit !== 'normalized') return { error: '坐标单位不明确' };
  const [left, top, spanX, spanY] = values, right = left + spanX, bottom = top + spanY;
  const tolerance = .001;
  if (left < -tolerance || top < -tolerance || right > 1 + tolerance || bottom > 1 + tolerance || left >= 1 || top >= 1 || right <= 0 || bottom <= 0) return { error: '照片矩形明显超出图片边界' };
  const box = { x: Math.max(0, left), y: Math.max(0, top), w: Math.min(1, right) - Math.max(0, left), h: Math.min(1, bottom) - Math.max(0, top) };
  if (box.w <= 0 || box.h <= 0) return { error: '照片矩形没有有效面积' };
  return { box, adjusted: Object.values(box).some((v, i) => Math.abs(v - values[i]) > 1e-10) };
}

export function plausibleRefinement(original, refined, width, height) {
  if (refined.w * width < 16 || refined.h * height < 16) return false;
  const area = original.w * original.h, nextArea = refined.w * refined.h;
  if (nextArea < area * .15 || nextArea > area * 3) return false;
  const overlapX = Math.max(0, Math.min(original.x + original.w, refined.x + refined.w) - Math.max(original.x, refined.x));
  const overlapY = Math.max(0, Math.min(original.y + original.h, refined.y + refined.h) - Math.max(original.y, refined.y));
  return overlapX * overlapY / Math.min(area, nextArea) >= .25;
}

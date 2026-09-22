import sharp from "sharp";

export type ProtectedView = { image: string; confidence: number; box: { left: number; top: number; width: number; height: number } };
export type CropRect = { left: number; top: number; width: number; height: number };
type Size = { width: number; height: number };
export function protectedCrop(source: Size, target: Size, view?: ProtectedView, circle = false): CropRect | undefined {
  const ratio = target.width / target.height;
  const width = Math.min(source.width, Math.floor(source.height * ratio));
  const height = Math.min(source.height, Math.floor(source.width / ratio));
  if (!circle && width === source.width && height === source.height) return { left: 0, top: 0, width, height };
  if (!view || view.confidence < .85) return undefined;
  const box = view.box;
  if (![box.left, box.top, box.width, box.height].every(Number.isFinite) || box.left < 0 || box.top < 0 || box.width <= 0 || box.height <= 0 || box.left + box.width > 1 || box.top + box.height > 1) return undefined;
  const left = Math.floor(box.left * source.width), top = Math.floor(box.top * source.height);
  const right = Math.ceil((box.left + box.width) * source.width), bottom = Math.ceil((box.top + box.height) * source.height);
  const minX = Math.max(0, right - width), maxX = Math.min(left, source.width - width);
  const minY = Math.max(0, bottom - height), maxY = Math.min(top, source.height - height);
  if (minX > maxX || minY > maxY) return undefined;
  const x = Math.max(minX, Math.min(maxX, Math.round((left + right - width) / 2)));
  const y = Math.max(minY, Math.min(maxY, Math.round((top + bottom - height) / 2)));
  if (circle && [[left, top], [right, top], [left, bottom], [right, bottom]].some(([px, py]) => Math.hypot((px-x-width/2)/(width/2), (py-y-height/2)/(height/2)) > 1)) return undefined;
  return { left: x, top: y, width, height };
}

export async function adaptOriginal(sources: { name: string; bytes: Buffer }[], size: Size, views: ProtectedView[] = [], circle = false) {
  for (const source of sources) {
    const upright = await sharp(source.bytes).rotate().toBuffer();
    const metadata = await sharp(upright).metadata();
    const crop = protectedCrop({width: metadata.width!, height: metadata.height!}, size, views.find(v => v.image === source.name), circle);
    if (!crop) continue;
    return { bytes: await sharp(upright).extract(crop).resize(size.width, size.height, {fit:"fill"}).jpeg({quality:92}).toBuffer(), adaptation: { verdict: "pass" as const, mode: "crop" as const, sourceFilename: source.name, crop, reason: "裁切完整保留受保护区域" } };
  }
  // Keep every source pixel while awaiting review; the preview explicitly uses contain.
  return { bytes: await sharp(sources[0].bytes).rotate().jpeg({quality:92}).toBuffer(), adaptation: { verdict: "risk" as const, mode: "preserved" as const, sourceFilename: sources[0].name, reason: "没有可确认安全的满铺裁切，暂时完整显示原图；请核对原图或换用其他角度" } };
}

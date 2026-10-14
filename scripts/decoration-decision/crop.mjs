// Cut individual assets out of the generated sheets.
// Detection is fully driven by what is actually in the image (connected
// components of non-separator pixels), so irregular model layouts still crop.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const isSeparator = (data, W, ch) => (x, y) => {
  const p = (y * W + x) * ch;
  const r = data[p], g = data[p + 1], b = data[p + 2];
  return r > 170 && b > 170 && g < 130 && r - g > 75 && b - g > 75;
};

// Connected components of non-separator pixels → bounding boxes (40px min).
function detectComponents(data, W, H, ch) {
  const sep = isSeparator(data, W, ch);
  const visited = new Uint8Array(W * H);
  const boxes = [];
  const stack = [];
  for (let y0 = 0; y0 < H; y0++) {
    for (let x0 = 0; x0 < W; x0++) {
      const idx0 = y0 * W + x0;
      if (visited[idx0] || sep(x0, y0)) continue;
      let minX = x0, maxX = x0, minY = y0, maxY = y0;
      stack.length = 0;
      stack.push(x0, y0);
      visited[idx0] = 1;
      while (stack.length) {
        const y = stack.pop(), x = stack.pop();
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          const nidx = ny * W + nx;
          if (visited[nidx] || sep(nx, ny)) continue;
          visited[nidx] = 1;
          stack.push(nx, ny);
        }
      }
      const w = maxX - minX + 1, h = maxY - minY + 1;
      if (w > 40 && h > 40) boxes.push({ left: minX, top: minY, width: w, height: h });
    }
  }
  return boxes;
}

const detectBoxes = file => sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => ({
  boxes: detectComponents(data, info.width, info.height, info.channels),
}));

const sepCountIn = (sep, rect) => {
  let n = 0;
  for (let y = rect.top; y < rect.top + rect.height; y++) for (let x = rect.left; x < rect.left + rect.width; x++) if (sep(x, y)) n++;
  return n;
};

// Center-crop to the target aspect ratio; tolerate up to 20% removed area,
// otherwise give up cropping and let the browser's object-fit handle it.
function ratioCrop(rect, target) {
  const source = rect.width / rect.height;
  const t = target[0] / target[1];
  let width = rect.width, height = rect.height;
  if (source > t) width = Math.round(rect.height * t);
  else height = Math.round(rect.width / t);
  const removed = 1 - (width * height) / (rect.width * rect.height);
  if (removed > 0.20) return null;
  return {
    left: rect.left + Math.floor((rect.width - width) / 2),
    top: rect.top + Math.floor((rect.height - height) / 2),
    width, height, removed,
  };
}

const readOrder = (a, b) => (a.top - b.top) / 80 || a.left - b.left;

export async function cropSheets(sheets, assets, dir, onNote) {
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  const notes = [];
  for (const sheet of sheets) {
    const mine = assets.filter(a => a.sheet === sheet.file && a.status === 'generated');
    if (!mine.length) continue;
    const source = path.join(dir, sheet.file);
    let detected;
    try {
      ({ boxes: detected } = await detectBoxes(source));
    } catch {
      for (const a of mine) a.status = 'failed', a.note = '拼板图片无法解码。';
      continue;
    }
    const sepBuf = await sharp(source).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const sep = isSeparator(sepBuf.data, sepBuf.info.width, sepBuf.info.channels);
    // Planned order = grid order = reading order; detected boxes sort the same.
    const plannedOrder = [...mine].sort((a, b) => a.id.localeCompare(b.id));
    const boxes = [...detected].sort(readOrder);
    const comps = boxes.map(b => ({ ...b, cx: b.left + b.width / 2, cy: b.top + b.height / 2 }));
    const used = new Set();
    const inset = (r, f) => ({
      left: Math.round(r.left + r.width * f),
      top: Math.round(r.top + r.height * f),
      width: Math.round(r.width * (1 - 2 * f)),
      height: Math.round(r.height * (1 - 2 * f)),
    });
    for (let i = 0; i < plannedOrder.length; i++) {
      const asset = plannedOrder[i];
      const planned = sheet.cells.find(c => c.assetId === asset.id);
      let base;
      if (boxes.length === plannedOrder.length) {
        base = boxes[i]; // same count → positional match is exact
      } else {
        // count mismatch → nearest unused component to the planned center
        const pcx = planned ? planned.x + planned.w / 2 : CANVAS_CENTER.x;
        const pcy = planned ? planned.y + planned.h / 2 : CANVAS_CENTER.y;
        let best = null, bestDist = Infinity;
        for (let j = 0; j < comps.length; j++) {
          if (used.has(j)) continue;
          const d = (comps[j].cx - pcx) ** 2 + (comps[j].cy - pcy) ** 2;
          if (d < bestDist) { bestDist = d; best = j; }
        }
        if (best !== null) { used.add(best); base = comps[best]; }
        else base = planned ? { left: Math.round(planned.x), top: Math.round(planned.y), width: Math.round(planned.w), height: Math.round(planned.h) } : boxes[0];
      }
      if (!base) { asset.status = 'failed'; asset.note = '拼板中未检测到可用区域。'; continue; }
      // Inset progressively; allow a tiny fraction of separator pixels.
      const candidates = [base, inset(base, 0.02), inset(base, 0.04), inset(base, 0.06), inset(base, 0.08)];
      let rect = null;
      for (const candidate of candidates) {
        if (candidate.width < 64 || candidate.height < 64) continue;
        const sepPct = sepCountIn(sep, candidate) / (candidate.width * candidate.height);
        if (sepPct < 0.005) { rect = candidate; break; }
      }
      if (!rect) { rect = inset(base, 0.10); if (rect.width < 64 || rect.height < 64) { asset.status = 'failed'; asset.note = '裁剪区域过小。'; continue; } }
      // Clamp to image bounds before extracting.
      rect = {
        left: Math.max(0, rect.left), top: Math.max(0, rect.top),
        width: Math.min(rect.width, sepBuf.info.width - Math.max(0, rect.left)),
        height: Math.min(rect.height, sepBuf.info.height - Math.max(0, rect.top)),
      };
      if (rect.width < 64 || rect.height < 64) { asset.status = 'failed'; asset.note = '裁剪区域越界。'; continue; }
      // Crop to ratio when cheap; otherwise keep the full cell and let
      // object-fit cover the slot — never fail an asset over aspect ratio.
      const cropped = ratioCrop(rect, asset.ratio) || rect;
      const file = `assets/${asset.id}.png`;
      await sharp(source).extract({ left: cropped.left, top: cropped.top, width: cropped.width, height: cropped.height }).png().toFile(path.join(dir, file));
      asset.status = 'ready';
      asset.file = file;
      asset.width = cropped.width;
      asset.height = cropped.height;
      if (Math.min(cropped.width, cropped.height) < 300) notes.push(`素材 ${asset.id}（${asset.use}）仅 ${cropped.width}×${cropped.height} 像素，页面上会偏软，未放大伪造细节。`);
    }
  }
  for (const a of assets) if (a.status === 'pending' || a.status === 'generated') { a.status = 'failed'; a.note = a.note || '该素材未进入任何拼板。'; }
  if (notes.length) onNote?.(notes.join('；'));
  return assets;
}

const CANVAS_CENTER = { x: 768, y: 576 };

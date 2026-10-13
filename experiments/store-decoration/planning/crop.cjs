const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { aspectRatios, validatePlan } = require('./plan.cjs');
function runs(values) {
  const spans = []; let start = null;
  for (let i = 0; i <= values.length; i++) {
    if (i < values.length && values[i]) { if (start === null) start = i; }
    else if (start !== null) { if (i - start > 5) spans.push([start, i]); start = null; }
  }
  return spans;
}
async function cropBatch(bytes, input, batchId, folder) {
  const { plan } = validatePlan(input), batch = plan.batches.find(b => b.id === batchId);
  if (!batch) throw new Error('批次不存在');
  const normalized = await sharp(bytes, { limitInputPixels: 40000000 }).rotate().removeAlpha().png().toBuffer();
  const { data, info } = await sharp(normalized).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const magenta = (x, y) => { const i = (y * width + x) * channels; return data[i] > 170 && data[i + 2] > 170 && data[i + 1] < 130 && data[i] - data[i + 1] > 75 && data[i + 2] - data[i + 1] > 75; };
  const rows = runs(Array.from({ length: height }, (_, y) => { let count = 0; for (let x = 0; x < width; x++) if (!magenta(x, y)) count++; return count / width > .12; }));
  if (rows.length !== batch.rows.length) throw new Error(`识别到${rows.length}行，方案需要${batch.rows.length}行。请使用本批次完整总图，保留洋红色分隔带。`);
  const panels = [];
  rows.forEach(([y0, y1], rowIndex) => {
    const cols = runs(Array.from({ length: width }, (_, x) => { let count = 0; for (let y = y0; y < y1; y++) if (!magenta(x, y)) count++; return count / (y1 - y0) > .97; }));
    if (cols.length !== batch.rows[rowIndex].length) throw new Error(`第${rowIndex + 1}行识别到${cols.length}张，需要${batch.rows[rowIndex].length}张；未猜测裁剪位置。`);
    cols.forEach(([x0, x1], columnIndex) => panels.push({ id: batch.rows[rowIndex][columnIndex], rect: { left: x0 + 1, top: y0 + 1, width: x1 - x0 - 2, height: y1 - y0 - 2 } }));
  });
  // Prepare every crop before writing any result, so an invalid sheet leaves the current preview intact.
  const prepared = [];
  for (const panel of panels) {
    const asset = plan.assets.find(a => a.id === panel.id), ratio = aspectRatios[asset.aspect], box = panel.rect;
    const cropWidth = Math.min(box.width, Math.floor(box.height * ratio)), cropHeight = Math.min(box.height, Math.floor(box.width / ratio));
    const rect = { left: box.left + Math.floor((box.width - cropWidth) / 2), top: box.top + Math.floor((box.height - cropHeight) / 2), width: cropWidth, height: cropHeight };
    if (Math.min(cropWidth, cropHeight) < 100) throw new Error(`${panel.id} 裁剪后短边不足100像素，请提高总图尺寸或减少同图画面数。`);
    const removed = 1 - cropWidth * cropHeight / (box.width * box.height);
    if (removed > .3) throw new Error(`${panel.id} 比例偏差导致裁剪超过30%，本批次暂不填入。`);
    let separators = 0;
    for (let y = rect.top; y < rect.top + rect.height; y++) for (let x = rect.left; x < rect.left + rect.width; x++) if (magenta(x, y)) separators++;
    if (separators) throw new Error(`${panel.id} 内仍有分隔色，未写入素材。`);
    const buffer = await sharp(normalized).extract(rect).png().toBuffer();
    prepared.push({ buffer, report: { assetId: panel.id, detectedRect: box, cropRect: rect, aspect: asset.aspect, removedAreaPercent: +(removed * 100).toFixed(2), upscaled: false } });
  }
  fs.mkdirSync(path.join(folder, 'assets'), { recursive: true });
  for (const item of prepared) fs.writeFileSync(path.join(folder, 'assets', `${item.report.assetId}.png`), item.buffer);
  fs.writeFileSync(path.join(folder, `${batchId}-source.png`), normalized);
  const report = { batchId, sourceDimensions: [width, height], crops: prepared.map(x => x.report), newGenerationCalls: 0, method: 'Detected magenta boundaries, then center crop; no resizing or stretching' };
  fs.writeFileSync(path.join(folder, `${batchId}-crop-report.json`), JSON.stringify(report, null, 2));
  return report;
}
module.exports = { cropBatch };

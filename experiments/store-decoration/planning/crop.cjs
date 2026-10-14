const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { aspectRatios, validatePlan } = require('./plan.cjs');
const { entries } = require('./catalog.cjs');
function runs(values) {
  const spans = []; let start = null;
  for (let i = 0; i <= values.length; i++) {
    if (i < values.length && values[i]) { if (start === null) start = i; }
    else if (start !== null) { if (i - start > 5) spans.push([start, i]); start = null; }
  }
  return spans;
}
async function cropBatch(bytes, input, batchId, folder, compiledBatch) {
  const { plan } = validatePlan(input), originalBatch = plan.batches.find(b => b.id === batchId);
  const batch = compiledBatch || originalBatch;
  if (!batch) throw new Error('批次不存在');
  if (!originalBatch || batch.id !== batchId || batch.rows.flat().some(id => !originalBatch.rows.flat().includes(id))) throw new Error('有效批次与原方案不一致');
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
    // Generated separators can end a pixel or two unevenly. Trim only contaminated
    // outer edges within a small limit; interior separator pixels still fail below.
    const clean = { ...box }, boundaryTrim = { left: 0, top: 0, right: 0, bottom: 0 };
    const edgeLimit = Math.max(2, Math.min(8, Math.ceil(Math.min(box.width, box.height) * .01)));
    for (let pass = 0; pass < edgeLimit; pass++) {
      const dirty = { left: false, top: false, right: false, bottom: false };
      for (let x = clean.left; x < clean.left + clean.width; x++) {
        dirty.top ||= magenta(x, clean.top);
        dirty.bottom ||= magenta(x, clean.top + clean.height - 1);
      }
      for (let y = clean.top; y < clean.top + clean.height; y++) {
        dirty.left ||= magenta(clean.left, y);
        dirty.right ||= magenta(clean.left + clean.width - 1, y);
      }
      if (!Object.values(dirty).some(Boolean)) break;
      if (dirty.left) { clean.left++; clean.width--; boundaryTrim.left++; }
      if (dirty.right) { clean.width--; boundaryTrim.right++; }
      if (dirty.top) { clean.top++; clean.height--; boundaryTrim.top++; }
      if (dirty.bottom) { clean.height--; boundaryTrim.bottom++; }
    }
    const cropWidth = Math.min(clean.width, Math.floor(clean.height * ratio)), cropHeight = Math.min(clean.height, Math.floor(clean.width / ratio));
    const rect = { left: clean.left + Math.floor((clean.width - cropWidth) / 2), top: clean.top + Math.floor((clean.height - cropHeight) / 2), width: cropWidth, height: cropHeight };
    if (Math.min(cropWidth, cropHeight) < 100) throw new Error(`${panel.id} 裁剪后短边不足100像素，请提高总图尺寸或减少同图画面数。`);
    const removed = 1 - cropWidth * cropHeight / (box.width * box.height);
    const smallCategory = asset.direction?.role === 'category' && plan.modules.every(m => m.props.assetIds.every((id, i) => id !== asset.id || entries[m.type].slots[i].width <= 200));
    const cropLimit = smallCategory ? .35 : .3;
    const padded = removed > cropLimit && plan.imageMode === 'category-inspired';
    const outputWidth = Math.max(clean.width, Math.ceil(clean.height * ratio));
    const outputHeight = Math.max(clean.height, Math.ceil(clean.width / ratio));
    const paddingFraction = 1 - clean.width * clean.height / (outputWidth * outputHeight);
    if (removed > cropLimit && (!padded || paddingFraction > .55 || outputWidth * outputHeight > 40000000)) throw new Error(`${panel.id} 比例偏差过大，无法在保留画面的前提下适配；本批次暂不填入。`);
    const extracted = padded ? clean : rect;
    let separators = 0;
    for (let y = extracted.top; y < extracted.top + extracted.height; y++) for (let x = extracted.left; x < extracted.left + extracted.width; x++) if (magenta(x, y)) separators++;
    if (separators) throw new Error(`${panel.id} 内仍有分隔色，未写入素材。`);
    let pipeline = sharp(normalized).extract(extracted);
    if (padded) {
      const horizontal = outputWidth - clean.width, vertical = outputHeight - clean.height;
      pipeline = pipeline.extend({ left: Math.floor(horizontal / 2), right: Math.ceil(horizontal / 2), top: Math.floor(vertical / 2), bottom: Math.ceil(vertical / 2), background: plan.style.palette[0] });
    }
    const buffer = await pipeline.png().toBuffer();
    prepared.push({ buffer, report: { assetId: panel.id, detectedRect: box, boundaryTrim, cropRect: extracted, aspect: asset.aspect, fitMethod: padded ? 'contain-with-background' : 'center-crop', paddingAreaPercent: padded ? +(paddingFraction * 100).toFixed(2) : 0, removedAreaPercent: +((padded ? 1 - clean.width * clean.height / (box.width * box.height) : removed) * 100).toFixed(2), allowedRemovedAreaPercent: cropLimit * 100, framingReviewRequired: padded || removed > .3, upscaled: false } });
  }
  fs.mkdirSync(path.join(folder, 'assets'), { recursive: true });
  for (const item of prepared) fs.writeFileSync(path.join(folder, 'assets', `${item.report.assetId}.png`), item.buffer);
  fs.writeFileSync(path.join(folder, `${batchId}-source.png`), normalized);
  const report = { batchId, sourceDimensions: [width, height], crops: prepared.map(x => x.report), newGenerationCalls: 0, method: 'Detected magenta boundaries, bounded outer-edge cleanup, then center crop or bounded background padding; no resizing or stretching' };
  fs.writeFileSync(path.join(folder, `${batchId}-crop-report.json`), JSON.stringify(report, null, 2));
  return report;
}
module.exports = { cropBatch };

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { aspectRatios, validatePlan } = require('./plan.cjs');
const { entries } = require('./catalog.cjs');
const { bakeArtwork } = require('./slot-artwork.cjs');
function runs(values) {
  const spans = []; let start = null;
  for (let i = 0; i <= values.length; i++) {
    if (i < values.length && values[i]) { if (start === null) start = i; }
    else if (start !== null) { if (i - start > 5) spans.push([start, i]); start = null; }
  }
  return spans;
}
function boundarySeparators(isSeparatorColor, box, imageWidth, imageHeight) {
  // The detected panel is inset by one pixel. Include its surrounding band,
  // then follow only matching colors connected to that outer perimeter.
  const left = Math.max(0, box.left - 2), top = Math.max(0, box.top - 2);
  const right = Math.min(imageWidth, box.left + box.width + 2), bottom = Math.min(imageHeight, box.top + box.height + 2);
  const width = right - left, height = bottom - top;
  const mask = new Uint8Array(width * height), pending = [];
  const visit = (x, y) => {
    const index = y * width + x;
    if (mask[index]) return;
    mask[index] = 2;
    if (isSeparatorColor(left + x, top + y)) { mask[index] = 1; pending.push(index); }
  };
  for (let x = 0; x < width; x++) { visit(x, 0); visit(x, height - 1); }
  for (let y = 0; y < height; y++) { visit(0, y); visit(width - 1, y); }
  while (pending.length) {
    const index = pending.pop(), x = index % width, y = Math.floor(index / width);
    for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
      for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) visit(nx, ny);
    }
  }
  // A similarly colored gemstone inside the panel is not separator residue.
  return (x, y) => x >= left && x < right && y >= top && y < bottom && mask[(y - top) * width + x - left] === 1;
}
async function cropBatch(bytes, input, batchId, folder, compiledBatch) {
  const { plan } = validatePlan(input), originalBatch = plan.batches.find(b => b.id === batchId);
  const batch = compiledBatch || originalBatch;
  if (!batch) throw new Error('批次不存在');
  if (!originalBatch || batch.id !== batchId || batch.rows.flat().some(id => !originalBatch.rows.flat().includes(id))) throw new Error('有效批次与原方案不一致');
  const normalized = await sharp(bytes, { limitInputPixels: 40000000 }).rotate().removeAlpha().png().toBuffer();
  const { data, info } = await sharp(normalized).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const standardMagenta = (x, y) => { const i = (y * width + x) * channels; return data[i] > 170 && data[i + 2] > 170 && data[i + 1] < 130 && data[i] - data[i + 1] > 75 && data[i + 2] - data[i + 1] > 75; };
  let magenta = standardMagenta, calibratedSeparatorColor = null, separatorCalibrationSource = null;
  const pixel = (x, y) => { const i = (y * width + x) * channels; return [data[i], data[i + 1], data[i + 2]]; };
  const detectRows = isSeparator => runs(Array.from({ length: height }, (_, y) => { let count = 0; for (let x = 0; x < width; x++) if (!isSeparator(x, y)) count++; return count / width > .12; }));
  const detectColumns = ([y0, y1], isSeparator) => runs(Array.from({ length: width }, (_, x) => { let count = 0; for (let y = y0; y < y1; y++) if (!isSeparator(x, y)) count++; return count / (y1 - y0) > .97; }));
  let rows = detectRows(magenta);
  // Generated magenta can shift toward pink. Keep successful standard detection
  // unchanged; only calibrate from a consistent outer frame when rows disagree.
  if (rows.length !== batch.rows.length) {
    const pink = ([r, g, b]) => r > 170 && b > 130 && g < 130 && r - g > 75 && b - g > 75;
    const inset = Math.max(1, Math.min(4, Math.floor(Math.min(width, height) * .005)));
    const edges = [[], [], [], []];
    for (let x = inset; x < width - inset; x += 8) { edges[0].push(pixel(x, inset)); edges[1].push(pixel(x, height - 1 - inset)); }
    for (let y = inset; y < height - inset; y += 8) { edges[2].push(pixel(inset, y)); edges[3].push(pixel(width - 1 - inset, y)); }
    if (edges.every(edge => edge.length && edge.filter(pink).length / edge.length >= .9)) {
      const samples = edges.flat().filter(pink);
      const reference = [0, 1, 2].map(channel => samples.map(rgb => rgb[channel]).sort((a, b) => a - b)[Math.floor(samples.length / 2)]);
      const nearFrame = rgb => pink(rgb) && rgb.every((value, channel) => Math.abs(value - reference[channel]) <= 40);
      // Each edge must support the same measured color, not merely contain pink objects.
      if (edges.every(edge => edge.filter(nearFrame).length / edge.length >= .9)) {
        const calibrated = (x, y) => standardMagenta(x, y) || nearFrame(pixel(x, y));
        const candidateRows = detectRows(calibrated);
        if (candidateRows.length === batch.rows.length) {
          magenta = calibrated; rows = candidateRows; calibratedSeparatorColor = reference;
        }
      }
    }
  }
  // Some sheets omit the outer frame and use rose-pink internal dividers.
  // Calibrate only from narrow, full-width bands matching every planned row gap.
  // Use perimeter-connected pixels so similarly colored gems remain content.
  if (rows.length !== batch.rows.length && batch.rows.length > 1) {
    const rose = ([r, g, b]) => r > 150 && b > 75 && g < 100 && r - g > 90 && b - g > 50;
    const sampleXs = Array.from({ length: Math.ceil(width / 8) }, (_, i) => i * 8);
    const bands = runs(Array.from({ length: height }, (_, y) => sampleXs.filter(x => rose(pixel(x, y))).length / sampleXs.length >= .9));
    const maxBandHeight = Math.max(6, Math.ceil(width * .06));
    if (bands.length === batch.rows.length - 1 && bands.every(([y0, y1]) => y0 > 0 && y1 < height && y1 - y0 <= maxBandHeight)) {
      const bandSamples = bands.map(([y0, y1]) => sampleXs.map(x => pixel(x, Math.floor((y0 + y1) / 2))));
      const samples = bandSamples.flat().filter(rose);
      const reference = [0, 1, 2].map(channel => samples.map(rgb => rgb[channel]).sort((a, b) => a - b)[Math.floor(samples.length / 2)]);
      const nearBand = rgb => rose(rgb) && rgb.every((value, channel) => Math.abs(value - reference[channel]) <= 60);
      if (bandSamples.every(sample => sample.filter(nearBand).length / sample.length >= .9)) {
        const calibrated = boundarySeparators((x, y) => standardMagenta(x, y) || nearBand(pixel(x, y)), { left: 0, top: 0, width, height }, width, height);
        const candidateRows = detectRows(calibrated);
        if (candidateRows.length === batch.rows.length && candidateRows.every((row, i) => detectColumns(row, calibrated).length === batch.rows[i].length)) {
          magenta = calibrated; rows = candidateRows; calibratedSeparatorColor = reference; separatorCalibrationSource = 'internal-bands';
        }
      }
    }
  }
  if (rows.length !== batch.rows.length) throw new Error(`识别到${rows.length}行，方案需要${batch.rows.length}行。请使用本批次完整总图，保留洋红色分隔带。`);
  const panels = [];
  rows.forEach(([y0, y1], rowIndex) => {
    const cols = detectColumns([y0, y1], magenta);
    if (cols.length !== batch.rows[rowIndex].length) throw new Error(`第${rowIndex + 1}行识别到${cols.length}张，需要${batch.rows[rowIndex].length}张；未猜测裁剪位置。`);
    cols.forEach(([x0, x1], columnIndex) => panels.push({ id: batch.rows[rowIndex][columnIndex], rect: { left: x0 + 1, top: y0 + 1, width: x1 - x0 - 2, height: y1 - y0 - 2 } }));
  });
  // Prepare every crop before writing any result, so an invalid sheet leaves the current preview intact.
  const prepared = [];
  for (const panel of panels) {
    const asset = plan.assets.find(a => a.id === panel.id), ratio = aspectRatios[asset.aspect], box = panel.rect;
    const separator = boundarySeparators(magenta, box, width, height);
    // Generated separators can end a pixel or two unevenly. Trim only contaminated
    // outer edges within a small limit; connected separator residue still fails below.
    const clean = { ...box }, boundaryTrim = { left: 0, top: 0, right: 0, bottom: 0 };
    const edgeLimit = Math.max(2, Math.min(8, Math.ceil(Math.min(box.width, box.height) * .01)));
    for (let pass = 0; pass < edgeLimit; pass++) {
      const dirty = { left: false, top: false, right: false, bottom: false };
      for (let x = clean.left; x < clean.left + clean.width; x++) {
        dirty.top ||= separator(x, clean.top);
        dirty.bottom ||= separator(x, clean.top + clean.height - 1);
      }
      for (let y = clean.top; y < clean.top + clean.height; y++) {
        dirty.left ||= separator(clean.left, y);
        dirty.right ||= separator(clean.left + clean.width - 1, y);
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
    for (let y = extracted.top; y < extracted.top + extracted.height; y++) for (let x = extracted.left; x < extracted.left + extracted.width; x++) if (separator(x, y)) separators++;
    if (separators) throw new Error(`${panel.id} 内仍有分隔色，未写入素材。`);
    let pipeline = sharp(normalized).extract(extracted);
    if (padded) {
      const horizontal = outputWidth - clean.width, vertical = outputHeight - clean.height;
      pipeline = pipeline.extend({ left: Math.floor(horizontal / 2), right: Math.ceil(horizontal / 2), top: Math.floor(vertical / 2), bottom: Math.ceil(vertical / 2), background: plan.style.palette[0] });
    }
    const rawBuffer = await pipeline.png().toBuffer();
    const baked = plan.delivery === 'platform-slots-v1' && !!asset.artwork;
    const buffer = baked ? await bakeArtwork(rawBuffer, asset.artwork) : rawBuffer;
    prepared.push({ buffer, ...(baked ? { rawBuffer } : {}), report: { assetId: panel.id, detectedRect: box, boundaryTrim, cropRect: extracted, aspect: asset.aspect, fitMethod: padded ? 'contain-with-background' : 'center-crop', paddingAreaPercent: padded ? +(paddingFraction * 100).toFixed(2) : 0, removedAreaPercent: +((padded ? 1 - clean.width * clean.height / (box.width * box.height) : removed) * 100).toFixed(2), allowedRemovedAreaPercent: cropLimit * 100, framingReviewRequired: padded || removed > .3, upscaled: false, ...(baked ? { copyBaked: true } : {}) } });
  }
  fs.mkdirSync(path.join(folder, 'assets'), { recursive: true });
  if (prepared.some(item => item.rawBuffer)) {
    fs.mkdirSync(path.join(folder, 'source-assets'), { recursive: true });
    for (const item of prepared) if (item.rawBuffer) fs.writeFileSync(path.join(folder, 'source-assets', `${item.report.assetId}.png`), item.rawBuffer);
  }
  for (const item of prepared) fs.writeFileSync(path.join(folder, 'assets', `${item.report.assetId}.png`), item.buffer);
  fs.writeFileSync(path.join(folder, `${batchId}-source.png`), normalized);
  const report = { batchId, sourceDimensions: [width, height], crops: prepared.map(x => x.report), newGenerationCalls: 0, method: 'Detected magenta boundaries, bounded outer-edge cleanup, then center crop or bounded background padding; no resizing or stretching' };
  if (calibratedSeparatorColor) report.calibratedSeparatorColor = calibratedSeparatorColor;
  if (separatorCalibrationSource) report.separatorCalibrationSource = separatorCalibrationSource;
  fs.writeFileSync(path.join(folder, `${batchId}-crop-report.json`), JSON.stringify(report, null, 2));
  return report;
}
module.exports = { cropBatch };

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
function framedPanels(isSeparator, width, height, plannedRows) {
  // Separate outlined panels can sit on a non-magenta page with outer margins
  // and gaps between frames. Those exterior pixels are not content rows.
  // Find enclosed interiors from the actual borders, never from guessed ratios.
  const visited = new Uint8Array(width * height), queue = new Int32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (isSeparator(x, y)) visited[y * width + x] = 1;
  }
  const boxes = [];
  for (let seed = 0; seed < visited.length; seed++) {
    if (visited[seed]) continue;
    let head = 0, tail = 1, left = width, top = height, right = 0, bottom = 0, exterior = false;
    queue[0] = seed; visited[seed] = 1;
    const visit = index => { if (!visited[index]) { visited[index] = 1; queue[tail++] = index; } };
    while (head < tail) {
      const index = queue[head++], x = index % width, y = Math.floor(index / width);
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      if (!x || !y || x === width - 1 || y === height - 1) exterior = true;
      if (x) visit(index - 1);
      if (x < width - 1) visit(index + 1);
      if (y) visit(index - width);
      if (y < height - 1) visit(index + width);
    }
    const boxWidth = right - left + 1, boxHeight = bottom - top + 1;
    if (exterior || Math.min(boxWidth, boxHeight) < 100) continue;
    if (tail / (boxWidth * boxHeight) < .97) return null;
    boxes.push({ left, top, width: boxWidth, height: boxHeight });
  }
  if (boxes.length !== plannedRows.flat().length) return null;
  const groups = [];
  for (const box of boxes.sort((a, b) => a.top - b.top || a.left - b.left)) {
    const row = groups.find(group => {
      const first = group[0], tolerance = Math.max(3, Math.round(Math.min(first.height, box.height) * .03));
      return Math.abs(first.top - box.top) <= tolerance && Math.abs(first.top + first.height - box.top - box.height) <= tolerance;
    });
    if (row) row.push(box); else groups.push([box]);
  }
  if (groups.length !== plannedRows.length) return null;
  const panels = [];
  for (const [rowIndex, group] of groups.entries()) {
    if (group.length !== plannedRows[rowIndex].length) return null;
    if (rowIndex && Math.min(...group.map(b => b.top)) < Math.max(...groups[rowIndex - 1].map(b => b.top + b.height))) return null;
    group.sort((a, b) => a.left - b.left);
    for (const [columnIndex, box] of group.entries()) {
      if (columnIndex && box.left < group[columnIndex - 1].left + group[columnIndex - 1].width) return null;
      panels.push({ id: plannedRows[rowIndex][columnIndex], rect: {
        left: box.left + 1, top: box.top + 1, width: box.width - 2, height: box.height - 2,
      } });
    }
  }
  return panels;
}
function locatePanels(isSeparator, width, height, plannedRows) {
  const rows = runs(Array.from({ length: height }, (_, y) => {
    let count = 0; for (let x = 0; x < width; x++) if (!isSeparator(x, y)) count++;
    return count / width > .12;
  }));
  const columns = rows.map(([y0, y1]) => runs(Array.from({ length: width }, (_, x) => {
    let count = 0; for (let y = y0; y < y1; y++) if (!isSeparator(x, y)) count++;
    return count / (y1 - y0) > .97;
  })));
  if (rows.length === plannedRows.length && columns.every((cols, i) => cols.length === plannedRows[i].length)) {
    return { rows, columns, panels: rows.flatMap(([y0, y1], rowIndex) => columns[rowIndex].map(([x0, x1], columnIndex) => ({
      id: plannedRows[rowIndex][columnIndex], rect: { left: x0 + 1, top: y0 + 1, width: x1 - x0 - 2, height: y1 - y0 - 2 },
    }))), framed: false };
  }
  return { rows, columns, panels: framedPanels(isSeparator, width, height, plannedRows), framed: true };
}
function boundaryColors(panels, pixel, isPink, width, height) {
  const samples = [];
  for (const { rect: b } of panels) {
    const sides = [
      { length: b.height, room: b.left, point: (i, d) => [b.left - d, b.top + i] },
      { length: b.height, room: width - b.left - b.width, point: (i, d) => [b.left + b.width - 1 + d, b.top + i] },
      { length: b.width, room: b.top, point: (i, d) => [b.left + i, b.top - d] },
      { length: b.width, room: height - b.top - b.height, point: (i, d) => [b.left + i, b.top + b.height - 1 + d] },
    ];
    for (const side of sides) {
      // A sheet without an outside frame may end directly at the image edge.
      if (side.room <= 2) continue;
      let hits = 0, count = 0;
      for (let i = Math.ceil(side.length * .05); i < side.length * .95; i += 8) {
        count++;
        for (let distance = 1; distance <= Math.min(8, side.room); distance++) {
          const [x, y] = side.point(i, distance), rgb = pixel(x, y);
          if (isPink(rgb)) { samples.push(rgb); hits++; break; }
        }
      }
      if (!count || hits / count < .9) return null;
    }
  }
  return samples.length >= 10 ? samples : null;
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
  let magenta = standardMagenta, calibratedSeparatorColor = null, calibratedSeparatorRange = null;
  const pixel = (x, y) => { const i = (y * width + x) * channels; return [data[i], data[i + 1], data[i + 2]]; };
  let located = locatePanels(magenta, width, height, batch.rows);
  {
    // Color drift and layout are validated together. The old calibration only
    // handled edge-to-edge gutters, leaving outlined panels with page margins
    // on the fixed-color path. Never calibrate from arbitrary pink objects:
    // first require the complete requested geometry, then sample its borders.
    // Check even when standard counts happen to match: a single rose-framed
    // picture would otherwise be mistaken for the entire unframed sheet.
    const pink = ([r, g, b]) => r > 150 && b > 75 && g < 140 && r - g > 75 && b - g > 50;
    const candidate = locatePanels((x, y) => pink(pixel(x, y)), width, height, batch.rows);
    const differentBounds = JSON.stringify(candidate.panels) !== JSON.stringify(located.panels);
    const samples = candidate.panels && differentBounds && boundaryColors(candidate.panels, pixel, pink, width, height);
    if (samples) {
      const sorted = [0, 1, 2].map(channel => samples.map(rgb => rgb[channel]).sort((a, b) => a - b));
      const range = sorted.map(values => [Math.max(0, values[Math.floor(values.length * .05)] - 24), Math.min(255, values[Math.floor(values.length * .95)] + 24)]);
      const calibrated = (x, y) => {
        const rgb = pixel(x, y);
        return standardMagenta(x, y) || pink(rgb) && rgb.every((value, channel) => value >= range[channel][0] && value <= range[channel][1]);
      };
      const checked = locatePanels(calibrated, width, height, batch.rows);
      if (checked.panels) {
        located = checked; magenta = calibrated;
        calibratedSeparatorColor = sorted.map(values => values[Math.floor(values.length / 2)]);
        calibratedSeparatorRange = range;
      }
    }
  }
  if (!located.panels) {
    if (located.rows.length !== batch.rows.length) throw new Error(`识别到${located.rows.length}行，方案需要${batch.rows.length}行。已保存总图，分隔边界尚不能可靠对应，未猜测裁剪位置。`);
    const rowIndex = located.columns.findIndex((cols, i) => cols.length !== batch.rows[i].length);
    throw new Error(`第${rowIndex + 1}行识别到${located.columns[rowIndex].length}张，需要${batch.rows[rowIndex].length}张；已保存总图，未猜测裁剪位置。`);
  }
  const panels = located.panels;
  // Prepare every crop before writing any result, so an invalid sheet leaves the current preview intact.
  const prepared = [];
  for (const panel of panels) {
    const asset = plan.assets.find(a => a.id === panel.id), ratio = aspectRatios[asset.aspect], box = panel.rect;
    const separator = boundarySeparators(magenta, box, width, height);
    // Pale antialiasing is only removable in the outer four pixels, with an
    // actual solid divider directly outside that edge. Do not flood through
    // pale product/background colors or connect previously isolated pink items.
    const fringe = (x, y) => {
      const [r, g, b] = pixel(x, y);
      if (!(r > 170 && b > 130 && r - g > 8 && b - g > 8)) return false;
      const edges = [[x - box.left, -1, 0], [box.left + box.width - 1 - x, 1, 0], [y - box.top, 0, -1], [box.top + box.height - 1 - y, 0, 1]];
      return edges.some(([distance, dx, dy]) => {
        if (distance >= 4) return false;
        for (let step = Math.max(1, distance + 1); step <= distance + 8; step++) {
          const sx = x + step * dx, sy = y + step * dy;
          if (sx >= 0 && sy >= 0 && sx < width && sy < height && magenta(sx, sy)) return true;
        }
        return false;
      });
    };
    // Generated separators can end a pixel or two unevenly. Trim only contaminated
    // outer edges within a small limit; connected separator residue still fails below.
    const clean = { ...box }, boundaryTrim = { left: 0, top: 0, right: 0, bottom: 0 };
    const edgeLimit = Math.max(4, Math.min(8, Math.ceil(Math.min(box.width, box.height) * .01)));
    // Compressed edge ringing can leave a clean pixel before a pink pixel.
    // Measure the whole narrow edge strip, not just its first scanline.
    for (let distance = 0; distance < 4; distance++) {
      for (let x = box.left; x < box.left + box.width; x++) {
        if (fringe(x, box.top + distance)) boundaryTrim.top = distance + 1;
        if (fringe(x, box.top + box.height - 1 - distance)) boundaryTrim.bottom = distance + 1;
      }
      for (let y = box.top; y < box.top + box.height; y++) {
        if (fringe(box.left + distance, y)) boundaryTrim.left = distance + 1;
        if (fringe(box.left + box.width - 1 - distance, y)) boundaryTrim.right = distance + 1;
      }
    }
    clean.left += boundaryTrim.left; clean.top += boundaryTrim.top;
    clean.width -= boundaryTrim.left + boundaryTrim.right; clean.height -= boundaryTrim.top + boundaryTrim.bottom;
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
      if (dirty.left && boundaryTrim.left < edgeLimit) { clean.left++; clean.width--; boundaryTrim.left++; }
      if (dirty.right && boundaryTrim.right < edgeLimit) { clean.width--; boundaryTrim.right++; }
      if (dirty.top && boundaryTrim.top < edgeLimit) { clean.top++; clean.height--; boundaryTrim.top++; }
      if (dirty.bottom && boundaryTrim.bottom < edgeLimit) { clean.height--; boundaryTrim.bottom++; }
    }
    const cropWidth = Math.min(clean.width, Math.floor(clean.height * ratio)), cropHeight = Math.min(clean.height, Math.floor(clean.width / ratio));
    const rect = { left: clean.left + Math.floor((clean.width - cropWidth) / 2), top: clean.top + Math.floor((clean.height - cropHeight) / 2), width: cropWidth, height: cropHeight };
    if (Math.min(cropWidth, cropHeight) < 100) throw new Error(`${panel.id} 裁剪后短边不足100像素，请提高总图尺寸或减少同图画面数。`);
    const removed = 1 - cropWidth * cropHeight / (box.width * box.height);
    const smallCategory = asset.direction?.role === 'category' && plan.modules.every(m => m.props.assetIds.every((id, i) => id !== asset.id || entries[m.type].slots[i].width <= 200));
    const nativeCopy=asset.artwork?.version===3;
    const cropLimit = nativeCopy ? .03 : smallCategory ? .35 : .3;
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
    const baked = plan.delivery === 'platform-slots-v1' && !!asset.artwork && !nativeCopy;
    const buffer = baked ? await bakeArtwork(rawBuffer, asset.artwork) : rawBuffer;
    prepared.push({ buffer, ...(baked ? { rawBuffer } : {}), report: { assetId: panel.id, detectedRect: box, boundaryTrim, cropRect: extracted, aspect: asset.aspect, fitMethod: padded ? 'contain-with-background' : 'center-crop', paddingAreaPercent: padded ? +(paddingFraction * 100).toFixed(2) : 0, removedAreaPercent: +((padded ? 1 - clean.width * clean.height / (box.width * box.height) : removed) * 100).toFixed(2), allowedRemovedAreaPercent: cropLimit * 100, framingReviewRequired: padded || removed > .3, upscaled: false, ...(baked ? { copyBaked: true } : {}), ...(nativeCopy?{textRendering:'native-image',copyBaked:false}: {}) } });
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
  if (calibratedSeparatorRange) { report.calibratedSeparatorRange = calibratedSeparatorRange; report.separatorCalibrationSource = 'panel-boundaries'; }
  if (located.framed) report.separatorDetection = 'closed-frames';
  fs.writeFileSync(path.join(folder, `${batchId}-crop-report.json`), JSON.stringify(report, null, 2));
  return report;
}
module.exports = { cropBatch };

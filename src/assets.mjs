/**
 * 素材层：少量调用生成「组合素材画布」→ 按分隔色精确裁切 → 缩放进固定模块槽位。
 *
 * 分工（本方案的核心取舍）：
 * - AI 只决定「哪个格子画什么内容」；
 * - 画布尺寸、面板比例、分隔色、提示词措辞、裁切与缩放全部由程序决定，保证可重复、可解释；
 * - 一次生图承载多个格子，避免按槽位逐张调用（成本与风格一致性都更好）。
 *
 * 机制沿用已验证做法：整张画布用纯品红 #FF00FF 做分隔，裁切时按品红投影切出面板，
 * 再按目标比例做最小中心裁切（不拉伸；放大倍数如实记录）。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { AppError } from './analyze.mjs';

const GUTTER_RATIO = 0.02;
const BORDER_RATIO = 0.022;
const TARGET_PANEL = 512;
const MAX_TOTAL_PIXELS = 4_200_000;
const MIN_TOTAL_PIXELS = 940_000;
const MIN_DIMENSION = 512;
const MAX_ASPECT = 15.5;
const MAX_SHEET_LONG_EDGE = 4096;

const even = n => Math.max(4, Math.round(n / 2) * 2);
const round2 = n => Math.round(n * 100) / 100;

/** 面板列数：尽量让行列接近方形，避免出现超长条画布。 */
function columnsFor(count) {
  if (count <= 1) return 1;
  if (count === 2) return 2;
  if (count === 3) return 3;
  if (count === 4) return 2;
  if (count <= 6) return 3;
  if (count <= 9) return 3;
  return 4;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * 计算素材画布尺寸与每个面板的位置。
 * 所有面板共用同一比例因子，保持各自槽位的真实宽高比不变。
 */
export function layoutSheet(panels) {
  const count = panels.length;
  if (!count) throw new AppError('没有需要生成的图片格子。', { stage: 'assets' });
  const columns = columnsFor(count);
  const rows = chunk(panels, columns);
  const gutter = TARGET_PANEL * GUTTER_RATIO;
  const border = TARGET_PANEL * BORDER_RATIO;

  // 所有面板统一缩放到「长边 = TARGET_PANEL（方形面板则边长为 TARGET_PANEL）」
  const sizes = panels.map(p => {
    const long = Math.max(p.ratio, 1 / p.ratio);
    const longEdge = TARGET_PANEL;
    return p.ratio >= 1
      ? { w: longEdge, h: longEdge / p.ratio }
      : { w: longEdge * p.ratio, h: longEdge };
  });

  const rowHeights = rows.map(row => Math.max(...row.map(p => sizes[panels.indexOf(p)].h)));
  const rowWidths = rows.map(row => row.reduce((sum, p) => sum + sizes[panels.indexOf(p)].w, 0) + gutter * (row.length - 1));
  const rawW = Math.max(...rowWidths) + border * 2;
  const rawH = rowHeights.reduce((a, b) => a + b, 0) + gutter * (rows.length - 1) + border * 2;

  // 归一化到合法尺寸：总像素区间 + 宽高比上限 + 长边上限 + 偶数边长
  let scale = 1;
  const adjust = () => {
    let w = rawW * scale;
    let h = rawH * scale;
    const total = w * h;
    if (total > MAX_TOTAL_PIXELS) scale *= Math.sqrt(MAX_TOTAL_PIXELS / total);
    const aspect = h / w;
    if (aspect > MAX_ASPECT) scale *= aspect / MAX_ASPECT;
    if (1 / aspect > MAX_ASPECT) scale *= 1 / aspect / MAX_ASPECT;
    const long = Math.max(w, h) * 1;
    if (long > MAX_SHEET_LONG_EDGE && MAX_SHEET_LONG_EDGE / long < 1) scale *= MAX_SHEET_LONG_EDGE / long;
    w = rawW * scale;
    h = rawH * scale;
    if (w < MIN_DIMENSION || h < MIN_DIMENSION) scale *= Math.max(MIN_DIMENSION / w, MIN_DIMENSION / h);
    return { w: even(rawW * scale), h: even(rawH * scale) };
  };
  let dims = adjust();
  if (dims.w * dims.h < MIN_TOTAL_PIXELS) {
    const grow = Math.min(2.2, Math.sqrt(MIN_TOTAL_PIXELS / (dims.w * dims.h)));
    scale *= grow;
    dims = adjust();
  }

  const sheetW = dims.w;
  const sheetH = dims.h;
  const k = sheetW / rawW;
  const g = gutter * k;
  const b = border * k;

  const boxes = [];
  let y = b;
  for (const [r, row] of rows.entries()) {
    const rowWidth = rowWidths[r] * k;
    let x = (sheetW - rowWidth) / 2;
    for (const panel of row) {
      const size = sizes[panels.indexOf(panel)];
      const w = size.w * k;
      const h = size.h * k;
      boxes.push({
        id: panel.id,
        left: Math.round(x),
        top: Math.round(y + (rowHeights[r] * k - h) / 2),
        width: Math.max(8, Math.round(w)),
        height: Math.max(8, Math.round(h)),
      });
      x += w + g;
    }
    y += rowHeights[r] * k + g;
  }

  const laidOut = panels.map(p => {
    const box = boxes.find(b2 => b2.id === p.id);
    return {
      ...p,
      columns,
      panelRect: box,
      percent: {
        x: round2(box.left / sheetW * 100), y: round2(box.top / sheetH * 100),
        w: round2(box.width / sheetW * 100), h: round2(box.height / sheetH * 100),
      },
    };
  });

  return {
    width: sheetW,
    height: sheetH,
    columns,
    rowCount: rows.length,
    totalPixels: sheetW * sheetH,
    aspect: round2(sheetH / sheetW),
    panels: laidOut,
    rows: chunk(laidOut, columns),
  };
}

/** 由计划的格子声明生成面板定义：比例取槽位真实比例，不由 AI 决定。 */
export function panelsFromSheet(sheet, slotsById) {
  const panels = [];
  for (const slot of sheet.slots || []) {
    const assignment = slotsById.get(slot.slotId);
    if (!assignment) continue;
    panels.push({
      id: slot.slotId,
      slotId: slot.slotId,
      ratio: assignment.slotRatio,
      role: assignment.role,
      source: slot.source || assignment.source,
      subject: slot.subject || assignment.subject,
      slotWidth: assignment.slotWidth,
      slotHeight: assignment.slotHeight,
    });
  }
  return panels;
}

const ratioText = r => {
  const known = [[1, 1, '1:1'], [4, 3, '4:3'], [3, 4, '3:4'], [3, 1, '3:1'], [1, 2, '1:2'], [2, 1, '2:1'], [16, 9, '16:9'], [9, 16, '9:16']];
  for (const [a, b, text] of known) if (Math.abs(r - a / b) / (a / b) < 0.06) return text;
  return r >= 1 ? `${round2(r)}:1` : `1:${round2(1 / r)}`;
};

/** 拼装生图提示词：结构、分隔色、坐标、禁止项全部由程序写死。 */
export function buildSheetPrompt({ sheet, layout, design, shop }) {
  const lines = [];
  lines.push('Use case: product-mockup.');
  lines.push(`Create ONE raster photographic asset sheet containing EXACTLY ${layout.panels.length} separate complete e-commerce photographs, arranged in ${layout.rowCount} row(s) of up to ${layout.columns} panel(s), with straight rectangular edges.`);
  lines.push(`Canvas must be landscape/portrait exactly ${layout.width} x ${layout.height} pixels (aspect ratio ${layout.aspect}:1).`);
  lines.push('This is a sheet of source photographs, not a website, not a shop screenshot and not a UI design.');
  lines.push('');
  lines.push('Panel content, left to right then top to bottom:');

  for (const [r, row] of layout.rows.entries()) {
    lines.push(`ROW ${r + 1} — ${row.length} panel(s):`);
    for (const panel of row) {
      const kind = panel.source === 'generated-nav-icon'
        ? 'a simple flat category icon on a clean solid background (icon subject only, no text)'
        : panel.source === 'generated-scene'
          ? 'a wide atmospheric scene photograph usable as a shop banner'
          : 'a product-focused photograph';
      lines.push(`  - ${panel.id}: ${kind} — ${panel.subject || '与店铺品类一致的商品'} (slot aspect ${ratioText(panel.ratio)}, panel ${panel.panelRect.width}x${panel.panelRect.height}px)`);
    }
  }

  lines.push('');
  lines.push('Composition map (percent of the full sheet, top-left origin):');
  for (const panel of layout.panels) {
    lines.push(`  ${panel.id}: x=${panel.percent.x}% y=${panel.percent.y}% w=${panel.percent.w}% h=${panel.percent.h}%`);
  }
  lines.push('');
  lines.push('Hard requirements:');
  lines.push('1. ALL outer margins and ALL gutters between panels must be perfectly flat solid bright MAGENTA #FF00FF with sharp straight boundaries. Magenta is ONLY an outside separator for automatic cropping. It must never appear inside a photograph, be reflected in a product, or be cast as light.');
  lines.push('2. No object, shadow or decoration may cross a panel boundary or enter a gutter. Every panel is filled by its own photograph with its own opaque background.');
  lines.push('3. ABSOLUTELY NO text anywhere: no letters, numbers, prices, titles, labels, watermarks, logos, badges, panel numbers, UI elements or decorative borders.');
  lines.push('4. Do not draw a shop interface, navigation bar, buttons, product cards or price tags. Photographs only.');
  lines.push('5. Keep each subject complete inside its own panel with at least 6% safe space from that panel edges.');
  lines.push('6. Do not add extra panels, merge panels, or overlap photographs. Render exactly the panels listed.');
  lines.push('7. Realistic, soft and even commercial product lighting; consistent light direction and surface across all panels of this sheet.');
  const constraints = (design?.imagePlan?.constraints || []).filter(Boolean);
  if (constraints.length) lines.push(`8. Additional art direction for this shop: ${constraints.join('；')}`);
  const styleBits = [];
  if (design?.styleKeywords?.length) styleBits.push(`风格关键词 ${design.styleKeywords.join('、')}`);
  if (shop?.designReading?.tone) styleBits.push(`店铺调性 ${shop.designReading.tone}`);
  if (shop?.category) styleBits.push(`主营品类 ${shop.category}`);
  if (design?.palette) styleBits.push(`主色参考 背景 ${design.palette.background} / 点缀 ${design.palette.accent}`);
  if (styleBits.length) lines.push(`9. ${styleBits.join('；')}。商品自身的真实颜色不得被配色改写。`);
  return lines.join('\n');
}

/** 调用生图模型生成一张素材画布。 */
export async function generateSheet(env, prompt, sheetPath, layout, log = () => {}) {
  if (!env.imageEndpoint || !env.apiKey || !env.imageModel) {
    throw new AppError('生图服务配置不完整。', { stage: 'generate' });
  }
  const size = `${layout.width}x${layout.height}`;
  log(`请求生图 ${size}`);
  let response;
  try {
    response = await fetch(env.imageEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.apiKey}` },
      body: JSON.stringify({ model: env.imageModel, prompt, size, response_format: 'b64_json', watermark: false, stream: false }),
      signal: AbortSignal.timeout(300_000),
    });
  } catch (error) {
    throw new AppError('生图请求连接失败或超时。', { stage: 'generate', hint: error.message });
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new AppError(`生图返回 HTTP ${response.status}，本次没有生成任何素材。`, { stage: 'generate', hint: detail.slice(0, 300) });
  }
  const payload = await response.json();
  const item = payload?.data?.[0];
  let bytes;
  if (item?.b64_json) bytes = Buffer.from(item.b64_json, 'base64');
  else if (item?.url) {
    const url = new URL(item.url);
    if (url.protocol !== 'https:') throw new AppError('生图返回的下载地址不是安全地址，已拒绝。', { stage: 'generate' });
    const download = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!download.ok) throw new AppError('生图结果下载失败。', { stage: 'generate' });
    bytes = Buffer.from(await download.arrayBuffer());
  } else throw new AppError('生图服务没有返回图片数据。', { stage: 'generate' });

  await mkdir(path.dirname(sheetPath), { recursive: true });
  await writeFile(sheetPath, bytes);
  const meta = await sharp(bytes).metadata();
  log(`素材画布已生成 ${meta.width}×${meta.height}（请求 ${size}）`);
  return { bytes, width: meta.width, height: meta.height, requestedSize: size, aspectMatchesRequest: Math.abs((meta.height / meta.width) - (layout.height / layout.width)) < 0.02 };
}

/** 品红分隔像素判定。 */
function isSeparator(data, W, channels, x, y) {
  const p = (y * W + x) * channels;
  const r = data[p];
  const g = data[p + 1];
  const b = data[p + 2];
  return r > 170 && b > 170 && g < 140 && r - g > 70 && b - g > 70;
}

function runs(values, minLength) {
  const out = [];
  let start = null;
  for (let i = 0; i <= values.length; i += 1) {
    if (i < values.length && values[i]) {
      if (start === null) start = i;
    } else if (start !== null) {
      if (i - start >= minLength) out.push([start, i]);
      start = null;
    }
  }
  return out;
}

/**
 * 按品红投影检测实际面板框。
 * 模型画出的画布尺寸可能与请求不同，因此这里只依赖「行数/每行格子数」与分隔色，不依赖坐标预测。
 */
export function detectPanels(data, W, H, channels, rowsSpec) {
  const rowFlags = Array.from({ length: H }, (_, y) => {
    let content = 0;
    for (let x = 0; x < W; x += 1) if (!isSeparator(data, W, channels, x, y)) content += 1;
    return content / W > 0.1;
  });
  const rows = runs(rowFlags, 20);
  if (rows.length !== rowsSpec.length) {
    throw new AppError(`素材画布的行数与计划不符：检测到 ${rows.length} 行，计划 ${rowsSpec.length} 行。可能模型没有画出分隔色，本次不采用。`, { stage: 'crop' });
  }
  const boxes = [];
  for (const [r, [y0, y1]] of rows.entries()) {
    const colFlags = Array.from({ length: W }, (_, x) => {
      let content = 0;
      for (let y = y0; y < y1; y += 1) if (!isSeparator(data, W, channels, x, y)) content += 1;
      return content / (y1 - y0) > 0.9;
    });
    const cols = runs(colFlags, 20);
    if (cols.length !== rowsSpec[r].length) {
      throw new AppError(`素材画布第 ${r + 1} 行的格子数与计划不符：检测到 ${cols.length} 个，计划 ${rowsSpec[r].length} 个。本次不采用。`, { stage: 'crop' });
    }
    for (const [x0, x1] of cols) {
      boxes.push({ left: x0 + 1, top: y0 + 1, width: Math.max(8, x1 - x0 - 2), height: Math.max(8, y1 - y0 - 2) });
    }
  }
  return boxes;
}

/** 裁切画布并填入槽位；返回值如实记录裁切质量。 */
export async function cropSheetIntoSlots(sourcePath, layout, outDir, log = () => {}) {
  await mkdir(outDir, { recursive: true });
  const { data, info } = await sharp(sourcePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels } = info;
  const boxes = detectPanels(data, W, H, channels, layout.rows);
  if (boxes.length !== layout.panels.length) throw new AppError('检测到的面板数量与计划不一致。', { stage: 'crop' });

  const assets = [];
  for (const [i, panel] of layout.panels.entries()) {
    const box = boxes[i];
    const target = panel.ratio;
    const boxRatio = box.width / box.height;
    let cropRect;
    if (Math.abs(boxRatio - target) / target <= 0.02) {
      cropRect = { ...box };
    } else if (boxRatio > target) {
      const width = Math.round(box.height * target);
      cropRect = { left: box.left + Math.round((box.width - width) / 2), top: box.top, width, height: box.height };
    } else {
      const height = Math.round(box.width / target);
      cropRect = { left: box.left, top: box.top + Math.round((box.height - height) / 2), width: box.width, height };
    }
    const removedArea = 1 - (cropRect.width * cropRect.height) / (box.width * box.height);
    if (removedArea > 0.25) {
      throw new AppError(`面板 ${panel.id} 的实际比例与槽位差太多，裁切会丢掉 ${(removedArea * 100).toFixed(0)}% 画面；不采用这种裁切。`, { stage: 'crop' });
    }

    let separatorPixels = 0;
    for (let y = cropRect.top; y < cropRect.top + cropRect.height; y += 1) {
      for (let x = cropRect.left; x < cropRect.left + cropRect.width; x += 1) {
        if (isSeparator(data, W, channels, x, y)) separatorPixels += 1;
      }
    }

    const outWidth = Math.max(64, Math.round(panel.slotWidth * 2));
    const outHeight = Math.max(64, Math.round(panel.slotHeight * 2));
    const scale = Math.min(outWidth / cropRect.width, outHeight / cropRect.height);
    const fileName = `${panel.slotId.replace(/[^\w.-]/g, '_')}.png`;
    await sharp(sourcePath)
      .extract({ left: cropRect.left, top: cropRect.top, width: cropRect.width, height: cropRect.height })
      .resize(outWidth, outHeight, { fit: 'cover', position: 'centre' })
      .png({ compressionLevel: 6 })
      .toFile(path.join(outDir, fileName));

    assets.push({
      slotId: panel.slotId,
      file: fileName,
      role: panel.role,
      source: panel.source,
      subject: panel.subject,
      detectedPanel: box,
      finalRect: cropRect,
      nativePixels: [cropRect.width, cropRect.height],
      deliveredPixels: [outWidth, outHeight],
      slotPixels: [round2(panel.slotWidth), round2(panel.slotHeight)],
      removedAreaPercent: round2(removedArea * 100),
      separatorPixels,
      upscaled: scale > 1.02,
      upscaleFactor: round2(scale),
    });
  }
  log(`已裁切 ${assets.length} 张素材`);
  return assets;
}

/**
 * 从商家截图裁切真实商品照片（不生成，避免画错商品）。
 * 优先使用识别阶段给出的商品框；没有框时退回截图上部的可辨认区域，并如实标注。
 */
export async function cropFromScreenshot(screenshotBytes, assignments, outDir, log = () => {}, productBoxes = []) {
  await mkdir(outDir, { recursive: true });
  const meta = await sharp(screenshotBytes).metadata();
  const boxes = (productBoxes || []).filter(Boolean);
  const assets = [];
  for (const [index, assignment] of assignments.entries()) {
    const outWidth = Math.max(64, Math.round(assignment.slotWidth * 2));
    const outHeight = Math.max(64, Math.round(assignment.slotHeight * 2));
    const fileName = `${assignment.slotId.replace(/[^\w.-]/g, '_')}.png`;
    const box = boxes.length ? boxes[index % boxes.length] : null;

    let pipeline;
    if (box) {
      const left = Math.min(meta.width - 2, Math.max(0, Math.round(box.x * meta.width)));
      const top = Math.min(meta.height - 2, Math.max(0, Math.round(box.y * meta.height)));
      const width = Math.max(8, Math.min(meta.width - left, Math.round(box.w * meta.width)));
      const height = Math.max(8, Math.min(meta.height - top, Math.round(box.h * meta.height)));
      pipeline = sharp(screenshotBytes).extract({ left, top, width, height });
    } else {
      // 没有定位信息时，取截图中商品通常出现的中上部区域，避免只取到顶部横幅
      const height = Math.round(meta.height * 0.5);
      pipeline = sharp(screenshotBytes).extract({ left: 0, top: Math.round(meta.height * 0.15), width: meta.width, height });
    }

    await pipeline.resize(outWidth, outHeight, { fit: 'cover', position: 'centre' })
      .png({ compressionLevel: 6 })
      .toFile(path.join(outDir, fileName));

    assets.push({
      slotId: assignment.slotId,
      file: fileName,
      role: assignment.role,
      source: 'product-photo',
      subject: assignment.subject,
      croppedFromBox: box || null,
      nativePixels: [meta.width, meta.height],
      deliveredPixels: [outWidth, outHeight],
      slotPixels: [round2(assignment.slotWidth), round2(assignment.slotHeight)],
      upscaled: outWidth > meta.width * (box ? box.w : 1),
      note: box
        ? '来自商家上传的截图，按识别到的商品位置裁切。'
        : '来自商家上传的截图中部区域，未取得精确商品位置，仅作装修示意。',
      accurate: Boolean(box),
    });
    log(`已从截图裁切 ${assignment.slotId}${box ? '（按识别位置）' : '（未定位，取中上部）'}`);
  }
  return assets;
}

export async function readImageAsDataUrl(file) {
  const bytes = await readFile(file);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

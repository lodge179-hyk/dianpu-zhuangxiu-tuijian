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
/** 同一行里最矮的格子相对最高的格子允许被压掉的比例（超出则拆行）。 */
const MAX_ROW_HEIGHT_SPREAD = 1.45;
/** 允许的最大裁切损失：超过这个比例就宁可不用这张图，并说明原因。 */
const MAX_CROP_LOSS = 0.25;

const even = n => Math.max(4, Math.round(n / 2) * 2);
const round2 = n => Math.round(n * 100) / 100;

/** 面板列数：尽量让行列接近方形，避免出现超长条画布。 */
function columnsFor(count) {
  if (count <= 1) return 1;
  if (count === 2) return 2;
  if (count === 3) return 3;
  if (count === 4) return 4;
  if (count === 5) return 3;
  if (count <= 6) return 3;
  if (count <= 8) return 4;
  return 3;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** 一个比例能否并入已有组：与组内所有比例都足够接近。 */
const within = (ratios, ratio, tolerance) => ratios.every(r => Math.abs(r - ratio) / r <= tolerance);
/** 组内比例跨度（最大相对差）。 */
const spread = ratios => {
  if (ratios.length < 2) return 0;
  const min = Math.min(...ratios);
  const max = Math.max(...ratios);
  return (max - min) / min;
};

/**
 * 把 AI 安排的一张画布拆成「可以真正生成」的若干张。
 *
 * 实测结论：模型会把同一张画布上的格子画成统一网格。宽幅（例如招牌 483×258 ≈ 1.87:1）
 * 或竖长格子混在方格网格里时，画出来的比例会差到四成以上，只能作废。
 * 因此这里按形状把格子分开：极端比例的格子各自独立成一张，其余方格合并成一张。
 * 拆分是程序决定，并且会在界面上如实说明实际生图次数。
 */
export function splitIntoSpanningSheets(sheet, slotsById, limits = { extremeHigh: 1.55, extremeLow: 0.72 }) {
  const panels = panelsFromSheet(sheet, slotsById);
  const extreme = panels.filter(p => p.ratio >= limits.extremeHigh || p.ratio <= limits.extremeLow);
  const normal = panels.filter(p => !(p.ratio >= limits.extremeHigh || p.ratio <= limits.extremeLow));
  const sheets = [];
  for (const [index, panel] of extreme.entries()) {
    sheets.push({
      id: panels.length === 1 ? sheet.id : `${sheet.id}-shape${index + 1}`,
      purpose: `${panel.subject || panel.slotId}（宽高比与方格差异大，单独生成）`,
      panels: [panel],
      split: true,
    });
  }
  if (normal.length) {
    sheets.push({
      id: extreme.length ? `${sheet.id}-grid` : sheet.id,
      purpose: sheet.purpose,
      panels: normal,
      split: false,
    });
  }
  return sheets;
}

/**
 * 计算素材画布尺寸与每个面板的位置。
 * 组内等高、不同形状分行，避免模型把宽幅格子画成方格。
 */
export function layoutSheet(panels) {
  const count = panels.length;
  if (!count) throw new AppError('没有需要生成的图片格子。', { stage: 'assets' });

  // 1. 按「格子高度跨度」聚类：同一行的格子高度必须一致（模型会照最高那个画），
  //    因此判断标准不是比例接近，而是最矮的格子相对最高的格子不能被压掉太多。
  const groups = [];
  for (const panel of panels) {
    const ratio = panel.ratio >= 1 ? panel.ratio : 1 / panel.ratio;
    const height = 1 / ratio; // 以统一宽度为基准的相对高度
    const group = groups.find(g => {
      const heights = [...g.heights, height];
      return Math.max(...heights) / Math.min(...heights) <= MAX_ROW_HEIGHT_SPREAD;
    });
    if (group) { group.panels.push(panel); group.heights.push(height); } else groups.push({ heights: [height], panels: [panel] });
  }
  groups.sort((a, b) => Math.max(...b.heights) - Math.max(...a.heights));

  // 2. 每组内部分行，每行格子数尽量接近方形排布
  const planned = [];
  for (const group of groups) {
    const columns = columnsFor(group.panels.length);
    for (const row of chunk(group.panels, columns)) planned.push({ panels: row });
  }

  // 以「长边 = TARGET_PANEL」给每个格子定尺寸；同一行的格子高度统一取该行最高者，
  // 这样模型看到的就是「一行等高、宽度不同」的规整网格。
  const sized = planned.map(row => {
    const raw = row.panels.map(p => (p.ratio >= 1
      ? { w: TARGET_PANEL, h: TARGET_PANEL / p.ratio }
      : { w: TARGET_PANEL * p.ratio, h: TARGET_PANEL }));
    const rowHeight = Math.max(...raw.map(c => c.h));
    return {
      ...row,
      cells: raw.map(c => ({ w: c.w * (rowHeight / c.h), h: rowHeight })),
    };
  });

  const gutter = TARGET_PANEL * GUTTER_RATIO;
  const border = TARGET_PANEL * BORDER_RATIO;
  const rowWidths = sized.map(row => row.cells.reduce((sum, c) => sum + c.w, 0) + gutter * (row.cells.length - 1));
  const rowHeights = sized.map(row => Math.max(...row.cells.map(c => c.h)));
  const rawW = Math.max(...rowWidths) + border * 2;
  const rawH = rowHeights.reduce((a, b) => a + b, 0) + gutter * (sized.length - 1) + border * 2;

  // 4. 归一化到合法尺寸：总像素区间 + 宽高比上限 + 长边上限 + 偶数边长
  const adjust = () => {
    let w = rawW * scale;
    let h = rawH * scale;
    const total = w * h;
    if (total > MAX_TOTAL_PIXELS) scale *= Math.sqrt(MAX_TOTAL_PIXELS / total);
    const aspect = h / w;
    if (aspect > MAX_ASPECT) scale *= aspect / MAX_ASPECT;
    if (1 / aspect > MAX_ASPECT) scale *= (1 / aspect) / MAX_ASPECT;
    const long = Math.max(w, h);
    if (long > MAX_SHEET_LONG_EDGE) scale *= MAX_SHEET_LONG_EDGE / long;
    w = rawW * scale;
    h = rawH * scale;
    if (w < MIN_DIMENSION || h < MIN_DIMENSION) scale *= Math.max(MIN_DIMENSION / w, MIN_DIMENSION / h);
    return { w: even(rawW * scale), h: even(rawH * scale) };
  };
  let scale = 1;
  let dims = adjust();
  if (dims.w * dims.h < MIN_TOTAL_PIXELS) {
    scale *= Math.min(2.2, Math.sqrt(MIN_TOTAL_PIXELS / (dims.w * dims.h)));
    dims = adjust();
  }

  const sheetW = dims.w;
  const sheetH = dims.h;
  const k = sheetW / rawW;
  const g = gutter * k;
  const b = border * k;

  const boxes = new Map();
  let y = b;
  for (const [r, row] of sized.entries()) {
    const rowWidth = rowWidths[r] * k;
    const rowHeight = rowHeights[r] * k;
    let x = (sheetW - rowWidth) / 2;
    for (const cell of row.cells) {
      const w = cell.w * k;
      const h = cell.h * k;
      boxes.set(row.panels[row.cells.indexOf(cell)].id, {
        left: Math.round(x), top: Math.round(y + (rowHeight - h) / 2),
        width: Math.max(8, Math.round(w)), height: Math.max(8, Math.round(h)),
      });
      x += w + g;
    }
    y += rowHeight + g;
  }

  const laidOut = panels.map(p => {
    const box = boxes.get(p.id);
    return {
      ...p,
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
    rowCount: sized.length,
    totalPixels: sheetW * sheetH,
    aspect: round2(sheetH / sheetW),
    panels: laidOut,
    rows: sized.map((row, r) => row.panels.map(p => laidOut.find(l => l.id === p.id))),
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

/**
 * 每个格子的创意处理：由它的角色决定，不由模型自由发挥。
 *
 * 之前所有格子共用一套笼统描述（"product-focused photograph"），加上要求"统一光线与表面"，
 * 结果 8 个格子画出来几乎是同一张影棚白底图——这是提示词层面的同质化。
 * 现在按角色分配各不相同的镜头、背景、场景规模与构图，风格则通过共享的"艺术方向"锁住。
 */
const PANEL_TREATMENT = {
  banner: {
    kind: 'a wide atmospheric lifestyle photograph used as the shop banner',
    camera: 'wide establishing shot, camera at a slight angle, generous negative space on one side',
    scene: 'a styled set with depth — a surface in the foreground, mid-ground props, and a soft blurred background',
    background: 'a styled environment with real depth, not a plain white seamless',
    composition: 'hero composition: one clear focal product, a supporting group, and visible scene depth',
  },
  poster: {
    kind: 'an editorial lifestyle photograph for a category poster',
    camera: 'closer three-quarter or eye-level view with a deliberate crop',
    scene: 'a styled scene with one dominant prop and a hint of the surrounding environment',
    background: 'a tinted or textured backdrop that matches the shop palette but is NOT plain white',
    composition: 'magazine-style layout with clear foreground and background separation',
  },
  'nav-icon': {
    kind: 'a simple flat vector-style category icon on a flat solid background',
    camera: 'flat 2D graphic, perfectly front-facing, centered, no perspective',
    scene: 'a single clean silhouette with slightly rounded corners and generous padding',
    background: 'one flat solid light background colour; no gradients, no shadows, no props, no scene',
    composition: 'icon only — it must NOT look like a photograph, a 3D render, or a product shot',
  },
  avatar: {
    kind: 'a simple square brand image used as the shop avatar',
    camera: 'centered, minimal, readable when scaled down to 48 px',
    scene: 'one or two objects only, nothing busy',
    background: 'a clean flat background in the shop palette',
    composition: 'a simple mark-like composition that still reads at very small size',
  },
  product: {
    kind: 'a clean product photograph',
    camera: 'straight-on or slight three-quarter view',
    scene: 'the product alone with minimal props',
    background: 'a soft neutral background',
    composition: 'centered product with even margins',
  },
};

const PANEL_VARIETY = [
  'Every panel must be visually DIFFERENT from the others in camera angle, background treatment and composition.',
  'Never repeat the same photograph with a different crop. Each panel is its own shot.',
  'Do NOT use the same background colour for every panel. Rotate the backdrop between panels — for example one cream, one pale stone grey, one soft blush, one light warm wood — while staying inside the same palette family.',
  'Vary the scene across panels: some closer, some wider; some with props, some minimal; some stylised, some plain.',
  'Vary the lighting set-up as well: some panels with soft directional side light, others flat and diffused, others with a stronger specular highlight.',
  'Keep one shared art direction across the sheet — the same broad palette, materials and light quality — so the panels still belong to one shop.',
];

const looksLikePhoto = source => source === 'generated-scene' || source === 'generated-poster';
const lookOf = subject => {
  const text = String(subject || '');
  const cues = [];
  if (/人物|模特|上身|手持|试穿|使用|涂抹/.test(text)) cues.push('include a person (hands or a model) only if the subject says so');
  if (/水|湿|滴|清透|透明|气泡/.test(text)) cues.push('use water, droplets or glass reflections as a material cue');
  if (/丝绒|哑光|粉质|眼影|散粉/.test(text)) cues.push('use powder or velvet textures as a material cue');
  if (/自然|植物|叶|木|石/.test(text)) cues.push('use natural materials such as leaves, wood or stone as props');
  if (/金属|金|银|轻奢|高端|大牌/.test(text)) cues.push('use metallic or marble accents for a premium feel');
  if (/礼品|礼盒|套装|节日|限定/.test(text)) cues.push('hint at gifting with ribbon or packaging');
  return cues;
};

/**
 * 拼装生图提示词。
 * 结构、分隔色、坐标、每格创意处理全部由程序写死；AI 只提供每格画什么内容与整体约束。
 */
export function buildSheetPrompt({ sheet, layout, design, shop }) {
  const palette = design?.palette || {};
  const constraints = (design?.imagePlan?.constraints || []).filter(Boolean);

  const lines = [];
  lines.push('Use case: product-mockup.');
  lines.push(`Create ONE raster photographic asset sheet containing EXACTLY ${layout.panels.length} separate e-commerce images, arranged in ${layout.rowCount} row(s) of up to ${Math.max(...layout.rows.map(r => r.length))} panel(s), with straight rectangular edges.`);
  lines.push(`Canvas must be exactly ${layout.width} x ${layout.height} pixels.`);
  lines.push('This is a sheet of separate source images for one shop, not a website, not a shop screenshot and not a UI design.');

  // 共享的艺术方向：锁住风格，但不要求每格长得一样
  lines.push('');
  lines.push('SHARED ART DIRECTION for the whole sheet (this is what makes the sheet look like ONE shop):');
  lines.push(`- Overall character: ${design?.title || 'clean commercial styling'}${design?.styleKeywords?.length ? `; keywords ${design.styleKeywords.join(', ')}` : ''}${shop?.designReading?.tone ? `; shop tone ${shop.designReading.tone}` : ''}.`);
  if (palette.background || palette.accent) {
    lines.push(`- Colour: keep the palette family consistent — background tones near ${palette.background || 'light neutral'} and accents near ${palette.accent || 'a warm highlight'}. Product colours must stay true and never be tinted by this palette.`);
  }
  if (constraints.length) {
    lines.push(`- Shop art direction (colour, material and mood only — these are NOT instructions to repeat one background or one lighting setup): ${constraints.join('；')}`);
  }
  lines.push('- Same light QUALITY and same material world throughout. That is the ONLY thing that repeats; the actual background colour, surface and camera setup must differ from panel to panel.');

  lines.push('');
  lines.push('DIFFERENTIATION — read this as a hard requirement:');
  for (const rule of PANEL_VARIETY) lines.push(`- ${rule}`);

  lines.push('');
  lines.push(`PANELS — ${layout.rowCount} row(s), left to right then top to bottom. Panels in the same row share the same pixel height; follow the given panel sizes and do NOT force every panel to be square:`);
  for (const [r, row] of layout.rows.entries()) {
    lines.push(`ROW ${r + 1} — ${row.length} panel(s):`);
    for (const panel of row) {
      const treatment = PANEL_TREATMENT[panel.role] || PANEL_TREATMENT.product;
      const subject = panel.subject || (shop?.category ? `${shop.category} 相关商品` : 'a product matching this shop');
      lines.push(`  ${panel.id} — ${subject}`);
      lines.push(`      type: ${treatment.kind}`);
      lines.push(`      camera: ${treatment.camera}`);
      lines.push(`      scene: ${treatment.scene}`);
      lines.push(`      background: ${treatment.background}`);
      lines.push(`      composition: ${treatment.composition}`);
      if (treatment !== PANEL_TREATMENT['nav-icon']) {
        const cues = [...lookOf(subject), ...(shop?.visibleProducts || []).slice(0, 3).map(p => p.name).filter(n => subject.includes(n))].slice(0, 2);
        if (cues.length) lines.push(`      content cues: ${cues.join('; ')}`);
      }
      lines.push(`      size: ${panel.panelRect.width}x${panel.panelRect.height} px (slot aspect ${ratioText(panel.ratio)})`);
      if (treatment === PANEL_TREATMENT['nav-icon']) lines.push('      NOTE: this panel is a graphic icon, NOT a photograph — it must not look like a product shot.');
    }
  }

  lines.push('');
  lines.push('Composition map (percent of the full sheet, top-left origin):');
  for (const panel of layout.panels) {
    lines.push(`  ${panel.id}: x=${panel.percent.x}% y=${panel.percent.y}% w=${panel.percent.w}% h=${panel.percent.h}%`);
  }

  lines.push('');
  lines.push('Hard requirements:');
  lines.push('1. ALL outer margins and ALL gutters between panels must be perfectly flat solid bright MAGENTA #FF00FF with sharp straight boundaries. Magenta is ONLY an outside separator for automatic cropping. It must never appear inside an image, be reflected in a product, or be cast as light.');
  lines.push('2. No object, shadow or decoration may cross a panel boundary or enter a gutter. Every panel is filled by its own image with its own opaque background.');
  lines.push('3. ABSOLUTELY NO text anywhere: no letters, numbers, prices, titles, labels, watermarks, logos, badges, panel numbers, UI elements or decorative borders.');
  lines.push('4. Do not draw a shop interface, navigation bar, buttons, product cards or price tags.');
  lines.push('5. Keep each subject complete inside its own panel with at least 6% safe space from that panel edges.');
  lines.push('6. Do not add extra panels, merge panels, or overlap images. Render exactly the panels listed.');
  lines.push('7. Photographic panels must look like real commercial photography, not 3D renders or AI illustrations; icon panels must be flat graphics.');
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

  // 统一转成真正的 PNG 再落盘：模型可能返回 JPEG，后缀写着 .png 会让人误判格式。
  await mkdir(path.dirname(sheetPath), { recursive: true });
  const incoming = await sharp(bytes).metadata();
  await sharp(bytes).png({ compressionLevel: 6 }).toFile(sheetPath);
  const meta = await sharp(sheetPath).metadata();
  log(`素材画布已生成 ${meta.width}×${meta.height}（请求 ${size}，返回格式 ${incoming.format}）`);
  return {
    bytes, width: meta.width, height: meta.height, requestedSize: size,
    sourceFormat: incoming.format,
    aspectMatchesRequest: Math.abs((meta.height / meta.width) - (layout.height / layout.width)) < 0.02,
  };
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
 * 按品红投影检测实际面板框，并按阅读顺序返回。
 *
 * 宽容之处：模型不一定会严格照计划的行数画（它更倾向于画成统一网格），
 * 因此这里只依赖「分隔色是否画出来」和「格子总数够不够」，不强制行数一致。
 * 比例是否可用由裁切环节按容差判断——比例差太多时仍然拒绝，不会硬裁。
 */
export function detectPanels(data, W, H, channels, expectedRows) {
  const expectedCount = expectedRows.reduce((n, row) => n + row.length, 0);
  const rowFlags = Array.from({ length: H }, (_, y) => {
    let content = 0;
    for (let x = 0; x < W; x += 1) if (!isSeparator(data, W, channels, x, y)) content += 1;
    return content / W > 0.1;
  });
  const rows = runs(rowFlags, 20);
  if (!rows.length) {
    throw new AppError('素材画布上没有检测到画面区域，可能模型没有按分隔色绘制。本次不采用。', { stage: 'crop' });
  }
  const boxes = [];
  const rowCounts = [];
  for (const [y0, y1] of rows) {
    const colFlags = Array.from({ length: W }, (_, x) => {
      let content = 0;
      for (let y = y0; y < y1; y += 1) if (!isSeparator(data, W, channels, x, y)) content += 1;
      return content / (y1 - y0) > 0.9;
    });
    const cols = runs(colFlags, 20);
    rowCounts.push(cols.length);
    for (const [x0, x1] of cols) {
      boxes.push({ left: x0 + 1, top: y0 + 1, width: Math.max(8, x1 - x0 - 2), height: Math.max(8, y1 - y0 - 2) });
    }
  }
  return { boxes, rowCounts, rowCount: rows.length, expectedCount };
}

/** 裁切画布并填入槽位；返回值如实记录裁切质量。 */
export async function cropSheetIntoSlots(sourcePath, layout, outDir, log = () => {}) {
  await mkdir(outDir, { recursive: true });
  const { data, info } = await sharp(sourcePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels } = info;
  const detected = detectPanels(data, W, H, channels, layout.rows);
  const { boxes, rowCounts, rowCount } = detected;
  log(`检测到 ${rowCount} 行（每行格子数 ${rowCounts.join('/')}），共 ${boxes.length} 个格子；计划 ${layout.panels.length} 格 / ${layout.rows.length} 行`);
  if (boxes.length < layout.panels.length) {
    throw new AppError(`素材画布上只检测到 ${boxes.length} 个格子，少于计划的 ${layout.panels.length} 个。本次不采用。`, { stage: 'crop' });
  }

  const assets = [];
  const skipped = [];
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

    // 比例差太多就不裁：宁可用占位图并说明，也不把裁掉四成画面的图当成成品。
    if (removedArea > MAX_CROP_LOSS) {
      skipped.push({
        slotId: panel.slotId,
        subject: panel.subject,
        slotRatio: round2(target),
        detectedRatio: round2(boxRatio),
        detectedPanel: box,
        wouldRemovePercent: round2(removedArea * 100),
        reason: `模型把这一格画成了 ${round2(boxRatio)}:1，而槽位要 ${round2(target)}:1，按比例裁切会丢掉 ${round2(removedArea * 100)}% 画面，因此没有采用。`,
      });
      continue;
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
      accurate: true,
    });
  }
  log(`已裁切 ${assets.length} 张素材${skipped.length ? `，${skipped.length} 格因比例不符未采用` : ''}`);
  return { assets, skipped, detection: { rowCount, rowCounts, boxes: boxes.length } };
}

/**
 * 从商家截图裁切真实商品照片（不生成，避免画错商品）。
 *
 * 坐标可信度：视觉模型给长截图的坐标并不总是可靠（实测出现过把"占宽度比例"当成
 * "占高度比例"，裁出来只有瓶底和文字）。因此每张裁切都按框的形状给一个可信度：
 * - 比例接近方形且尺寸合理 → 视为已定位；
 * - 比例明显狭长或面积过小/过大 → 仍裁切（保持布局），但标为"位置待确认"并如实告知，
 *   不会把它当成"精准还原了你的商品"。
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
    let reliability = 'fallback';
    if (box) {
      const left = Math.min(meta.width - 2, Math.max(0, Math.round(box.x * meta.width)));
      const top = Math.min(meta.height - 2, Math.max(0, Math.round(box.y * meta.height)));
      const width = Math.max(8, Math.min(meta.width - left, Math.round(box.w * meta.width)));
      const height = Math.max(8, Math.min(meta.height - top, Math.round(box.h * meta.height)));
      pipeline = sharp(screenshotBytes).extract({ left, top, width, height });
      const ratio = width / height;
      const area = (width * height) / (meta.width * meta.height);
      reliability = (ratio > 0.5 && ratio < 2 && area > 0.01 && area < 0.3) ? 'located' : 'uncertain';
    } else {
      // 没有任何定位信息：取截图中部区域，避免只取到顶栏
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
      upscaled: outWidth > (box ? box.w * meta.width : meta.width),
      reliability,
      accurate: reliability === 'located',
      note: reliability === 'located'
        ? '来自商家上传的截图，已按识别到的商品位置裁切。'
        : reliability === 'uncertain'
          ? '来自商家上传的截图，但识别到的位置形状不像完整商品照片，这张仅作版式示意，请核对后再使用。'
          : '来自商家上传的截图中部区域，未取得商品位置，仅作版式示意。',
    });
    log(`已从截图裁切 ${assignment.slotId}（${reliability === 'located' ? '已定位' : reliability === 'uncertain' ? '位置待确认' : '无定位'}）`);
  }
  return assets;
}

export async function readImageAsDataUrl(file) {
  const bytes = await readFile(file);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

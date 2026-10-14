// Product reference crops + combined sheet generation.
// Key change vs. the old approach: every generate cell is a uniform square and
// a program-composed grid template is passed as the first reference image, so
// the model fills a fixed layout instead of inventing one.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const CANVAS = { width: 1536, height: 1152 };
const MARGIN = 24, SEP = 24, COLS = 3;
const CELL_W = Math.floor((CANVAS.width - 2 * MARGIN - SEP * (COLS - 1)) / COLS); // 480
const CELL_H = 540;
const MAX_CELLS_PER_SHEET = 6;

// Reject crops that are mostly blank/text — this happens when the model's box
// drifts onto caption areas instead of the photo. Measured on real runs: real
// product photos fill ≥44% of the tile while caption crops stay below 14%.
async function looksLikeTextTile(buf) {
  const { data } = await sharp(buf).resize(64, 64, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  let nonWhite = 0;
  for (const v of data) if (v < 235) nonWhite++;
  return nonWhite / data.length < 0.2;
}

// Slide a square window over the model's box and keep the content-densest one:
// when the box drifts onto a card area (photo + caption text), the photo is the
// dense part while captions are near-blank. Cheap 32x32 greyscale sampling.
async function densestWindow(bytes, left, top, boxW, boxH, side) {
  const sample = async (l, t) => {
    const { data } = await sharp(bytes).extract({ left: l, top: t, width: side, height: side }).resize(32, 32, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
    let nw = 0;
    for (const v of data) if (v < 235) nw++;
    return nw / data.length;
  };
  const rangeX = boxW - side, rangeY = boxH - side;
  const stepX = rangeX > 0 ? Math.max(Math.floor(side / 3), Math.ceil(rangeX / 11)) : 0;
  const stepY = rangeY > 0 ? Math.max(Math.floor(side / 3), Math.ceil(rangeY / 11)) : 0;
  let best = { ratio: -1, dx: 0, dy: 0 };
  for (let dy = 0; ; dy += stepY) {
    const y = Math.min(dy, rangeY);
    for (let dx = 0; ; dx += stepX) {
      const x = Math.min(dx, rangeX);
      const ratio = await sample(left + x, top + y);
      if (ratio > best.ratio) best = { ratio, dx: x, dy: y };
      if (x >= rangeX) break;
    }
    if (y >= rangeY) break;
  }
  return { left: left + best.dx, top: top + best.dy, ratio: best.ratio };
}

// Cut the recognized product photos (square center-crop) out of the screenshot.
export async function cutProducts(bytes, analysis, dir) {
  const meta = await sharp(bytes).metadata();
  const files = [];
  let seq = 0;
  for (const p of analysis.products) {
    if (!p.box || seq >= 6) continue;
    seq++; // always occupies the slot so product_N ids stay aligned with the plan
    const left = Math.min(meta.width - 1, Math.floor(p.box.x * meta.width));
    const top = Math.min(meta.height - 1, Math.floor(p.box.y * meta.height));
    const w = Math.max(1, Math.min(meta.width - left, Math.round(p.box.w * meta.width)));
    const h = Math.max(1, Math.min(meta.height - top, Math.round(p.box.h * meta.height)));
    // Square window anchored to the densest content inside the box.
    const side = Math.min(w, h);
    const win = await densestWindow(bytes, left, top, w, h, side);
    const buf = await sharp(bytes).extract({ left: win.left, top: win.top, width: side, height: side }).resize(720, 720).png().toBuffer();
    if (await looksLikeTextTile(buf)) continue; // rejected: plan marks it failed, slots fall back to substitutes
    const file = `product-${seq}.png`;
    await fs.promises.writeFile(path.join(dir, file), buf);
    files.push({ id: `product_${seq}`, name: p.name, file, width: 720, height: 720 });
  }
  return files;
}

// Uniform 3-column square grid; unused bottom area stays magenta.
export function layoutGrid(count) {
  const rows = Math.max(1, Math.ceil(count / COLS));
  const cells = [];
  for (let i = 0; i < count; i++) {
    const col = i % COLS, row = Math.floor(i / COLS);
    cells.push({ x: MARGIN + col * (CELL_W + SEP), y: MARGIN + row * (CELL_H + SEP), w: CELL_W, h: CELL_H });
  }
  return cells;
}

// Compose the layout template: magenta background, white cell rects.
async function composeTemplate(placed) {
  const tiles = await Promise.all(placed.map(async c => ({
    input: await sharp({ create: { width: c.w, height: c.h, channels: 3, background: '#FFFFFF' } }).png().toBuffer(),
    left: c.x, top: c.y,
  })));
  return sharp({ create: { width: CANVAS.width, height: CANVAS.height, channels: 3, background: '#FF00FF' } })
    .composite(tiles).png().toBuffer();
}

const pct = (v, total) => (v / total * 100).toFixed(1);

function buildSheetPrompt(cells, design, productFiles) {
  const style = design.style;
  const palette = design.palette;
  const refsText = productFiles.map((p, i) => `参考图${i + 2} = ${p.name}`).join('；');
  const ascii = cells.map((c, i) => {
    const row = Math.round(c.y / (CELL_H + SEP));
    const col = Math.round(c.x / (CELL_W + SEP));
    return `第${row + 1}行第${col + 1}列 = cell_${i + 1}（${c.use}）`;
  }).join('；');
  const cellsText = cells.map((c, i) => `cell_${i + 1}：${c.prompt}${c.refNames?.length ? `，画面中的商品使用参考图（${c.refNames.join('、')}）对应的商品` : ''}。`).join('\n');
  return `生成一张店铺装修素材拼板图，画布 1536×1152。参考图1 是版式模板：品红色背景上有 ${cells.length} 个白色方格。你必须严格保持参考图1 的网格结构——每个白格的位置和大小完全不变，把每个白格替换为一幅独立的照片画面；白格之外的所有区域保持纯品红色 #FF00FF 实色不变。格与格之间不允许出现内容、边框、阴影或文字，画面不得跨越格子边界。

格子分布：${ascii}。

统一摄影风格：${style}。环境与衬布可参考背景色 ${palette.background}、点缀色 ${palette.accent}，但商品自身的颜色与外观不得改变。

${refsText}。参考图是这家店铺的真实商品照片，对应画面必须保持参考商品的品类、外形、颜色与可见细节，不得替换成其他商品，不得把多件参考商品合并成一件。

各格子内容：
${cellsText}

严格约束：每个格子是一幅完整独立的方形摄影画面，构图铺满整个格子；整个拼板上禁止出现任何文字、数字、logo、水印、界面元素；格子里和格子间隙中不得出现品红色以外的边框或装饰。`;
}

async function callSeedream(prompt, refs) {
  const response = await fetch(process.env.ARK_IMAGE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ARK_API_KEY}` },
    body: JSON.stringify({ model: process.env.ARK_IMAGE_MODEL, prompt, image: refs.length === 1 ? refs[0] : refs, size: '1536x1152', response_format: 'b64_json', watermark: false, stream: false }),
    signal: AbortSignal.timeout(300000),
  });
  if (!response.ok) throw new Error(`素材拼板生成请求失败（HTTP ${response.status}）。未自动重试，避免重复计费。`);
  const result = await response.json();
  const item = result.data?.[0];
  if (item?.b64_json) return Buffer.from(item.b64_json, 'base64');
  if (item?.url) {
    const url = new URL(item.url);
    if (url.protocol !== 'https:') throw new Error('素材拼板下载地址无效。');
    const file = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!file.ok) throw new Error('素材拼板下载失败。');
    return Buffer.from(await file.arrayBuffer());
  }
  throw new Error('素材拼板生成没有返回图片。');
}

// Group generate assets into sheets (max 2 calls), generate with the grid
// template, and record the planned cell rects for the cropping step.
export async function generateSheets(assets, design, productFiles, dir, onNote) {
  const pending = assets.filter(a => a.status === 'pending');
  const groups = [];
  for (const asset of pending) {
    const last = groups[groups.length - 1];
    if (last && last.length < MAX_CELLS_PER_SHEET) last.push(asset);
    else groups.push([asset]);
  }
  if (groups.length > 2) {
    const overflow = groups.slice(2).flat();
    groups.length = 2;
    for (const asset of overflow) asset.status = 'failed', asset.note = '素材数量超出两次拼板的承载上限。';
    onNote?.(`生成素材较多，已合并为 2 张拼板，超出的槽位按失败降级处理。`);
  }
  const sheets = [];
  for (const [i, group] of groups.entries()) {
    const placed = layoutGrid(group.length).map((rect, j) => ({
      ...rect,
      asset: group[j],
      use: group[j].use,
      prompt: group[j].prompt || `与店铺品类一致的干净商品摄影画面，主体为店铺在售商品。`,
      refNames: productFiles.map(p => p.name).slice(0, 3),
    }));
    const prompt = buildSheetPrompt(placed, design, productFiles);
    const template = await composeTemplate(placed);
    const refs = [`data:image/png;base64,${template.toString('base64')}`];
    for (const p of productFiles.slice(0, 4)) {
      const bytes = await fs.promises.readFile(path.join(dir, p.file));
      refs.push(`data:image/png;base64,${bytes.toString('base64')}`);
    }
    const bytes = await callSeedream(prompt, refs);
    const file = `sheet-${i + 1}.png`;
    await sharp(bytes).png().toFile(path.join(dir, file));
    fs.writeFileSync(path.join(dir, `sheet-${i + 1}-prompt.txt`), prompt);
    sheets.push({ file, cells: placed.map(c => ({ assetId: c.asset.id, x: c.x, y: c.y, w: c.w, h: c.h })) });
    for (const c of placed) c.asset.status = 'generated', c.asset.sheet = file;
  }
  return sheets;
}

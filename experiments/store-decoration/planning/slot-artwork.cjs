// Bake editorial copy into the same PNG used by preview and platform upload.
// Geometry only: wording, placement and tone are chosen by the planning model.
const sharp = require('sharp');
const { z } = require('zod');
const copySchema = z.object({
  heading: z.string().trim().max(24).default(''),
  body: z.string().trim().max(80).default(''),
  placement: z.enum(['none', 'left', 'right', 'top', 'bottom']).default('none'),
  tone: z.enum(['base', 'alternate']).default('base'),
}).strict();
const color = z.string().regex(/^#[\da-fA-F]{6}$/);
const artworkSchema = copySchema.extend({
  width: z.number().positive().max(1000), height: z.number().positive().max(1200),
  background: color, foreground: color, typography: z.enum(['sans', 'editorial']),
}).strict();
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

function wrap(value, width, size) {
  const lines = []; let line = '', used = 0;
  for (const char of value) {
    if (char === '\n') { lines.push(line); line = ''; used = 0; continue; }
    const advance = /\s/.test(char) ? .4 : /[A-ZMW@]/.test(char) ? .85 : /[\u0020-\u007e]/.test(char) ? .68 : 1.1;
    if (line && (used + advance) * size > width) { lines.push(line.trimEnd()); line = ''; used = 0; }
    line += char; used += advance;
  }
  if (line) lines.push(line.trimEnd());
  return lines;
}
function artworkGeometry(artwork) {
  if (!artwork.heading && !artwork.body) return null;
  if (artwork.placement === 'none') throw Error('图片文案已有内容但没有排字位置，请在画面设计中选择位置。');
  const { width, height, placement } = artwork;
  const pad = Math.max(8, Math.min(28, width * .06, height * .06));
  const side = placement === 'left' || placement === 'right';
  const boxWidth = side ? width * .44 : width;
  const maxHeight = side ? height - pad * 2 : height * .48 - pad * 2;
  const titleBase = Math.min(38, Math.max(20, width * .08));
  // Only shrink within readable bounds, never omit/truncate copy or move it outside the PNG.
  for (const scale of [1, .9, .8]) {
    const titleSize = Math.max(18, Math.round(titleBase * scale)), bodySize = Math.max(13, Math.round(18 * scale));
    const heading = wrap(artwork.heading, boxWidth - pad * 2, titleSize);
    const body = wrap(artwork.body, boxWidth - pad * 2, bodySize);
    const titleLine = Math.ceil(titleSize * 1.35), bodyLine = Math.ceil(bodySize * 1.6);
    const gap = heading.length && body.length ? Math.ceil(bodySize * .65) : 0;
    const textHeight = heading.length * titleLine + body.length * bodyLine + gap;
    if (textHeight > maxHeight) continue;
    const bandHeight = side ? height : textHeight + pad * 2;
    const x = placement === 'right' ? width - boxWidth : 0;
    const y = placement === 'bottom' ? height - bandHeight : 0;
    return { heading, body, titleSize, bodySize, titleLine, bodyLine, gap, textHeight,
      panel: { x, y, width: boxWidth, height: bandHeight },
      textX: x + pad, textY: side ? (height - textHeight) / 2 : y + pad };
  }
  const error = Error('文案超出当前图片槽位的可读范围，请在画面设计中缩短文案或选择更大的组件；未移到图片外。');
  error.code = 'ARTWORK_TEXT_OVERFLOW';
  throw error;
}
function artworkBrief(artwork) {
  const g = artworkGeometry(artwork);
  if (!g) return '本图不叠加设计文案，按本格内容构图。';
  const names = { left: '左侧', right: '右侧', top: '顶部', bottom: '底部' };
  const side = ['left', 'right'].includes(artwork.placement);
  const fade = Math.min(artwork.width, artwork.height) * .03;
  const fraction = side ? (g.panel.width + fade) / artwork.width : (g.panel.height + fade) / artwork.height;
  return `本图成品将在${names[artwork.placement]}约${Math.ceil(fraction * 100)}%区域合入标题“${artwork.heading}”及短文“${artwork.body}”。此区域保留平静空间，主体与人物关键部位放在其余区域，不能被排字遮挡。排字区域以${artwork.background}衔接画面；这是图片内部设计，不是店铺底色。模型只生成摄影内容，不画文字，程序裁剪后把文字写入同一PNG。`;
}
// Report deterministic size constraints to the designer without changing its copy
// or placement. Use the exact same geometry and readable limits as PNG export.
function artworkFitFeedback(artwork, allowedPlacements) {
  const fits = (placement, body) => {
    try { return !!artworkGeometry({ ...artwork, placement, body }); }
    catch (error) { if (error.code === 'ARTWORK_TEXT_OVERFLOW') return false; throw error; }
  };
  return {
    width: artwork.width, height: artwork.height,
    currentCopy: { heading: artwork.heading, body: artwork.body, placement: artwork.placement },
    currentCopyFitsAt: allowedPlacements.filter(placement => fits(placement, artwork.body)),
    headingOnlyFitsAt: artwork.heading ? allowedPlacements.filter(placement => fits(placement, '')) : [],
  };
}
function readable(foreground, background) {
  const lum = hex => hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const fg = lum(foreground), bg = lum(background);
  return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05) >= 4.5 ? foreground : bg > .179 ? '#171717' : '#FFFFFF';
}
async function bakeArtwork(bytes, value) {
  if (!value) return bytes;
  const a = artworkSchema.parse(value), g = artworkGeometry(a);
  if (!g) return bytes;
  const meta = await sharp(bytes).metadata();
  const font = a.typography === 'editorial' ? 'SimSun,Songti SC,Noto Serif CJK SC,serif' : 'Microsoft YaHei,PingFang SC,Noto Sans CJK SC,sans-serif';
  const p = g.panel;
  const text = (lines, startY, size, step, heading) => lines.map((line, i) => `<text x="${g.textX}" y="${startY + i * step + size}" font-family="${heading ? font : 'Microsoft YaHei,PingFang SC,Noto Sans CJK SC,sans-serif'}" font-size="${size}" font-weight="${heading ? 600 : 400}">${escape(line)}</text>`).join('');
  // An opaque text area guarantees contrast; a short fade joins it to the photograph.
  const fade = Math.min(a.width, a.height) * .03;
  const fades = {
    left: [p.width, 0, fade, a.height, '0%', '0%', '100%', '0%'],
    right: [p.x - fade, 0, fade, a.height, '100%', '0%', '0%', '0%'],
    top: [0, p.height, a.width, fade, '0%', '0%', '0%', '100%'],
    bottom: [0, p.y - fade, a.width, fade, '0%', '100%', '0%', '0%'],
  };
  const [x, y, w, h, x1, y1, x2, y2] = fades[a.placement];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}" viewBox="0 0 ${a.width} ${a.height}" preserveAspectRatio="none"><defs><linearGradient id="fade" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop stop-color="${a.background}"/><stop offset="1" stop-color="${a.background}" stop-opacity="0"/></linearGradient></defs><rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" fill="${a.background}"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#fade)"/><g fill="${readable(a.foreground, a.background)}">${text(g.heading, g.textY, g.titleSize, g.titleLine, true)}${text(g.body, g.textY + g.heading.length * g.titleLine + g.gap, g.bodySize, g.bodyLine, false)}</g></svg>`;
  return sharp(bytes).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
}
module.exports = { copySchema, artworkSchema, artworkGeometry, artworkBrief, artworkFitFeedback, bakeArtwork };

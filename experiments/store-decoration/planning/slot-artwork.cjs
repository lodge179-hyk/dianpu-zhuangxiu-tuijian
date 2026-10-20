// Bake editorial copy into the same PNG used by preview and platform upload.
// Geometry only: wording, placement and tone are chosen by the planning model.
const sharp = require('sharp');
const { z } = require('zod');
const copySchema = z.object({
  heading: z.string().trim().max(24).default(''),
  body: z.string().trim().max(80).default(''),
  placement: z.enum(['none', 'left', 'right', 'top', 'bottom']).default('none'),
  tone: z.enum(['base', 'alternate']).default('base'),
  surface:z.enum(['none','gradient','panel']).optional(),
  align:z.enum(['left','center']).optional(),
  size:z.enum(['quiet','normal','display']).optional(),
  widthRatio:z.number().min(.30).max(.62).optional(),
}).strict();
// Native image typography is composed by the image model, so it can use center
// placement and right alignment. Legacy overlays keep their supported geometry.
const nativeCopySchema=copySchema.extend({
  placement:z.enum(['none','left','right','top','bottom','center']).default('none'),
  align:z.enum(['left','center','right']).optional(),
}).strict();
const color = z.string().regex(/^#[\da-fA-F]{6}$/);
const artworkFields={
  width: z.number().positive().max(1000), height: z.number().positive().max(1200),
  background: color, foreground: color, typography: z.enum(['sans', 'editorial']),
};
const artworkSchema=z.union([
  copySchema.extend({version:z.literal(2).optional(),...artworkFields}).strict(),
  nativeCopySchema.extend({version:z.literal(3),...artworkFields}).strict(),
]);
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
  if(artwork.version>=2)return studioGeometry(artwork);
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
function studioGeometry(a){
  const side=['left','right'].includes(a.placement), pad=Math.max(10,Math.min(26,a.width*.055,a.height*.075));
  const width=side?a.width*(a.widthRatio||.44):a.width, available=width-2*pad;
  const maxHeight=(side?a.height:a.height*.44)-2*pad;
  const base=Math.min(a.size==='display'?36:28,Math.max(15,a.width*(a.size==='quiet'?.045:.06)));
  for(const factor of [1,.92,.84]){
    const titleSize=Math.max(14,Math.round(base*factor)),bodySize=a.width<200?12:Math.max(12,Math.round(14*factor));
    const heading=wrap(a.heading,available,titleSize),body=wrap(a.body,available,bodySize);
    // Balance short Chinese headings without discarding characters or changing copy.
    if(heading.length===2&&Array.from(heading[1]).length===1&&Array.from(heading[0]).length>2){const chars=Array.from(heading[0]);heading[1]=chars.pop()+heading[1];heading[0]=chars.join('');}
    const titleLine=Math.ceil(titleSize*1.3),bodyLine=Math.ceil(bodySize*1.65),gap=heading.length&&body.length?10:0;
    const textHeight=heading.length*titleLine+body.length*bodyLine+gap;
    if(textHeight>maxHeight||heading.length>3)continue;
    const bandHeight=side?a.height:textHeight+2*pad;
    const x=a.placement==='right'?a.width-width:0,y=a.placement==='bottom'?a.height-bandHeight:0;
    return {heading,body,titleSize,bodySize,titleLine,bodyLine,gap,textHeight,panel:{x,y,width,height:bandHeight},textX:a.align==='center'?x+width/2:x+pad,textY:side?(a.height-textHeight)/2:y+pad};
  }
  const error=Error('文案在实际槽位中无法保持清楚、舒展的排版，请精简文字或选择更大的组件。');error.code='ARTWORK_TEXT_OVERFLOW';throw error;
}
function artworkBrief(artwork) {
  if(artwork.version===3)return `本格为图文一体设计，由生图模型绘制准确文字：标题${JSON.stringify(artwork.heading)}，说明${JSON.stringify(artwork.body)}。构图意图${artwork.placement}，${artwork.align||'left'}对齐，标题主导、说明次要。文字与商品轮廓分离，留在平静背景，清楚对比，不压住主体，四周保留约8%安全边界。字体气质${artwork.typography}，参考字色${artwork.foreground}，按实际背景提高对比。无需绘制白色文字板，不使用后贴遮罩，程序不会二次叠字。`;
  const g = artworkGeometry(artwork);
  if (!g) return '本图不叠加设计文案，按本格内容构图。';
  const names = { left: '左侧', right: '右侧', top: '顶部', bottom: '底部' };
  const side = ['left', 'right'].includes(artwork.placement);
  const fade = Math.min(artwork.width, artwork.height) * .03;
  const fraction = side ? (g.panel.width + fade) / artwork.width : (g.panel.height + fade) / artwork.height;
  return `本图成品将在${names[artwork.placement]}约${Math.ceil(fraction * 100)}%区域合入标题“${artwork.heading}”及短文“${artwork.body}”。此区域保留平静空间，主体与人物关键部位放在其余区域，不能被排字遮挡。排字区域以${artwork.background}衔接画面；${artwork.version===2&&artwork.surface!=='panel'?'保持连续自然背景，不画一块生硬空白板。文字位置使用'+(artwork.surface==='none'?'直接叠字':'柔和渐变衬字')+'。':''}这是图片内部设计，不是店铺底色。模型只生成图像内容，不画文字，程序裁剪后把文字写入同一PNG。`;
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
  const a = artworkSchema.parse(value);
  if(a.version===3)return bytes;
  const g = artworkGeometry(a);
  if (!g) return bytes;
  const meta = await sharp(bytes).metadata();
  const font = a.typography === 'editorial' ? 'SimSun,Songti SC,Noto Serif CJK SC,serif' : 'Microsoft YaHei,PingFang SC,Noto Sans CJK SC,sans-serif';
  const p = g.panel;
  const text = (lines, startY, size, step, heading) => lines.map((line, i) => `<text x="${g.textX}" y="${startY + i * step + size}" font-family="${heading ? font : 'Microsoft YaHei,PingFang SC,Noto Sans CJK SC,sans-serif'}" font-size="${size}" font-weight="${heading ? 600 : 400}">${escape(line)}</text>`).join('');
  if(a.version===2){
    const horizontal=['left','right'].includes(a.placement);
    const gradient={left:['0%','0%','100%','0%'],right:['100%','0%','0%','0%'],top:['0%','0%','0%','100%'],bottom:['0%','100%','0%','0%']}[a.placement];
    const extent=horizontal?Math.min(a.width,p.width+a.width*.18):Math.min(a.height,p.height+a.height*.18);
    const x=a.placement==='right'?a.width-extent:0,y=a.placement==='bottom'?a.height-extent:0;
    const background=a.surface==='none'?'':a.surface==='panel'?`<rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" fill="${a.background}"/>`:`<defs><linearGradient id="scrim" x1="${gradient[0]}" y1="${gradient[1]}" x2="${gradient[2]}" y2="${gradient[3]}"><stop stop-color="${a.background}" stop-opacity=".96"/><stop offset=".58" stop-color="${a.background}" stop-opacity=".86"/><stop offset="1" stop-color="${a.background}" stop-opacity="0"/></linearGradient></defs><rect x="${x}" y="${y}" width="${horizontal?extent:a.width}" height="${horizontal?a.height:extent}" fill="url(#scrim)"/>`;
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}" viewBox="0 0 ${a.width} ${a.height}">${background}<g fill="${readable(a.foreground,a.background)}" text-anchor="${a.align==='center'?'middle':'start'}">${text(g.heading,g.textY,g.titleSize,g.titleLine,true)}${text(g.body,g.textY+g.heading.length*g.titleLine+g.gap,g.bodySize,g.bodyLine,false)}</g></svg>`;
    return sharp(bytes).composite([{input:Buffer.from(svg)}]).png().toBuffer();
  }
  // Legacy artifacts retain their original geometry and opaque panels.
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
module.exports = { copySchema, nativeCopySchema, artworkSchema, artworkGeometry, artworkBrief, artworkFitFeedback, bakeArtwork };

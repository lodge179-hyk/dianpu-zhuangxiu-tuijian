// Geometry and text drawing only. The model owns content, module choice and order.
const WIDTH = 483, PAD = 28, GAP = 16;
const aspectValues = { '3:1': 3, '4:3': 4 / 3, '1:1': 1, '3:4': 3 / 4 };
const frameTypes = { wide: ['carousel.small', '3:1'], landscape: ['carousel.medium', '4:3'], square: ['poster.single', '1:1'], portrait: ['carousel.large', '3:4'] };
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function wrap(value, width, fontSize) {
  const lines = [];
  let line = '', units = 0;
  for (const char of String(value)) {
    if (char === '\n') { lines.push(line); line = ''; units = 0; continue; }
    // Conservative advance leaves room for platform font fallback, including CJK.
    const advance = /\s/.test(char) ? .38 : /[A-ZMW@]/.test(char) ? .82 : /[\u0020-\u007e]/.test(char) ? .65 : 1.08;
    if (line && (units + advance) * fontSize > width) { lines.push(line.trimEnd()); line = ''; units = 0; }
    line += char; units += advance;
  }
  if (line) lines.push(line.trimEnd());
  return lines;
}
function copyBlock(story, width, display = false) {
  const titleSize = display ? 38 : 30, bodySize = 18;
  const heading = wrap(story.heading, width, titleSize), body = wrap(story.body, width, bodySize);
  const gap = heading.length && body.length ? 14 : 0;
  return { heading, body, titleSize, bodySize, titleLine: Math.ceil(titleSize * 1.35), bodyLine: 29,
    height: heading.length * Math.ceil(titleSize * 1.35) + gap + body.length * 29, gap };
}

function moduleGeometry(module, lookup) {
  const story = module.story, contentWidth = WIDTH - PAD * 2;
  const imageAssets = module.props.assetIds.map(id => lookup.get(id));
  const poster = story.layout === 'poster', statement = story.layout === 'statement';
  const inset = poster ? 0 : PAD;
  const columns = ['pair', 'collection'].includes(story.layout) ? imageAssets.length : 1;
  const imageWidth = (WIDTH - inset * 2 - GAP * (columns - 1)) / columns;
  const imageHeight = imageAssets.length ? imageWidth / aspectValues[imageAssets[0].aspect] : 0;
  let overlay = poster && story.textPlacement.startsWith('on-image');
  let copy = copyBlock(story, overlay ? WIDTH * .42 - PAD : contentWidth, poster || statement);
  // Long copy still appears in full; fall back to a separate text area if it cannot fit.
  if (overlay && copy.height > imageHeight - PAD * 2) { overlay = false; copy = copyBlock(story, contentWidth, true); }
  const copyHeight = copy.height ? copy.height + PAD * 2 : 0;
  const above = story.textPlacement === 'above';
  const imageTop = overlay ? 0 : above ? copyHeight : poster ? 0 : PAD;
  const images = imageAssets.map((asset, i) => ({ assetId: asset.id, rect: [inset + i * (imageWidth + GAP), imageTop, imageWidth, imageHeight] }));
  const captions = story.layout === 'collection' ? module.props.titles.map(title => wrap(title, imageWidth, 17)) : [];
  const captionHeight = captions.length ? Math.max(...captions.map(lines => lines.length)) * 26 + 14 : 0;
  const copyX = overlay && story.textPlacement === 'on-image-right' ? WIDTH - PAD - (WIDTH * .42 - PAD) : PAD;
  const copyY = overlay ? Math.max(PAD, (imageHeight - copy.height) / 2) : above || statement ? PAD : imageTop + imageHeight + captionHeight + PAD;
  const height = statement ? copyHeight + 24 : overlay ? imageHeight
    : above ? copyHeight + imageHeight + captionHeight + (poster ? 0 : PAD)
    : imageTop + imageHeight + captionHeight + (copyHeight || (poster ? 0 : PAD));
  return { height: Math.ceil(height), images, captions, copy, copyX, copyY, overlay, inset, imageWidth, imageTop, imageHeight };
}

function readable(foreground, background) {
  const lum = hex => {
    const rgb = hex.slice(1).match(/../g).map(c => parseInt(c, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const bg = lum(background), fg = lum(foreground), ratio = (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05);
  return ratio >= 4.5 ? foreground : bg > .179 ? '#171717' : '#FFFFFF';
}

function renderNarrativePage(plan) {
  const theme = plan.pageDesign, lookup = new Map(plan.assets.map(a => [a.id, a]));
  const photos = [], components = [], modules = [];
  let top = 0;
  const font = theme.typography === 'editorial' ? '"Songti SC","Noto Serif CJK SC","SimSun",serif' : '"PingFang SC","Microsoft YaHei",system-ui,sans-serif';
  const text = (lines, x, y, fontSize, lineHeight, heading = false) => lines.map((line, i) => `<div class="line${heading ? ' heading' : ''}" style="left:${x}px;top:${y + i * lineHeight}px;font-size:${fontSize}px;line-height:${lineHeight}px${heading ? ';font-family:' + escape(font) : ''}">${escape(line)}</div>`).join('');
  for (const module of plan.modules) {
    const g = moduleGeometry(module, lookup), story = module.story;
    const bg = story.tone === 'alternate' ? theme.alternateBackground : theme.background;
    const fg = readable(story.tone === 'alternate' ? theme.alternateForeground : theme.foreground, bg);
    const pictures = g.images.map((image, i) => {
      const [x, y, w, h] = image.rect;
      photos.push({ id: module.id + '.photo-' + (i + 1), moduleId: module.id, assetId: image.assetId, rect: [x, top + y, w, h], role: 'photo' });
      return `<img src="assets/${image.assetId}.png" alt="${escape(lookup.get(image.assetId).subject)}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">`;
    }).join('');
    const captionText = g.captions.map((lines, i) => text(lines, PAD + i * (g.imageWidth + GAP), g.imageTop + g.imageHeight + 14, 17, 26)).join('');
    const copyText = text(g.copy.heading, g.copyX, g.copyY, g.copy.titleSize, g.copy.titleLine, true)
      + text(g.copy.body, g.copyX, g.copyY + g.copy.heading.length * g.copy.titleLine + g.copy.gap, 18, 29);
    const decoratedCopy = story.layout === 'statement' ? `<div style="color:${readable(theme.accent, bg)}">${copyText}</div>` : copyText;
    const overlay = g.overlay ? `<div class="veil" style="background:linear-gradient(${story.textPlacement === 'on-image-left' ? '90deg' : '270deg'},${bg} 0%,${bg}d9 34%,${bg}00 72%)"></div>` : '';
    modules.push(`<section id="${module.id}" data-chapter="${escape(story.chapter)}" aria-label="${escape(story.heading || story.message)}" style="top:${top}px;height:${g.height}px;background:${bg};color:${fg}">${pictures}${overlay}${captionText}${decoratedCopy}</section>`);
    components.push({ id: module.id, moduleId: module.id, role: 'narrative-module', type: module.type, chapter: story.chapter, rect: [0, top, WIDTH, g.height] });
    top += g.height;
  }
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=483"><title>${escape(plan.shop.name)}</title><style>*{box-sizing:border-box}html,body{margin:0;background:${theme.background};font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif}#shop{position:relative;width:${WIDTH}px;height:${top}px;background:${theme.background}}section{position:absolute;left:0;width:${WIDTH}px;overflow:hidden}img{position:absolute;display:block;object-fit:contain}.line{position:absolute;white-space:pre;font-weight:400}.heading{font-weight:600;letter-spacing:-.015em}.veil{position:absolute;inset:0;pointer-events:none}</style></head><body><main id="shop">${modules.join('')}</main><script>Promise.all([...document.images].map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=r;i.onerror=r}))).then(()=>document.fonts.ready).then(()=>{document.documentElement.dataset.ready='true'});</script></body></html>`;
  return { html, width: WIDTH, height: top, moduleCount: modules.length, components, photos };
}
module.exports = { frameTypes, moduleGeometry, renderNarrativePage };

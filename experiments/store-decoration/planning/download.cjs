const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { zipSync, strToU8 } = require('fflate');
const sharp = require('sharp');
const { chromium } = require('playwright-core');
const { validatePlan } = require('./plan.cjs');

const families = { signboard: '店铺招牌', navigation: '分类导航', text: '文字', carousel: '轮播图', poster: '海报', showcase: '商品橱窗' };
const number = n => String(n).padStart(2, '0');

function safeName(value) {
  const name = String(value).replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-').replace(/[. ]+$/g, '').trim();
  return Array.from(name || '店铺装修').slice(0, 60).join('');
}
function attachmentHeader(state, kind) {
  const suffix = kind === 'png' ? '装修长图.png' : '装修素材.zip';
  const filename = `${safeName(state.plan.shop.name)}-${suffix}`;
  return `attachment; filename="store-${kind === 'png' ? 'preview.png' : 'materials.zip'}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`;
}

async function readExport(folder, state) {
  if (state.status !== 'ready') throw Error('请先完成装修方案，再下载。');
  const { plan } = validatePlan(state.plan);
  const missing = plan.assets.filter(a => !state.filledAssets?.includes(a.id));
  if (missing.length) throw Error(`还有 ${missing.length} 张素材未填入，请上传剩余总图后再下载。`);
  const assets = new Map();
  for (const asset of plan.assets) {
    const file = path.join(folder, 'assets', asset.id + '.png');
    if (!fs.existsSync(file)) throw Error(`素材 ${asset.id} 文件缺失，请重新填入后再下载。`);
    const bytes = fs.readFileSync(file), meta = await sharp(bytes).metadata();
    if (meta.format !== 'png' || meta.width < 2 || meta.height < 2) throw Error(`素材 ${asset.id} 仍是占位图或文件无效，请重新填入后再下载。`);
    assets.set(asset.id, { bytes, width: meta.width, height: meta.height });
  }
  for (const file of ['shop.html', 'assets/avatar.png']) {
    if (!fs.existsSync(path.join(folder, file))) throw Error('店铺预览文件缺失，请重新填入素材后再下载。');
  }
  return { plan, assets };
}

// CSV opens directly in Excel; user-supplied copy stays text, including formula-like copy.
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

async function materialsZip(folder, state) {
  const { plan, assets } = await readExport(folder, state);
  const files = {}, modules = [], rows = [['模块顺序', '模块名称', '组件类型', '用途', '图片顺序', '素材文件', '原图尺寸', '导航名称或商品标题', '文字内容']];
  const addText = (name, content) => { files[name] = strToU8(content); };
  const addImage = (name, bytes) => { files[name] = [bytes, { level: 0 }]; };
  plan.modules.forEach((module, index) => {
    const name = families[module.type.split('.')[0]], directory = `模块素材/${number(index + 1)}-${name}`;
    const images = module.props.assetIds.map((id, slot) => {
      const asset = assets.get(id), file = `${directory}/${number(slot + 1)}-${id}.png`;
      const label = module.props.labels[slot] || module.props.titles[slot] || '';
      addImage(file, asset.bytes);
      rows.push([index + 1, name, module.type, module.purpose, slot + 1, file, `${asset.width} × ${asset.height}`, label, module.props.text]);
      return { order: slot + 1, assetId: id, file, label, width: asset.width, height: asset.height };
    });
    if (!images.length) rows.push([index + 1, name, module.type, module.purpose, '', '', '', '', module.props.text]);
    addText(`${directory}/模块说明.txt`, `模块 ${number(index + 1)}：${name}\r\n组件：${module.type}\r\n用途：${module.purpose}\r\n文字：${module.props.text || '无'}\r\n` + (images.length ? images.map(i => `图片 ${i.order}：${path.posix.basename(i.file)}${i.label ? '\r\n名称：' + i.label : ''}`).join('\r\n') : '本模块使用文字或平台固定内容，无需上传装修图片。') + '\r\n');
    modules.push({ order: index + 1, id: module.id, type: module.type, name, purpose: module.purpose, text: module.props.text, images });
  });
  // Explicit allowlist: original uploads, model responses and local config never enter the archive.
  addText('店铺预览/shop.html', fs.readFileSync(path.join(folder, 'shop.html'), 'utf8'));
  for (const [id, asset] of assets) addImage(`店铺预览/assets/${id}.png`, asset.bytes);
  addImage('店铺预览/assets/avatar.png', fs.readFileSync(path.join(folder, 'assets/avatar.png')));
  addText('模块对照表.csv', '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'));
  addText('素材对照.json', JSON.stringify({ version: 1, shop: plan.shop.name, runId: state.id, modules }, null, 2));
  addText('使用说明.txt', `${plan.shop.name} · 装修素材\r\n\r\n1. 先解压 ZIP，再打开“店铺预览/shop.html”查看整页效果，无需启动本工具。\r\n2. 按“模块素材”中的数字顺序，在微购装修中添加对应组件；将各模块文件夹的 PNG 按数字顺序上传。\r\n3. 文字、导航名称和商品标题见“模块说明.txt”或“模块对照表.csv”；后者可用 Excel 打开。\r\n4. 同一图片用于多个模块时，各模块都保留一份，避免手动寻找复用关系。\r\n5. 完整 PNG 长图请在页面另点“下载完整长图”；它用于展示整页效果。\r\n\r\n图片为装修示意，商品信息需自行核对。店铺头像仍使用现有占位图，实际装修时请换成自己的头像。\r\n此 ZIP 是手动装修素材包，不是微购可一键导入的模板。\r\n`);
  return Buffer.from(zipSync(files, { level: 1 }));
}

async function launchRenderer() {
  const executablePath = process.env.PLANNER_BROWSER_PATH;
  const choices = executablePath ? [{ executablePath }] : [{ channel: 'chrome' }, { channel: 'msedge' }, {}];
  for (const choice of choices) {
    try { return await chromium.launch({ ...choice, headless: true, timeout: 15000 }); } catch {}
  }
  throw Error('长图导出需要本机 Chrome 或 Edge。请安装其中一个，或用 PLANNER_BROWSER_PATH 指定浏览器路径后重启；素材 ZIP 仍可下载。');
}

async function shopPng(folder, state) {
  await readExport(folder, state);
  const browser = await launchRenderer();
  try {
    const context = await browser.newContext({ viewport: { width: 483, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light', locale: 'zh-CN', reducedMotion: 'reduce' });
    // Export uses the same saved page and local assets as preview, without external requests.
    await context.route(/^https?:/, route => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    await page.goto(pathToFileURL(path.join(folder, 'shop.html')).href, { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    return await page.locator('#shop').screenshot({ type: 'png', animations: 'disabled', timeout: 45000 });
  } finally { await browser.close(); }
}

module.exports = { materialsZip, shopPng, attachmentHeader, readExport };

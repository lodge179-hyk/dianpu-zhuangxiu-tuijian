// AI 装修决策 Demo · http://127.0.0.1:5183
// Pipeline: 截图 → 理解 → 决策 → 商品参考 → 组合生图(≤2) → 裁剪 → 渲染 → 交付
// Start: node --env-file=.env.local scripts/decoration-decision/server.mjs
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { buildCatalog, decisionSubset } from './catalog.cjs';
import { analyzeScreenshot, decideDesign } from './vision.mjs';
import { buildPlan } from './plan.mjs';
import { cutProducts, generateSheets } from './sheets.mjs';
import { cropSheets } from './crop.mjs';
import { renderStore } from './render.mjs';
import { makeZip } from './zip.mjs';

const require = createRequire(import.meta.url);
const busboy = require('busboy');

const PORT = Number(process.env.DECISION_PORT || 5183);
const ROOT = path.resolve(import.meta.dirname);
const RUNS = path.join(ROOT, 'runs');
const MAX_UPLOAD = 30 * 1024 * 1024;
const CATALOG = decisionSubset(buildCatalog());
fs.mkdirSync(RUNS, { recursive: true });

const runs = new Map();
let busy = null;

const STEPS = [
  { id: 'analyze', label: '理解店铺' },
  { id: 'decide', label: 'AI 设计决策' },
  { id: 'products', label: '准备商品素材' },
  { id: 'sheets', label: '生成素材拼板' },
  { id: 'crop', label: '裁剪独立素材' },
  { id: 'render', label: '渲染装修页面' },
];

function newRun(id) {
  const dir = path.join(RUNS, id);
  fs.mkdirSync(dir, { recursive: true });
  const run = {
    id, dir, status: 'running', error: null, phase: '',
    steps: STEPS.map(s => ({ ...s, status: 'pending', note: '' })),
    degradations: [], result: null, createdAt: Date.now(),
  };
  runs.set(id, run);
  return run;
}
const step = (run, id, status, note = '') => {
  const s = run.steps.find(s => s.id === id);
  if (s) { s.status = status; if (note) s.note = note; }
};
const note = (run, text) => { if (text) run.degradations.push(text); };

function runSnapshot(run) {
  return {
    id: run.id, status: run.status, phase: run.phase, error: run.error,
    steps: run.steps, degradations: run.degradations, result: run.result,
  };
}

async function pipeline(run, bytes) {
  try {
    // --- analyze: full prompt twice, then a simplified prompt as last resort ---
    run.phase = 'analyze';
    step(run, 'analyze', 'running');
    let analysis;
    const attempts = [{ simple: false }, { simple: false }, { simple: true }];
    for (let i = 0; i < attempts.length; i++) {
      try {
        analysis = await analyzeScreenshot(bytes, attempts[i]);
        break;
      } catch (err) {
        if (i === attempts.length - 1) throw err;
        note(run, `第 ${i + 1} 次截图识别未成功（${err.message}），正在换一种问法重试。`);
      }
    }
    fs.writeFileSync(path.join(run.dir, 'analysis.json'), JSON.stringify(analysis, null, 2));
    const withBox = analysis.products.filter(p => p.box).length;
    const warn = analysis.warnings.length ? `：${analysis.warnings[0]}` : '';
    step(run, 'analyze', analysis.warnings.length ? 'degraded' : 'done', `店铺「${analysis.shopName}」· ${analysis.category} · 识别到 ${withBox} 件可用参考商品${warn}`);
    if (analysis.warnings.length) note(run, `截图识别提示${warn}`);
    if (!withBox) note(run, '未识别到带坐标的商品照片，橱窗与兜底素材将全部依赖生成图。');

    // --- decide ---
    run.phase = 'decide';
    step(run, 'decide', 'running');
    const decision = await decideDesign(bytes, analysis, CATALOG);
    const plan = buildPlan(decision, analysis, CATALOG);
    fs.writeFileSync(path.join(run.dir, 'plan.json'), JSON.stringify({ design: plan.design, modules: plan.modules.map(({ catalog, ...m }) => m), assets: plan.assets, degradations: plan.degradations }, null, 2));
    for (const d of plan.degradations) note(run, d);
    step(run, 'decide', 'done', `${plan.design.title} · ${plan.modules.length} 个模块 · ${plan.assets.length} 张生成素材 + 商品直填`);

    // --- products: square crops + avatar ---
    run.phase = 'products';
    step(run, 'products', 'running');
    const productFiles = await cutProducts(bytes, analysis, run.dir);
    for (const pf of productFiles) {
      const p = plan.products.find(p => p.id === pf.id);
      if (p) { p.status = 'ready'; p.file = pf.file; }
    }
    for (const p of plan.products) if (p.status === 'pending') p.status = 'failed', p.note = '商品照片未能从截图裁出。';
    if (productFiles.length) {
      await sharp(path.join(run.dir, productFiles[0].file)).resize(160, 160).png().toFile(path.join(run.dir, 'avatar.png'));
      note(run, '店铺头像不可从截图单独提取，已用第一件参考商品的方形裁剪作为示意头像。');
    } else {
      // avatar is mandatory for the a9 signboard; fall back to a neutral tile
      await sharp({ create: { width: 160, height: 160, channels: 3, background: plan.design.palette.accent } }).png().toFile(path.join(run.dir, 'avatar.png'));
      note(run, '没有可用商品照片，头像已用纯色占位。');
    }
    step(run, 'products', 'done', `${productFiles.length} 件商品参考图（方形裁剪）`);

    // --- sheets: ≤2 combined generation calls with a grid template ---
    run.phase = 'sheets';
    step(run, 'sheets', 'running');
    const sheets = await generateSheets(plan.assets, plan.design, productFiles, run.dir, t => note(run, t));
    step(run, 'sheets', 'done', `${sheets.length} 次拼板生成调用 · ${plan.assets.filter(a => a.status === 'generated').length} 张素材待裁剪`);

    // --- crop ---
    run.phase = 'crop';
    step(run, 'crop', 'running');
    await cropSheets(sheets, plan.assets, run.dir, t => note(run, t));
    const ready = plan.assets.filter(a => a.status === 'ready').length;
    const failedAssets = plan.assets.filter(a => a.status === 'failed');
    if (ready < Math.ceil(plan.assets.length * 0.4)) throw new Error(`仅 ${ready}/${plan.assets.length} 张素材裁剪成功，不足以组成页面，请重试。`);
    for (const a of failedAssets) note(run, `素材 ${a.id}（${a.use}）裁剪失败：${a.note}`);
    step(run, 'crop', failedAssets.length ? 'degraded' : 'done', `${ready}/${plan.assets.length} 张素材裁剪成功`);

    // --- render ---
    run.phase = 'render';
    step(run, 'render', 'running');
    const result = renderStore(plan, run.dir);
    run.result = { ...result, design: plan.design, modules: plan.modules.map(m => ({ id: m.id, type: m.type, label: m.label, reason: m.reason })), slotMap: result.slotMap };
    fs.writeFileSync(path.join(run.dir, 'result.json'), JSON.stringify(run.result, null, 2));
    fs.writeFileSync(path.join(run.dir, 'report.json'), JSON.stringify({
      status: 'complete', id: run.id, createdAt: new Date(run.createdAt).toISOString(),
      models: { vision: process.env.ARK_VISION_MODEL, image: process.env.ARK_IMAGE_MODEL },
      design: plan.design, modules: run.result.modules, slotMap: result.slotMap,
      degradations: run.degradations,
      steps: run.steps,
    }, null, 2));
    const missing = result.slotMap.filter(s => !s.file).length;
    step(run, 'render', missing ? 'degraded' : 'done', `${result.moduleCount} 个模块 · 页面高 ${Math.round(result.height)}px${missing ? ` · ${missing} 个槽位未回填` : ''}`);
    run.status = 'complete';
  } catch (error) {
    run.status = 'failed';
    run.error = error.message || String(error);
    const failedStep = STEPS.find(s => s.id === run.phase);
    if (failedStep) step(run, failedStep.id, 'failed', run.error);
    try { fs.writeFileSync(path.join(run.dir, 'error.txt'), run.error); } catch {}
  } finally {
    if (busy === run.id) busy = null;
  }
}

const send = (res, code, body, headers = {}) => { res.writeHead(code, headers); res.end(body); };
const sendFile = (res, file, type = 'application/octet-stream', download = '') => {
  const headers = { 'Content-Type': type };
  if (download) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(download)}`;
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (req.method === 'GET' && url.pathname === '/') return sendFile(res, path.join(ROOT, 'index.html'), 'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/api/status') {
      return send(res, 200, JSON.stringify({ busy: !!busy, vision: process.env.ARK_VISION_MODEL, image: process.env.ARK_IMAGE_MODEL }), { 'Content-Type': 'application/json' });
    }
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      if (busy) return send(res, 409, JSON.stringify({ error: '上一次生成还在进行中，请等待它完成。' }), { 'Content-Type': 'application/json' });
      const bb = busboy({ headers: req.headers, limits: { fileSize: MAX_UPLOAD, files: 1 } });
      let handled = false;
      bb.on('file', async (name, stream, info) => {
        if (handled || !/^image\//.test(info.mimeType || '')) { stream.resume(); if (!handled) { handled = true; return send(res, 400, JSON.stringify({ error: '请上传 PNG/JPG/WebP 格式的店铺截图。' }), { 'Content-Type': 'application/json' }); } return; }
        handled = true;
        const chunks = [];
        for await (const c of stream) chunks.push(c);
        const bytes = Buffer.concat(chunks);
        if (stream.truncated) return send(res, 413, JSON.stringify({ error: '截图超过 30MB，请压缩后重试。' }), { 'Content-Type': 'application/json' });
        if (bytes.length < 1024) return send(res, 400, JSON.stringify({ error: '文件内容为空或过小。' }), { 'Content-Type': 'application/json' });
        let meta;
        try { meta = await sharp(bytes).metadata(); } catch { return send(res, 400, JSON.stringify({ error: '无法解码这张图片，请确认是完整的店铺截图。' }), { 'Content-Type': 'application/json' }); }
        if (!meta.width || !meta.height || meta.width > 20000 || meta.height > 30000) return send(res, 400, JSON.stringify({ error: `图片尺寸异常（${meta.width}×${meta.height}），请重新截图。` }), { 'Content-Type': 'application/json' });
        if (!req.headers.origin || new URL(req.headers.origin).host !== req.headers.host) return send(res, 403, JSON.stringify({ error: '请求来源校验失败。' }), { 'Content-Type': 'application/json' });
        const id = crypto.randomBytes(5).toString('hex');
        const run = newRun(id);
        busy = id;
        fs.writeFileSync(path.join(run.dir, 'upload.png'), await sharp(bytes).png().toBuffer());
        run.phase = 'analyze';
        pipeline(run, bytes).catch(() => {});
        return send(res, 200, JSON.stringify({ id }), { 'Content-Type': 'application/json' });
      });
      bb.on('error', () => { if (!handled) { handled = true; send(res, 400, JSON.stringify({ error: '上传失败，请重试。' }), { 'Content-Type': 'application/json' }); } });
      bb.on('finish', () => { if (!handled) { handled = true; send(res, 400, JSON.stringify({ error: '没有收到截图文件。' }), { 'Content-Type': 'application/json' }); } });
      return req.pipe(bb);
    }
    if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'runs' && parts[2]) {
      const run = runs.get(parts[2]);
      if (!run) return send(res, 404, JSON.stringify({ error: '找不到这次生成记录。' }), { 'Content-Type': 'application/json' });
      if (parts.length === 3) return send(res, 200, JSON.stringify(runSnapshot(run)), { 'Content-Type': 'application/json' });
      const rest = parts.slice(3).join('/');
      if (rest === 'zip') {
        const files = [];
        for (const name of ['shop.html', 'plan.json', 'result.json']) {
          const f = path.join(run.dir, name);
          if (fs.existsSync(f)) files.push({ name, data: fs.readFileSync(f) });
        }
        const assetsDir = path.join(run.dir, 'assets');
        if (fs.existsSync(assetsDir)) {
          for (const rel of fs.readdirSync(assetsDir)) files.push({ name: `assets/${rel}`, data: fs.readFileSync(path.join(assetsDir, rel)) });
        }
        for (let i = 1; i <= 6; i++) {
          const f = path.join(run.dir, `product-${i}.png`);
          if (fs.existsSync(f)) files.push({ name: `products/product-${i}.png`, data: fs.readFileSync(f) });
        }
        const summary = [
          `店铺装修方案 · ${run.result?.design?.title || ''}`, '',
          `设计说明：${run.result?.design?.summary || ''}`, '',
          '模块清单（自上而下）：',
          ...(run.result?.modules || []).map((m, i) => `${i + 1}. ${m.label}（${m.type}）—— ${m.reason || '未说明'}`), '',
          '素材对照：',
          ...(run.result?.slotMap || []).filter(s => s.file).map(s => `${s.moduleLabel} 槽位${s.slot} → ${s.file}${s.status === 'substituted' ? '（替代素材）' : ''}`), '',
          ...(run.degradations.length ? ['降级说明：', ...run.degradations.map(d => `- ${d}`)] : []),
        ].join('\n');
        files.push({ name: '方案说明.txt', data: Buffer.from(summary, 'utf8') });
        return send(res, 200, makeZip(files), { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`装修素材-${run.id}.zip`)}` });
      }
      const file = path.resolve(run.dir, rest);
      if (!file.startsWith(run.dir + path.sep) && file !== run.dir) return send(res, 403, 'forbidden');
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'not found');
      const ext = path.extname(file).toLowerCase();
      const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.html': 'text/html; charset=utf-8', '.json': 'application/json' };
      const download = url.searchParams.has('download') ? path.basename(file) : '';
      return sendFile(res, file, types[ext] || 'application/octet-stream', download);
    }
    send(res, 404, 'not found');
  } catch (error) {
    send(res, 500, JSON.stringify({ error: error.message || '服务内部错误。' }), { 'Content-Type': 'application/json' });
  }
});

if (!process.env.ARK_API_KEY) {
  console.error('缺少 ARK_API_KEY：请在 .env.local 中配置后再启动。');
  process.exit(1);
}
server.listen(PORT, '127.0.0.1', () => {
  console.log(`AI 装修决策 Demo http://127.0.0.1:${PORT}`);
  console.log(`视觉 ${process.env.ARK_VISION_MODEL} · 生图 ${process.env.ARK_IMAGE_MODEL}`);
  console.log(`决策目录 ${CATALOG.length} 类（近方形槽位子集）`);
});

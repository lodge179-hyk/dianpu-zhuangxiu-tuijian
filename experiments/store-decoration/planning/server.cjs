const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { compose } = require('./compose.cjs');
const { cropBatch } = require('./crop.cjs');
const { validatePlan } = require('./plan.cjs');
const { createExample } = require('./example.cjs');
const { navigationExamplePlan } = require('./navigation-example.cjs');
const { assetFile, publicNavigationLibrary } = require('./navigation-library.cjs');
const { materialsZip, shopPng, attachmentHeader } = require('./download.cjs');
const { plannerPrompt, structurePrompt, planScreenshot, publicCatalog } = require('./planner.cjs');
const { validateBrief, manualBrief, exampleBrief, briefFromPlan, recommendPlan } = require('./structure.cjs');
const { fillStructureExample } = require('./structure-example.cjs');
let port = Number(process.env.PLANNER_PORT || 5182);
const root = path.resolve(process.env.PLANNER_OUTPUT_DIR || path.join(__dirname, 'output/runs'));
fs.mkdirSync(root, { recursive: true });
const locks = new Set(); let planning = false;
const json = (res, code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
const folderFor = id => { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('任务编号无效'); return path.join(root, id); };
const save = (folder, state) => fs.writeFileSync(path.join(folder, 'state.json'), JSON.stringify(state, null, 2));
const load = id => JSON.parse(fs.readFileSync(path.join(folderFor(id), 'state.json'), 'utf8'));
function makeRun(source) {
  const id = randomUUID(), folder = folderFor(id); fs.mkdirSync(folder);
  const state = { id, source, status: 'planning', createdAt: new Date().toISOString(), filledAssets: [], importedBatches: [], imageGenerationCallsByThisTool: 0, planningRequestAttempts: 0 };
  save(folder, state); return { id, folder, state };
}
function finish(run, compiled) {
  const auditPath = path.join(run.folder, 'planner-call.json');
  if (fs.existsSync(auditPath)) run.state.planningRequestAttempts = JSON.parse(fs.readFileSync(auditPath, 'utf8')).requestAttempts;
  run.state.filledAssets = [...new Set([...run.state.filledAssets, ...(compiled.libraryAssetIds || [])])];
  Object.assign(run.state, compiled, { status: 'ready', preview: `/runs/${run.id}/shop.html` });
  fs.writeFileSync(path.join(run.folder, 'plan.json'), JSON.stringify(compiled.plan, null, 2));
  save(run.folder, run.state); return run.state;
}
function finishRecommendation(run, brief, exampleId) {
  const { plan, recommendation } = recommendPlan(brief);
  run.state.recommendation = recommendation;
  const reused = fillStructureExample(run.folder, { exampleId }, plan);
  run.state.filledAssets = reused; run.state.reusedExampleAssets = reused;
  return finish(run, compose(run.folder, plan));
}
async function body(req, max) {
  if (Number(req.headers['content-length']) > max) { req.resume(); throw new Error(`上传内容超过${Math.round(max / 1024 / 1024)}MB限制`); }
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > max) throw new Error('上传文件过大'); chunks.push(chunk); }
  if (!size) throw new Error('上传内容为空'); return Buffer.concat(chunks);
}
function imageType(req) { if (!/^image\/(png|jpeg|webp)(?:;|$)/i.test(req.headers['content-type'] || '')) throw new Error('仅支持PNG、JPG或WebP图片'); }
function safeError(error) {
  let text = error instanceof Error ? error.message : '操作未完成';
  if (process.env.ARK_API_KEY) text = text.replaceAll(process.env.ARK_API_KEY, '[已隐藏]');
  return text.slice(0, 600);
}
// A stopped planning request is never presented as still running after a restart.
for (const id of fs.readdirSync(root)) {
  if (!/^[a-f0-9-]{36}$/.test(id)) continue;
  try { const state = load(id); if (state.status === 'planning') { state.status = 'failed'; state.error = '上次规划被服务停止中断，结果与计费未确认；没有自动重新调用。'; const auditFile = path.join(folderFor(id), 'planner-call.json'); if (fs.existsSync(auditFile)) state.planningRequestAttempts = JSON.parse(fs.readFileSync(auditFile, 'utf8')).requestAttempts; save(folderFor(id), state); } } catch {}
}
const server = http.createServer(async (req, res) => {
  try {
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) return json(res, 403, { error: '仅支持本机访问' });
    if (req.method === 'POST' && req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return json(res, 403, { error: '来源不允许' });
    const url = new URL(req.url, `http://127.0.0.1:${port}`), pathname = decodeURIComponent(url.pathname);
    if (req.method === 'GET' && pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(fs.readFileSync(path.join(__dirname, 'index.html'))); }
    if (req.method === 'GET' && pathname === '/api/config') return json(res, 200, { plannerConfigured: !!(process.env.ARK_API_KEY && process.env.ARK_VISION_MODEL && process.env.ARK_RESPONSES_ENDPOINT), maxUploadMB: 30, maxGenerationBatches: 2 });
    if (req.method === 'GET' && pathname === '/api/catalog') return json(res, 200, publicCatalog());
    if (req.method === 'GET' && pathname === '/api/navigation-library') return json(res, 200, publicNavigationLibrary());
    const libraryFile = pathname.match(/^\/navigation-assets\/([a-z0-9-]+)\.png$/);
    if (req.method === 'GET' && libraryFile) {
      const file = assetFile(libraryFile[1]);
      if (!file || !fs.existsSync(file)) return json(res, 404, { error: '导航素材不存在' });
      res.writeHead(200, { 'Content-Type': 'image/png', 'X-Content-Type-Options': 'nosniff' });
      return fs.createReadStream(file).pipe(res);
    }
    if (req.method === 'GET' && pathname === '/api/planner-prompt') return json(res, 200, { prompt: plannerPrompt() });
    if (req.method === 'GET' && pathname === '/api/structure-prompt') return json(res, 200, { prompt: structurePrompt() });
    if (req.method === 'POST' && ['/api/recommendation', '/api/recommendation-example'].includes(pathname)) {
      const request = JSON.parse((await body(req, 64 * 1024)).toString('utf8'));
      const sample = pathname === '/api/recommendation-example';
      const brief = sample ? exampleBrief(request.example) : request.brief ? validateBrief(request.brief) : manualBrief(request);
      const run = makeRun(sample ? 'recommendation-example' : 'recommendation-brief');
      return json(res, 201, finishRecommendation(run, brief, sample ? request.example : undefined));
    }
    const restructureMatch = pathname.match(/^\/api\/runs\/([a-f0-9-]{36})\/recommendation$/);
    if (req.method === 'POST' && restructureMatch) {
      const original = load(restructureMatch[1]);
      if (!original.plan && !original.structure) throw Error('请先完成店铺资料分析');
      const brief = original.recommendation?.brief || original.structure?.brief || briefFromPlan(original.plan);
      const run = makeRun('recommendation-from-run'); run.state.sourceRunId = original.id;
      return json(res, 201, finishRecommendation(run, brief));
    }
    if (req.method === 'POST' && pathname === '/api/navigation-example') {
      const request = JSON.parse((await body(req, 4096)).toString('utf8'));
      const plan = navigationExamplePlan(request.style);
      const run = makeRun('navigation-example');
      return json(res, 201, finish(run, compose(run.folder, plan)));
    }
    if (req.method === 'POST' && pathname === '/api/example') {
      const run = makeRun('saved-example'), compiled = createExample(run.folder);
      run.state.filledAssets = compiled.plan.assets.map(a => a.id);
      return json(res, 201, finish(run, compiled));
    }
    if (req.method === 'POST' && pathname === '/api/import-plan') {
      const input = JSON.parse((await body(req, 512 * 1024)).toString('utf8'));
      const { plan } = validatePlan({ ...input, navigationLibrary: input.navigationLibrary || { style: 'auto' } });
      const run = makeRun('external-ai-plan');
      return json(res, 201, finish(run, compose(run.folder, plan)));
    }
    if (req.method === 'POST' && ['/api/plan', '/api/legacy-plan'].includes(pathname)) {
      if (planning) return json(res, 409, { error: '已有一个截图正在规划，请等待完成，避免重复调用。' });
      const structureMode = pathname === '/api/plan';
      imageType(req); planning = true;
      let bytes;
      try { bytes = await body(req, 30 * 1024 * 1024); } catch (error) { planning = false; throw error; }
      const run = makeRun(structureMode ? 'recommendation-screenshot' : 'screenshot');
      json(res, 202, run.state);
      void planScreenshot(bytes, run.folder, { structure: structureMode }).then(result => structureMode ? finishRecommendation(run, result.brief) : finish(run, compose(run.folder, { ...result.plan, navigationLibrary: result.plan.navigationLibrary || { style: 'auto' } }))).catch(error => { run.state.status = 'failed'; run.state.error = safeError(error); const auditPath = path.join(run.folder, 'planner-call.json'); if (fs.existsSync(auditPath)) run.state.planningRequestAttempts = JSON.parse(fs.readFileSync(auditPath, 'utf8')).requestAttempts; save(run.folder, run.state); }).finally(() => { planning = false; });
      return;
    }
    const runMatch = pathname.match(/^\/api\/runs\/([a-f0-9-]{36})$/);
    if (req.method === 'GET' && runMatch) return json(res, 200, load(runMatch[1]));
    const downloadMatch = pathname.match(/^\/api\/runs\/([a-f0-9-]{36})\/download\/(shop\.png|materials\.zip)$/);
    if (['GET', 'POST'].includes(req.method) && downloadMatch) {
      const [, id, filename] = downloadMatch;
      if (locks.has(id)) return json(res, 409, { error: '当前方案正在填入素材或准备下载，请稍后再试。' });
      if (!fs.existsSync(path.join(folderFor(id), 'state.json'))) return json(res, 404, { error: '装修方案不存在' });
      locks.add(id);
      try {
        const state = load(id), png = filename === 'shop.png';
        const bytes = await (png ? shopPng(folderFor(id), state) : materialsZip(folderFor(id), state));
        if (req.method === 'POST') {
          const exportFolder = path.join(folderFor(id), 'downloads');
          fs.mkdirSync(exportFolder, { recursive: true });
          // Only two current exports per run; each click rebuilds from the current materials.
          fs.writeFileSync(path.join(exportFolder, filename), bytes);
          return json(res, 200, { url: `/runs/${id}/downloads/${filename}?v=${randomUUID()}`, bytes: bytes.length });
        }
        res.writeHead(200, { 'Content-Type': png ? 'image/png' : 'application/zip', 'Content-Disposition': attachmentHeader(state, png ? 'png' : 'zip'), 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end(bytes);
      } finally { locks.delete(id); }
    }
    const preparedDownload = pathname.match(/^\/runs\/([a-f0-9-]{36})\/downloads\/(shop\.png|materials\.zip)$/);
    if (req.method === 'GET' && preparedDownload) {
      const [, id, filename] = preparedDownload, file = path.join(folderFor(id), 'downloads', filename);
      if (!fs.existsSync(file)) return json(res, 404, { error: '下载文件不存在，请重新点击下载。' });
      const bytes = fs.readFileSync(file), png = filename === 'shop.png';
      res.writeHead(200, { 'Content-Type': png ? 'image/png' : 'application/zip', 'Content-Disposition': attachmentHeader(load(id), png ? 'png' : 'zip'), 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(bytes);
    }
    const uploadMatch = pathname.match(/^\/api\/runs\/([a-f0-9-]{36})\/batches\/([a-z][a-z0-9_-]{0,39})$/);
    if (req.method === 'POST' && uploadMatch) {
      const [, id, batchId] = uploadMatch;
      if (locks.has(id)) return json(res, 409, { error: '当前方案正在填入素材或准备下载，请稍后再试。' });
      imageType(req); locks.add(id);
      try {
        const state = load(id); if (state.status !== 'ready') throw new Error('请先完成装修方案');
        const compiledBatch = state.batches.find(batch => batch.id === batchId);
        if (!compiledBatch) throw new Error('此批次无需生图或不存在，请使用当前方案显示的批次');
        const bytes = await body(req, 30 * 1024 * 1024), folder = folderFor(id);
        const report = await cropBatch(bytes, state.plan, batchId, folder, compiledBatch);
        state.filledAssets = [...new Set([...state.filledAssets, ...report.crops.map(c => c.assetId)])];
        state.importedBatches = [...new Set([...state.importedBatches, batchId])];
        state.cropReports = { ...(state.cropReports || {}), [batchId]: report };
        return json(res, 200, finish({ id, folder, state }, compose(folder, state.plan)));
      } finally { locks.delete(id); }
    }
    const fileMatch = pathname.match(/^\/runs\/([a-f0-9-]{36})\/(shop\.html|input\.jpg|plan\.json|generation-batches\.json|[a-z][a-z0-9_-]*-(?:prompt\.txt|source\.png|crop-report\.json)|assets\/[a-z][a-z0-9_-]*\.png)$/);
    if (req.method === 'GET' && fileMatch) {
      const file = path.join(folderFor(fileMatch[1]), fileMatch[2]);
      if (!fs.existsSync(file)) return json(res, 404, { error: '文件不存在' });
      const type = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8' }[path.extname(file)];
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'self'" });
      return fs.createReadStream(file).pipe(res);
    }
    return json(res, 404, { error: '入口不存在' });
  } catch (error) { if (!res.headersSent) json(res, 400, { error: safeError(error) }); else res.end(); }
});
server.listen(port, '127.0.0.1', () => { port = server.address().port; console.log(`装修规划实验：http://127.0.0.1:${port}`); });
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? '端口已被占用，请用PLANNER_PORT指定其他端口。' : '服务启动失败：' + error.code); process.exitCode = 1; });

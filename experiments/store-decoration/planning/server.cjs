const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { compose } = require('./compose.cjs');
const { cropBatch } = require('./crop.cjs');
const { validatePlan } = require('./plan.cjs');
const { createExample } = require('./example.cjs');
const { plannerPrompt, planScreenshot, publicCatalog } = require('./planner.cjs');
const port = Number(process.env.PLANNER_PORT || 5182);
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
  Object.assign(run.state, compiled, { status: 'ready', preview: `/runs/${run.id}/shop.html` });
  fs.writeFileSync(path.join(run.folder, 'plan.json'), JSON.stringify(compiled.plan, null, 2));
  save(run.folder, run.state); return run.state;
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
  try { const state = load(id); if (state.status === 'planning') { state.status = 'failed'; state.error = '上次规划被服务重启中断，结果未确认；没有自动重新调用。'; save(folderFor(id), state); } } catch {}
}
const server = http.createServer(async (req, res) => {
  try {
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) return json(res, 403, { error: '仅支持本机访问' });
    if (req.method === 'POST' && req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return json(res, 403, { error: '来源不允许' });
    const url = new URL(req.url, `http://127.0.0.1:${port}`), pathname = decodeURIComponent(url.pathname);
    if (req.method === 'GET' && pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(fs.readFileSync(path.join(__dirname, 'index.html'))); }
    if (req.method === 'GET' && pathname === '/api/config') return json(res, 200, { plannerConfigured: !!(process.env.ARK_API_KEY && process.env.ARK_VISION_MODEL && process.env.ARK_RESPONSES_ENDPOINT), maxUploadMB: 30, maxGenerationBatches: 2 });
    if (req.method === 'GET' && pathname === '/api/catalog') return json(res, 200, publicCatalog());
    if (req.method === 'GET' && pathname === '/api/planner-prompt') return json(res, 200, { prompt: plannerPrompt() });
    if (req.method === 'POST' && pathname === '/api/example') {
      const run = makeRun('saved-example'), compiled = createExample(run.folder);
      run.state.filledAssets = compiled.plan.assets.map(a => a.id);
      return json(res, 201, finish(run, compiled));
    }
    if (req.method === 'POST' && pathname === '/api/import-plan') {
      const { plan } = validatePlan(JSON.parse((await body(req, 512 * 1024)).toString('utf8')));
      const run = makeRun('external-ai-plan');
      return json(res, 201, finish(run, compose(run.folder, plan)));
    }
    if (req.method === 'POST' && pathname === '/api/plan') {
      if (planning) return json(res, 409, { error: '已有一个截图正在规划，请等待完成，避免重复调用。' });
      imageType(req); planning = true;
      let bytes;
      try { bytes = await body(req, 30 * 1024 * 1024); } catch (error) { planning = false; throw error; }
      const run = makeRun('screenshot');
      json(res, 202, run.state);
      void planScreenshot(bytes, run.folder).then(({ plan }) => finish(run, compose(run.folder, plan))).catch(error => { run.state.status = 'failed'; run.state.error = safeError(error); const auditPath = path.join(run.folder, 'planner-call.json'); if (fs.existsSync(auditPath)) run.state.planningRequestAttempts = JSON.parse(fs.readFileSync(auditPath, 'utf8')).requestAttempts; save(run.folder, run.state); }).finally(() => { planning = false; });
      return;
    }
    const runMatch = pathname.match(/^\/api\/runs\/([a-f0-9-]{36})$/);
    if (req.method === 'GET' && runMatch) return json(res, 200, load(runMatch[1]));
    const uploadMatch = pathname.match(/^\/api\/runs\/([a-f0-9-]{36})\/batches\/([a-z][a-z0-9_-]{0,39})$/);
    if (req.method === 'POST' && uploadMatch) {
      const [, id, batchId] = uploadMatch;
      if (locks.has(id)) return json(res, 409, { error: '当前方案正在填入素材，请稍后再试。' });
      imageType(req); locks.add(id);
      try {
        const state = load(id); if (state.status !== 'ready') throw new Error('请先完成装修方案');
        const bytes = await body(req, 30 * 1024 * 1024), folder = folderFor(id);
        const report = await cropBatch(bytes, state.plan, batchId, folder);
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
server.listen(port, '127.0.0.1', () => console.log(`装修规划实验：http://127.0.0.1:${port}`));
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? '端口已被占用，请用PLANNER_PORT指定其他端口。' : '服务启动失败：' + error.code); process.exitCode = 1; });

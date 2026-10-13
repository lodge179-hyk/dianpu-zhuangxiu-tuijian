/**
 * 本地服务：单进程单端口。界面、接口、结果与素材下载都由这里提供。
 *
 * 运行：npm start（端口 ASSISTED_PORT，默认 5191）
 *
 * 费用保护：一次任务会真实调用模型（识别 1 次 + 决策 1 次 + 生图 N 次），
 * 因此提交接口要求前端显式带上 confirm=1；未确认的请求会被拒绝，不会产生费用。
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Busboy from 'busboy';
import { CATALOG } from './src/catalog.mjs';
import { createState, envReady, readEnv, runTask, STEPS } from './src/pipeline.mjs';
import { validatePlan } from './src/validate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = readEnv(process.env);
const PORT = env.port;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const RUNS = path.join(here, 'output', 'runs');
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const ALLOW_GENERATE = process.env.ALLOW_GENERATE !== '0';

let busy = false;
let activeId = null;
const validId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
const runDir = id => path.join(RUNS, id);
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));

/**
 * 状态写入串行化。
 * 一个任务里状态会被频繁保存（每步、每次调用前后），并发 rename 到同一个目标文件
 * 在 Windows 上会直接 EPERM 失败。这里按任务排队，保证同一时刻只有一次写入。
 */
const saveQueues = new Map();
function saveState(state) {
  const previous = saveQueues.get(state.id) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      const file = path.join(runDir(state.id), 'run.json');
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(state, null, 2));
      await rename(tmp, file);
    })
    .catch(error => {
      console.error(`状态保存失败（${state.id.slice(0, 8)}）：${error.message}`);
    })
    .finally(() => {
      if (saveQueues.get(state.id) === next) saveQueues.delete(state.id);
    });
  saveQueues.set(state.id, next);
  return next;
}

function safeMessage(error) {
  let message = error instanceof Error ? error.message : '处理未完成，请重新提交。';
  for (const secret of [env.apiKey, process.env.ARK_API_KEY]) if (secret) message = message.split(secret).join('[已隐藏]');
  return String(message).slice(0, 300);
}

const send = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
};

function upload(req, dir) {
  return new Promise((resolve, reject) => {
    let busboy;
    try {
      busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: env.maxUploadBytes } });
    } catch (error) {
      reject(new Error('上传请求格式不正确，请重新选择截图。'));
      return;
    }
    let settled = false;
    let written = 0;
    let stream = null;
    const fail = error => {
      if (settled) return;
      settled = true;
      if (stream) stream.destroy();
      reject(error);
    };
    busboy.on('file', (name, file, info) => {
      const mime = String(info?.mimeType || '').toLowerCase();
      if (!ALLOWED.has(mime)) {
        fail(new Error(`不支持的文件类型（${mime || '未知'}）。请上传 PNG、JPG 或 WebP 截图。`));
        return;
      }
      stream = createWriteStream(path.join(dir, 'source-upload.bin'));
      file.on('data', chunk => { written += chunk.length; });
      file.on('limit', () => fail(new Error(`截图超过 ${Math.round(env.maxUploadBytes / 1024 / 1024)} MB 上限。`)));
      file.pipe(stream);
      stream.on('close', () => {
        if (settled) return;
        settled = true;
        resolve({ bytes: written, mime });
      });
      stream.on('error', error => fail(new Error(`截图写入本地失败：${error.message}`)));
      file.on('error', error => fail(new Error(`截图接收中断：${error.message}`)));
    });
    busboy.on('error', error => fail(new Error(`上传请求解析失败：${error.message}`)));
    busboy.on('close', () => { if (!settled && written === 0) fail(new Error('没有收到截图文件。')); });
    req.pipe(busboy);
  });
}

const ALLOWED_FILES = new Set(['run.json', 'plan.json', 'shop.json', 'manifest.json', 'preview.html', 'screenshot.png']);

const server = createServer(async (req, res) => {
  try {
    const host = req.headers.host || '';
    if (![`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(host)) return send(res, 403, { error: '请通过本机地址访问。' });
    const url = new URL(req.url, ORIGIN);

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(await readFile(path.join(here, 'index.html')));
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
      return send(res, 200, {
        configured: envReady(env),
        model: { vision: env.visionModel, image: env.imageModel },
        busy, activeId,
        allowGenerate: ALLOW_GENERATE,
        maxUploadMB: Math.round(env.maxUploadBytes / 1024 / 1024),
        catalog: { version: CATALOG.version, modules: CATALOG.modules.length, groups: CATALOG.groups },
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/catalog') {
      return send(res, 200, CATALOG);
    }

    if (req.method === 'GET' && url.pathname === '/api/recent') {
      let ids = [];
      try { ids = await readdir(RUNS); } catch { ids = []; }
      const items = [];
      for (const id of ids) {
        if (!validId(id)) continue;
        try {
          const state = await readJson(path.join(runDir(id), 'run.json'));
          items.push({
            id: state.id, status: state.status, stage: state.stage, step: state.step,
            startedAt: state.startedAt, finishedAt: state.finishedAt,
            shopName: state.shop?.shopName || '', hasPreview: !!state.hasPreview,
            designTitle: state.design?.title || '', moduleCount: state.plan?.modules?.length || 0,
            assetCount: (state.assets || []).length, warnings: state.warnings || [], error: state.error || null,
          });
        } catch { /* 跳过不完整记录 */ }
      }
      items.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
      return send(res, 200, items.slice(0, 20));
    }

    const fileMatch = url.pathname.match(/^\/runs\/([a-f0-9-]{36})\/([A-Za-z0-9._-]+)$/);
    if (req.method === 'GET' && fileMatch) {
      const [, id, name] = fileMatch;
      if (!ALLOWED_FILES.has(name)) return send(res, 404, { error: '没有找到该内容。' });
      const file = path.join(runDir(id), name);
      let info;
      try { info = await stat(file); } catch { return send(res, 404, { error: '这条记录里还没有这个文件。' }); }
      const type = name.endsWith('.png') ? 'image/png' : name.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8';
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return createReadStream(file).pipe(res);
    }

    const assetMatch = url.pathname.match(/^\/runs\/([a-f0-9-]{36})\/assets\/([A-Za-z0-9._-]+)$/);
    if (req.method === 'GET' && assetMatch) {
      const [, id, name] = assetMatch;
      const file = path.join(runDir(id), 'assets', name);
      let info;
      try { info = await stat(file); } catch { return send(res, 404, { error: '没有这张素材。' }); }
      res.writeHead(200, {
        'Content-Type': 'image/png', 'Content-Length': info.size, 'Cache-Control': 'no-store',
        ...(url.searchParams.has('download') ? { 'Content-Disposition': `attachment; filename="${name}"` } : {}),
      });
      return createReadStream(file).pipe(res);
    }

    if (req.method === 'GET' && url.pathname.startsWith('/runs/') && url.pathname.endsWith('/preview')) {
      const id = url.pathname.split('/')[2];
      if (!validId(id)) return send(res, 400, { error: '记录 ID 无效。' });
      res.writeHead(302, { Location: `/runs/${id}/preview.html` });
      return res.end();
    }

    if (req.method === 'POST' && url.pathname === '/api/generate') {
      if (![ORIGIN, `http://localhost:${PORT}`].includes(req.headers.origin || '')) return send(res, 403, { error: '请求来源无效。' });
      if (!ALLOW_GENERATE) return send(res, 503, { error: '当前服务以只读方式启动（ALLOW_GENERATE=0），不会调用模型。' });
      if (!envReady(env)) {
        return send(res, 503, {
          error: '模型配置不完整，无法执行设计决策与生图。',
          hint: '需要 ARK_API_KEY、ARK_RESPONSES_ENDPOINT、ARK_VISION_MODEL、ARK_IMAGE_ENDPOINT、ARK_IMAGE_MODEL。',
        });
      }
      const confirmed = String(url.searchParams.get('confirm') || '') === '1';
      if (!confirmed) {
        return send(res, 428, {
          error: '这次任务会真实调用模型（识别 1 次 + 决策 1 次 + 生图 1 次起），需要你确认后才会执行。',
          hint: '在界面勾选「我确认本次会调用模型」再提交。',
        });
      }
      if (busy) return send(res, 409, { error: '上一份方案还在生成，请等它结束后再提交。', activeId });
      busy = true;
      activeId = null;
      let pendingId = null;
      try {
        const id = randomUUID();
        pendingId = id;
        await mkdir(runDir(id), { recursive: true });
        await upload(req, runDir(id));
        const state = createState(id);
        await saveState(state);
        activeId = id;
        pendingId = null;
        send(res, 202, { id, steps: STEPS });
        const screenshotBytes = await readFile(path.join(runDir(id), 'source-upload.bin'));
        void runTask({ state, screenshotBytes, dir: runDir(id), env, save: saveState, log: msg => console.log(`[${id.slice(0, 8)}] ${msg}`) })
          .catch(error => console.error('任务状态保存失败：', safeMessage(error)))
          .finally(() => { busy = false; activeId = null; });
        return;
      } catch (error) {
        busy = false;
        activeId = null;
        if (pendingId) await rm(runDir(pendingId), { recursive: true, force: true }).catch(() => {});
        if (!res.headersSent) return send(res, 400, { error: safeMessage(error) });
        return;
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/preview-plan') {
      if (![ORIGIN, `http://localhost:${PORT}`].includes(req.headers.origin || '')) return send(res, 403, { error: '请求来源无效。' });
      const chunks = [];
      let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 512 * 1024) return send(res, 400, { error: '内容过长。' }); chunks.push(chunk); }
      let plan;
      try { plan = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 400, { error: '计划不是合法 JSON。' }); }
      const { normalizePlan } = await import('./src/plan.mjs');
      const normalized = normalizePlan(plan, {});
      const check = validatePlan(normalized);
      return send(res, 200, { validation: check, plan: normalized });
    }

    return send(res, 404, { error: '没有找到该内容。' });
  } catch (error) {
    console.error('请求处理失败：', safeMessage(error));
    if (!res.headersSent) send(res, 500, { error: safeMessage(error) });
    else res.end();
  }
});

await mkdir(RUNS, { recursive: true });
server.requestTimeout = 600_000;
server.headersTimeout = 60_000;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`AI 店铺装修设计 Demo：${ORIGIN}`);
  console.log(`模型配置：${envReady(env) ? '完整' : '不完整（界面会提示）'}· 可选模块 ${CATALOG.modules.length} 种 · 生图开关 ${ALLOW_GENERATE ? '开' : '关'}`);
});

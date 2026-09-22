import { needsRecovery, recoverInterruptedTask } from "./recovery";
import { validateInputMetadata, validateImageBytes, uploadLimits } from "./input-validation";
import { currentLayoutVersion } from "../lib/module-layout";
import { summarizeTasks } from "./metrics";
import http from "node:http";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat, readFile } from "node:fs/promises";
import path from "node:path";
import Busboy from "busboy";
import { taskSchema, canSelectPlan, hasLegalStructure, type MvpTask } from "../lib/mvp-contract";
import { assetRoot, createTask, initializeStore, listTasks, readTask, updateTask, uploadRoot } from "./task-store";
import { enqueue, pause, regenerateAsset, replaceAsset, restoreAsset, resume } from "./queue";

const port = Number(process.env.MVP_SERVICE_PORT ?? 5174);
const allowedOrigins = new Set((process.env.MVP_ALLOWED_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173").split(",").map((value) => value.trim()));
class HttpError extends Error { constructor(public statusCode: number, message: string) { super(message); } }
const json = (response: http.ServerResponse, status: number, value: unknown) => { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); response.end(JSON.stringify(value)); };
const body = async (request: http.IncomingMessage) => { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); return JSON.parse(Buffer.concat(chunks).toString("utf8")); };
const revisionOf = (request: http.IncomingMessage, value?: unknown) => { const header = request.headers["if-match"]; const candidate = header ?? (value && typeof value === "object" ? (value as { revision?: unknown }).revision : undefined); const revision = Number(candidate); if (!Number.isInteger(revision) || revision < 0) throw new HttpError(400, "修改任务必须携带当前 revision"); return revision; };
const safeName = (name: string) => `${crypto.randomUUID()}${path.extname(name).toLowerCase().slice(0, 8)}`;


async function parseUpload(request: http.IncomingMessage) {
  const taskId = crypto.randomUUID(); const directory = path.join(uploadRoot, taskId); await mkdir(directory, { recursive: true });
  return new Promise<MvpTask>((resolve, reject) => {
    const parser = Busboy({ headers: request.headers, limits: { files: uploadLimits.files, fileSize: uploadLimits.fileBytes, fields: 1, fieldSize: 128 * 1024 } });
    let metadata = ""; let total = 0; const writes: Promise<void>[] = []; const fileMap = new Map<string, string>(); let failed: Error | undefined;
    parser.on("field", (name, value) => { if (name === "metadata") metadata = value; });
    parser.on("file", (name, stream, info) => {
      if (!/^image\/(jpeg|png|webp)$/.test(info.mimeType)) { failed = new HttpError(400, "只支持 JPG、PNG 或 WebP 图片"); stream.resume(); return; }
      if(fileMap.has(name)) failed = new HttpError(400,"重复上传字段"); const filename = safeName(info.filename); fileMap.set(name, filename); const target = createWriteStream(path.join(directory, filename), { flags: "wx" });
      stream.on("data", (chunk) => { total += chunk.length; if (total > 100 * 1024 * 1024) { failed = new HttpError(413, "单个任务图片总量不能超过100 MB"); stream.unpipe(target); target.destroy(); stream.resume(); } });
      stream.on("limit", () => { failed = new HttpError(413, "单张图片不能超过8 MB"); });
      writes.push(new Promise((done, fail) => { target.on("finish", done); target.on("error", fail); stream.pipe(target); }));
    });
    parser.on("filesLimit",()=>{failed=new HttpError(413,"图片数超过27张");});
    parser.on("fieldsLimit",()=>{failed=new HttpError(400,"只能提供一个metadata字段");});
    parser.on("error", reject);
    parser.on("finish", async () => { try { await Promise.all(writes); if (failed) throw failed; const supplied = JSON.parse(metadata); const input = validateInputMetadata(supplied); const imageKeys = input.products?.flatMap((product) => product.images ?? []) ?? []; const styleKeys = input.styleReferences ?? []; if ([...imageKeys, ...styleKeys].some((key) => !fileMap.has(key))) throw new HttpError(400, "图片元数据与实际上传文件不一致"); if (new Set(input.products.map(product => product.id)).size !== input.products.length) throw new HttpError(400, "商品 ID 必须唯一"); if(fileMap.size!==imageKeys.length+styleKeys.length) throw new HttpError(400,"存在未声明的上传图片"); for(const filename of fileMap.values()) await validateImageBytes(await readFile(path.join(directory,filename))); const now = new Date().toISOString(); const task = taskSchema.parse({ ...input, id: taskId, revision: 0, createdAt: now, updatedAt: now, status: "draft", batchId:supplied.batchId, testPurpose:supplied.testPurpose, budgetCny:supplied.budgetCny, batchBudgetCny:supplied.batchBudgetCny, clientRequestId:request.headers["idempotency-key"], layoutVersion:currentLayoutVersion, progress: 0, productAnalyses: [], plans: [], assets: [], modelCalls: [], products: input.products.map((product) => ({ ...product, images: product.images.map((key) => fileMap.get(key)!) })), styleReferences: styleKeys.map((key) => fileMap.get(key)!) }); resolve(task); } catch (error) { reject(error); } });
    request.pipe(parser);
  }).catch(async (error) => { await rm(directory, { recursive: true, force: true }); throw error; });
}

async function parseSingleImage(request: http.IncomingMessage) { return new Promise<Buffer>((resolve, reject) => { const parser = Busboy({ headers: request.headers, limits: { files: 1, fileSize: 8 * 1024 * 1024 } }); const chunks: Buffer[] = []; let found = false; let failure: Error | undefined; parser.on("file", (_name, stream, info) => { found = true; if (!/^image\/(jpeg|png|webp)$/.test(info.mimeType)) failure = new HttpError(400, "只支持 JPG、PNG 或 WebP 图片"); stream.on("data", (chunk) => chunks.push(Buffer.from(chunk))); stream.on("limit", () => { failure = new HttpError(413, "单张图片不能超过8 MB"); }); }); parser.on("error", reject); parser.on("finish", () => failure ? reject(failure) : found ? resolve(Buffer.concat(chunks)) : reject(new HttpError(400, "没有收到替换图片"))); request.pipe(parser); }); }

async function serveAsset(response: http.ServerResponse, assetId: string, versionText: string) {
  if (!/^[\w-]+$/.test(assetId) || !/^\d+$/.test(versionText)) throw new HttpError(400, "素材地址无效");
  const directory = path.join(assetRoot, assetId); const candidates = [".jpg", ".jpeg", ".png", ".webp"].map((extension) => path.join(directory, `${versionText}${extension}`));
  for (const candidate of candidates) try { await stat(candidate); const type = candidate.endsWith("png") ? "image/png" : candidate.endsWith("webp") ? "image/webp" : "image/jpeg"; response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }); createReadStream(candidate).pipe(response); return; } catch {}
  throw new HttpError(404, "素材不存在");
}

const creating = new Map<string,Promise<MvpTask>>();
const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin; if (origin && allowedOrigins.has(origin)) { response.setHeader("Access-Control-Allow-Origin", origin); response.setHeader("Vary", "Origin"); }
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, If-Match"); response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
  if (origin && !allowedOrigins.has(origin)) { json(response, 403, { error: "该页面来源不允许访问本地任务服务" }); return; }
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`); const parts = url.pathname.split("/").filter(Boolean);
    if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true, models: { analysis: Boolean(process.env.ARK_API_KEY && process.env.ARK_VISION_MODEL && process.env.ARK_RESPONSES_ENDPOINT), generation: Boolean(process.env.ARK_API_KEY && process.env.ARK_IMAGE_MODEL && process.env.ARK_IMAGE_ENDPOINT), qualityCheck: Boolean(process.env.ARK_API_KEY && process.env.ARK_VISION_MODEL && process.env.ARK_RESPONSES_ENDPOINT) } });
    if (request.method === "GET" && url.pathname === "/metrics") return json(response, 200, summarizeTasks(await listTasks(), url.searchParams.get("batchId") ?? undefined));
    if (request.method === "POST" && url.pathname === "/tasks") {
      const key=request.headers["idempotency-key"]; if(key && (typeof key!=="string"||key.length>200)) throw new HttpError(400,"无效幂等标记");
      if(key) { const existing=(await listTasks()).find(task=>task.clientRequestId===key); if(existing){request.resume();return json(response,200,existing);} const pending=creating.get(key); if(pending){request.resume();return json(response,200,await pending);} }
      const create=parseUpload(request).then(createTask); if(key)creating.set(key,create);
      try{return json(response,201,await create);}finally{if(key)creating.delete(key);}
    }
    if (request.method === "GET" && url.pathname === "/tasks") return json(response, 200, { tasks: await listTasks() });
    if (request.method === "GET" && parts[0] === "tasks" && parts.length === 2) return json(response, 200, await readTask(parts[1]));
    if (request.method === "POST" && parts[0] === "tasks" && parts.length === 3 && ["run","pause","resume"].includes(parts[2])) {
      const id = parts[1]; const action = parts[2]; const value = await body(request).catch(() => ({}));
      if (action === "run") { await enqueue(id, revisionOf(request, value)); return json(response, 202, await readTask(id)); }
      if (action === "pause") return json(response, 200, await pause(id, revisionOf(request, value)));
      if (action === "resume") return json(response, 202, await resume(id, revisionOf(request, value)));
    }
    if (request.method === "POST" && parts[0] === "tasks" && parts[2] === "review" && parts.length === 3) { const value=await body(request) as {verdict?:string;note?:string}; if(value.verdict!=="decline") throw new HttpError(400,"仅接受不采用评价；采用请通过方案选择"); return json(response,200,await updateTask(parts[1],task=>task,revisionOf(request,value),{verdict:"decline",note:typeof value.note==="string"?value.note.slice(0,500):undefined})); }
    if (request.method === "GET" && parts[0] === "tasks" && parts[2] === "sources" && parts.length === 4) { const task=await readTask(parts[1]); const filename=decodeURIComponent(parts[3]); if(!task.products.flatMap(p=>p.images).includes(filename)) throw new HttpError(404,"原图不存在"); response.setHeader("Content-Type",path.extname(filename)===".png"?"image/png":path.extname(filename)===".webp"?"image/webp":"image/jpeg"); createReadStream(path.join(uploadRoot,task.id,filename)).pipe(response); return; }
    if (request.method === "PATCH" && parts[0] === "tasks" && parts[2] === "result") { const value = await body(request); const revision = revisionOf(request, value); const updated = await updateTask(parts[1], (task) => { const selectedPlanId = typeof value.selectedPlanId === "string" ? value.selectedPlanId : task.selectedPlanId; if (selectedPlanId && !canSelectPlan(task, selectedPlanId)) throw new HttpError(409, "该方案仍有未通过素材，暂时不能选择"); const copy = typeof value.copy === "object" && value.copy ? value.copy as Record<string, string> : {}; const plans = task.plans.map((plan) => ({ ...plan, shopSign: { ...plan.shopSign, title: copy[plan.shopSign.id] ?? plan.shopSign.title }, modules: plan.modules.map((module) => ({ ...module, title: copy[module.id] ?? module.title })) })); return { ...task, selectedPlanId, plans }; }, revision); return json(response, 200, updated); }
    if (request.method === "POST" && parts[0] === "tasks" && parts[2] === "assets" && parts.length === 5) { const [,,, assetId, action] = parts; const revision = revisionOf(request); if (action === "replace") return json(response, 200, await replaceAsset(parts[1], assetId, revision, await parseSingleImage(request))); const value = await body(request).catch(() => ({})); if (action === "approve") { const updated = await updateTask(parts[1], (task) => ({ ...task, assets: task.assets.map((asset) => asset.id === assetId && asset.verdict === "risk" ? { ...asset, approvedRisk: true, manuallyRejected: false, error: undefined } : asset) }), revision); return json(response, 200, updated); } if (action === "reject") { const updated = await updateTask(parts[1], (task) => ({ ...task, status: "partial_failed", assets: task.assets.map((asset) => asset.id === assetId ? { ...asset, status: "failed", verdict: "reject", approvedRisk: false, manuallyRejected: true, error: "负责人标记为不合格" } : asset) }), revision); return json(response, 200, updated); } if (action === "regenerate") return json(response, 200, await regenerateAsset(parts[1], assetId, revision)); if (action === "restore") return json(response, 200, await restoreAsset(parts[1], assetId, revision)); throw new HttpError(404, "素材操作不存在"); }
    if (request.method === "GET" && parts[0] === "assets" && parts.length === 3) return await serveAsset(response, parts[1], parts[2]);
    throw new HttpError(404, "接口不存在");
  } catch (error) { const status = error instanceof HttpError ? error.statusCode : (error as { statusCode?: number }).statusCode ?? 500; json(response, status, { error: error instanceof Error ? error.message : "本地任务服务出错" }); }
});

await initializeStore();
for (const task of await listTasks()) if (needsRecovery(task)) await updateTask(task.id, recoverInterruptedTask);
server.listen(port, "127.0.0.1", () => console.log(`MVP task service: http://127.0.0.1:${port}`));

import { modelRequest, type ModelCallObserver } from "./model-request";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { moduleSlots } from "../lib/module-layout";
import { assertStructure } from "../lib/structure-validation";
import { adaptOriginal } from "./safe-crop";
import { fitAssetImage } from "./asset-image";
import { assetRoot, readTask, listTasks, updateTask, uploadRoot } from "./task-store";
import { planTask } from "./planner";
import { storeFormatRegistry, type StoreFormatType } from "../lib/store-formats";
import type { MvpAsset, MvpTask } from "../lib/mvp-contract";
import { analyzeProducts } from "./analyzer";

const queue: string[] = [];
let active: string | undefined;
let providerBlocked = false;
class PauseRequested extends Error {}
class BudgetPause extends Error {}
async function checkpoint(id: string) { const task = await readTask(id); if (task.status === "pausing" || task.status === "paused") throw new PauseRequested("已暂停"); return task; }
async function tripProviderCircuit() { providerBlocked = true; const waiting = queue.splice(0); for (const id of waiting) await updateTask(id, task => ({...task,status:"paused",currentStep:"模型账户不可用，队列已暂停"})); }

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ratioSize = (ratio: string) => { const [width, height] = ratio.split(":").map(Number); const long = 1080; return width >= height ? { width: long, height: Math.round(long * height / width) } : { width: Math.round(long * width / height), height: long }; };
const modelRatioSize = (ratio: string) => { const [width, height] = ratio.split(":").map(Number); const factor = Math.max(width, height) / Math.min(width, height); const maxPixels = 4_624_220; const short = Math.max(1024, Math.min(2048, Math.floor(Math.sqrt(maxPixels / factor) / 32) * 32)); const long = Math.min(4096, Math.floor(short * factor / 32) * 32); return width >= height ? { width: long, height: short } : { width: short, height: long }; };
async function estimateCall(model: string, requestType: MvpTask["modelCalls"][number]["requestType"]) { const pricingFile = process.env.MVP_PRICING_FILE; if (!pricingFile) return undefined; try { const pricing = JSON.parse(await readFile(path.resolve(pricingFile), "utf8")) as { models?: Record<string, Partial<Record<MvpTask["modelCalls"][number]["requestType"], number>>> }; const value = pricing.models?.[model]?.[requestType]; return typeof value === "number" && value >= 0 ? value : undefined; } catch { return undefined; } }
function observeCalls(taskId: string, assetId?: string, manual = false): ModelCallObserver { return async (call) => {
  const quote = await estimateCall(call.model, call.requestType);
  const estimatedCost = call.status === "success" ? quote : undefined;
  const latest = await readTask(taskId);
  if(call.status === "pending" && latest.batchId && latest.batchBudgetCny !== undefined) {
    const batchCalls=(await listTasks()).filter(task=>task.batchId===latest.batchId).flatMap(task=>task.modelCalls);
    if(quote===undefined||batchCalls.some(prior=>prior.reservedCost===undefined)) throw new BudgetPause("批次预算占用未知，停止付费调用");
    if(batchCalls.reduce((sum,prior)=>sum+prior.reservedCost!,0)+quote>latest.batchBudgetCny)throw new BudgetPause("达到整个批次预算上限");
  }
  await updateTask(taskId, task => {
    if (call.status === "pending" && ["pausing","paused"].includes(task.status)) throw new PauseRequested("已暂停");
    const previous=task.modelCalls.find(prior=>prior.id===call.id);
    const reservedCost=previous?.reservedCost ?? quote;
    if(call.status === "pending" && task.budgetCny !== undefined) {
      if(quote===undefined || task.modelCalls.some(prior=>prior.reservedCost===undefined)) throw new BudgetPause("缺少请求预算上界，停止付费调用");
      const reserved=task.modelCalls.reduce((sum,prior)=>sum+(prior.reservedCost??0),0);
      if(reserved+quote>task.budgetCny) throw new BudgetPause("达到任务预算上限，已暂停");
    }
    if (call.status === "pending" && call.requestType === "generation" && assetId) {
      const asset = task.assets.find(a => a.id === assetId)!;
      if (!manual && asset.automaticAttempts >= 2) throw new Error("自动生成次数已达上限");
      if (manual) asset.manualAttempts++; else asset.automaticAttempts++;
      asset.lastAttemptManual = manual; asset.retryEligible = false; asset.status = "generating";
    }
    return { ...task, modelCalls: [...task.modelCalls.filter(prior => prior.id !== call.id), { ...call, assetId, estimatedCost, reservedCost }] };
  });
}; }
const isFatalProviderError = (error: unknown): error is Error & { fatalProvider: true } => error instanceof Error && (error as Error & { fatalProvider?: boolean }).fatalProvider === true;

async function callImageModel(sources: Buffer[], task: MvpTask, asset: MvpAsset, retryReason?: string, manual = false) {
  const key = process.env.ARK_API_KEY; const model = process.env.ARK_IMAGE_MODEL; const endpoint = process.env.ARK_IMAGE_ENDPOINT;
  if (!key || !model || !endpoint) return undefined;
  const product = task.products.find((item) => item.id === asset.productId)!; const size = modelRatioSize(asset.ratio); const analysis = task.productAnalyses.find((item) => item.productId === product.id);
  const prompt = `为微购店铺装修制作无文字图片。前${sources.length}张是同一商品的不同角度参考，之后才是风格参考。视觉方向：${task.visualDescription}。经营目标：${task.brief}。商品：${product.name}。识别摘要：${analysis?.summary ?? product.name}。必须保护：${analysis?.protectedFeatures.join("、") ?? "品类、版型、主色、材质和关键结构"}。每个输出槽位必须是一张完整、连续的单一画面；禁止宫格、拼贴、分屏、画中画和多联图。参考图只用于理解商品，不得把多个参考角度并排复刻到输出中。不生成文字、按钮、收藏或点赞图标。画面比例 ${asset.ratio}，用途 ${asset.role}。${asset.route === "preserve" ? "采用保留式编辑，商品主体不可重绘，只调整背景、光线和构图。" : "生成完整自然场景，同时严格保持参考商品身份。"}`;
  const references = await Promise.all(task.styleReferences.map(async (filename) => sharp(await readFile(path.join(uploadRoot, task.id, filename))).rotate().jpeg({ quality: 94 }).toBuffer())); const images = [...sources, ...references].map((bytes) => `data:image/jpeg;base64,${bytes.toString("base64")}`);
  return modelRequest({ model, requestType: "generation", endpoint, timeoutMs: 180_000, ratio: asset.ratio, retryReason, observe: observeCalls(task.id, asset.id, manual), body: { model, prompt, image: images.length === 1 ? images[0] : images, size: `${size.width}x${size.height}`, stream: false, response_format: "b64_json", watermark: false } }, async payload => {
  const result = payload.data?.[0]; if (result?.b64_json) return Buffer.from(result.b64_json, "base64"); if (result?.url) { const download = await fetch(result.url); if (!download.ok) throw new Error("无法读取生图结果"); return Buffer.from(await download.arrayBuffer()); }
  throw new Error("生图服务没有返回图片");
  });
}

async function qualityCheck(sources: Buffer[], output: Buffer, task: MvpTask, asset: MvpAsset): Promise<{ verdict: "pass" | "risk" | "reject"; reason?: string }> {
  const key = process.env.ARK_API_KEY; const model = process.env.ARK_VISION_MODEL; const endpoint = process.env.ARK_RESPONSES_ENDPOINT;
  if (!key || !model || !endpoint) return asset.route === "original" || asset.route === "crop" ? { verdict: "pass" } : { verdict: "risk", reason: "当前为本地构图预览；配置视觉模型后才能进行商品身份质检" };
  const analysis = task.productAnalyses.find((item) => item.productId === asset.productId); const prompt = `比较原商品图与装修结果图。商品为${task.products.find((item) => item.id === asset.productId)?.name}。重点保护：${analysis?.protectedFeatures.join("、") ?? "品类、版型、主色和关键结构"}。如果这些身份特征、包装文字、鞋底、机械结构或独特印花明显改变，必须reject；尺寸/结构损坏也reject。每个结果槽位必须是一张连续的单一画面；出现宫格、拼贴、分屏、画中画或多联图也必须reject。轻微审美或融合问题为risk；可直接使用为pass。只输出JSON：{"verdict":"pass|risk|reject","reason":"简短原因"}`;
  try { return await modelRequest({ model, requestType: "quality_check", endpoint, timeoutMs: 90_000, observe: observeCalls(task.id, asset.id), body: { model, store: false, max_output_tokens: 600, reasoning: { effort: "minimal" }, input: [{ role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_text", text: "下面是原商品主参考图：" }, { type: "input_image", image_url: `data:image/jpeg;base64,${sources[0].toString("base64")}` }, { type: "input_text", text: "下面是唯一需要判断的装修结果图：" }, { type: "input_image", image_url: `data:image/jpeg;base64,${output.toString("base64")}` }] }] } }, payload => {
    const text = payload.output?.flatMap((item: { content?: Array<{type?: string; text?: string}> }) => item.content ?? []).find((item: {type?: string; text?: string}) => item.type === "output_text")?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/); if (!match) throw new Error("视觉质检返回格式异常");
    const result = JSON.parse(match[0]); if (!["pass", "risk", "reject"].includes(result.verdict)) throw new Error("视觉质检结论不明确");
    return { verdict: result.verdict as "pass" | "risk" | "reject", reason: typeof result.reason === "string" ? result.reason : undefined };
  }); } catch(error) { if (isFatalProviderError(error) || error instanceof PauseRequested || error instanceof BudgetPause) throw error; return { verdict: "risk", reason: error instanceof Error ? error.message : "视觉质检暂时不可用" }; }

}

async function transition(id: string, status: MvpTask["status"], progress: number, currentStep: string) { return updateTask(id, (task) => ["pausing","paused"].includes(task.status) && status !== "paused" ? task : ({ ...task, status, progress, currentStep })); }
function routeFor(type: string, productId: string, task: MvpTask): MvpAsset["route"] { if (type === "showcase") return "original"; if (type === "navigation") return "crop"; return task.productAnalyses.find((analysis) => analysis.productId === productId)?.identitySensitive ? "preserve" : "direct"; }

async function prepareAssets(task: MvpTask) {
  assertStructure(task, "planning");
  const byKey = new Map<string, MvpAsset>();
  for (const plan of task.plans) for (const module of [plan.shopSign, ...plan.modules]) {
    const format = storeFormatRegistry[module.type as StoreFormatType];
    const variant = format.variants[module.variant as keyof typeof format.variants] as { slots?: readonly { role: string; ratio: string }[] };
    const slots = moduleSlots(module.type,module.variant,task.layoutVersion);
    module.assetIds = slots.map((slot, index) => {
      const productId = module.productIds[index % Math.max(module.productIds.length, 1)] ?? task.products[0].id;
      const product = task.products.find((item) => item.id === productId) ?? task.products[0];
      const route = routeFor(module.type, product.id, task);
      const key = `${productId}:${slot.role}:${slot.ratio}:${route}`;
      let asset = byKey.get(key);
      if (!asset) { asset = { id: crypto.randomUUID(), moduleId: module.id, productId, role: slot.role, ratio: slot.ratio, initialRoute: route, route, status: "pending", verdict: "pending", approvedRisk: false, manuallyRejected: false, automaticAttempts: 0, manualAttempts: 0, currentVersion: 0 }; byKey.set(key, asset); }
      return asset.id;
    });
  }
  task.assets = [...byKey.values()];
  assertStructure(task);
  return task;
}

export async function processAsset(taskId: string, assetId: string, manual = false) {
  let task = await checkpoint(taskId);
  let asset = task.assets.find(a => a.id === assetId)!;
  const product = task.products.find(p => p.id === asset.productId)!;
  const sources = await Promise.all(product.images.map(async name => ({name,bytes:await readFile(path.join(uploadRoot,taskId,name))})));
  const sourceReferences = await Promise.all(sources.map(source => sharp(source.bytes).rotate().jpeg({quality:94}).toBuffer()));
  const size = ratioSize(asset.ratio), directory = path.join(assetRoot,assetId);
  await mkdir(directory,{recursive:true});
  const saveOriginal = async (fallback = false) => {
    await checkpoint(taskId);
    const analysis = task.productAnalyses.find(a => a.productId === product.id);
    const result = await adaptOriginal(sources,size,analysis?.views,asset.role === "category");
    const version = await nextAssetVersion(directory);
    await writeAssetVersion(directory,version,result.bytes,asset.currentVersion);
    await updateTask(taskId,current => ({...current,assets:current.assets.map(item => item.id === assetId ? {...item,route:fallback ? "original" : item.route,status:"ready",verdict:result.adaptation.verdict,adaptation:result.adaptation,retryEligible:false,initialVerdict:item.initialVerdict ?? (!fallback ? result.adaptation.verdict : undefined),automaticAttempts:!fallback && !item.automaticAttempts ? 1 : item.automaticAttempts,previousVersion:item.currentVersion || undefined,currentVersion:version,approvedRisk:false,manuallyRejected:false,error:(fallback ? "两次生成未通过，已回退原图。" : "") + result.adaptation.reason} : item)}));
  };
  try {
    if (asset.route === "original" || asset.route === "crop") { await saveOriginal(); return; }
    for (;;) {
      task = await checkpoint(taskId); asset = task.assets.find(a => a.id === assetId)!;
      let output: Buffer;
      if (asset.status === "checking" && asset.currentVersion > 0) output = await readFile(path.join(directory,asset.currentVersion + ".jpg"));
      else {
        if (!manual && (asset.automaticAttempts >= 2 || (asset.automaticAttempts > 0 && !asset.retryEligible))) return;
        if (!manual && asset.retryEligible && asset.route === "direct") {
          task = await updateTask(taskId,current => ({...current,assets:current.assets.map(item=>item.id===assetId?{...item,route:"preserve"}:item)})); asset = task.assets.find(a=>a.id===assetId)!;
        }
        const generated = await callImageModel([sourceReferences[0]],task,asset,manual ? "人工触发单图重生成" : asset.automaticAttempts > 0 ? "首次生成未通过，切换保留式编辑" : undefined,manual);
        if (!generated) {
          const result = await adaptOriginal(sources,size,[],false); const version=await nextAssetVersion(directory);
          await writeAssetVersion(directory,version,result.bytes,asset.currentVersion);
          await updateTask(taskId,current=>({...current,assets:current.assets.map(item=>item.id===assetId?{...item,status:"ready",verdict:"risk",adaptation:result.adaptation,currentVersion:version,previousVersion:item.currentVersion||undefined,error:"未配置生图模型，仅显示原图参考，不能视为生成通过"}:item)})); return;
        }
        output = await fitAssetImage(generated,size);
        const version = await nextAssetVersion(directory); await writeAssetVersion(directory,version,output,asset.currentVersion);
        task = await updateTask(taskId,current=>({...current,assets:current.assets.map(item=>item.id===assetId?{...item,status:"checking",verdict:"pending",currentVersion:version,previousVersion:item.currentVersion||undefined,approvedRisk:false,manuallyRejected:false}:item)}));
        asset = task.assets.find(a=>a.id===assetId)!;
      }
      await checkpoint(taskId);
      const check = await qualityCheck([sourceReferences[0]],output,task,asset);
      task = await updateTask(taskId,current=>({...current,assets:current.assets.map(item=>item.id===assetId?{...item,status:check.verdict==="reject"?"failed":"ready",verdict:check.verdict,initialVerdict:item.initialVerdict ?? (!item.lastAttemptManual && item.automaticAttempts===1 ? check.verdict : undefined),retryEligible:check.verdict==="reject"&&!item.lastAttemptManual&&item.automaticAttempts<2,approvedRisk:false,manuallyRejected:false,error:check.reason}:item)}));
      asset=task.assets.find(a=>a.id===assetId)!;
      if (check.verdict !== "reject") return;
      if (asset.automaticAttempts>=2 && !asset.lastAttemptManual && task.productAnalyses.find(a=>a.productId===product.id)?.identitySensitive) { await saveOriginal(true); return; }
      if (!asset.retryEligible) return;
      await checkpoint(taskId);
    }
  } catch(error) {
    if (error instanceof PauseRequested || error instanceof BudgetPause) throw error;
    await updateTask(taskId,current=>({...current,assets:current.assets.map(item=>item.id===assetId?{...item,status:"failed",verdict:"pending",retryEligible:false,error:error instanceof Error?error.message:"素材处理失败"}:item)}));
    if (isFatalProviderError(error)) throw error;
  }
}

async function nextAssetVersion(directory: string) { const files = await readdir(directory); return Math.max(0, ...files.filter(name => /^\d+\.jpg$/.test(name)).map(name => Number(name.slice(0,-4)))) + 1; }
async function writeAssetVersion(directory: string, version: number, bytes: Buffer, _previousVersion: number) { await writeFile(path.join(directory, String(version) + ".jpg"), bytes, { flag: "wx" }); }

export async function restoreAsset(taskId: string, assetId: string, revision: number) { if (active === taskId) throw Object.assign(new Error("请先暂停当前任务再恢复"), {statusCode:409}); return updateTask(taskId, async (task) => { const asset = task.assets.find((item) => item.id === assetId); if (!asset?.previousVersion) throw Object.assign(new Error("没有可恢复的上一版本"), { statusCode: 409 }); try { await sharp(await readFile(path.join(assetRoot, assetId, String(asset.previousVersion) + ".jpg"))).stats(); } catch { throw Object.assign(new Error("上一版本图片缺失或损坏，未执行恢复"), {statusCode:409}); } return { ...task, assets: task.assets.map((item) => item.id === assetId ? { ...item, adaptation:{verdict:"risk",mode:"preserved",sourceFilename:"restored-version",reason:"恢复的版本需要重新检查商品和裁切范围"}, currentVersion: item.previousVersion!, previousVersion: item.currentVersion, status: "ready", verdict: "risk", approvedRisk: false, manuallyRejected: false, error: "已恢复上一版本，请重新确认" } : item) }; }, revision); }

export async function replaceAsset(taskId: string, assetId: string, revision: number, bytes: Buffer) {
  if (active === taskId) throw Object.assign(new Error("请先暂停当前任务再换图"), { statusCode: 409 });
  return updateTask(taskId, async (task) => {
    const asset = task.assets.find(item => item.id === assetId);
    if (!asset) throw Object.assign(new Error("素材不存在"), { statusCode: 404 });
    const directory = path.join(assetRoot, assetId); await mkdir(directory, { recursive: true });
    const adapted = await adaptOriginal([{name:"manual-upload",bytes}],ratioSize(asset.ratio),[],asset.role === "category");
    const output = adapted.bytes;
    const version = await nextAssetVersion(directory);
    await writeAssetVersion(directory, version, output, asset.currentVersion);
    return { ...task, assets: task.assets.map(item => item.id === assetId ? { ...item, route: "original", adaptation: {...adapted.adaptation,verdict:"risk" as const}, status: "ready", verdict: "risk", approvedRisk: false, manuallyRejected: false, previousVersion: item.currentVersion || undefined, currentVersion: version, error: "已换图，需确认商品身份和裁切范围" } : item) };
  }, revision);
}

export async function regenerateAsset(taskId: string, assetId: string, revision: number) {
  if (active || providerBlocked) throw Object.assign(new Error("已有任务运行或模型账户已暂停"),{statusCode:409});
  active=taskId;
  try {
    await updateTask(taskId,task=>{ if(!task.assets.some(a=>a.id===assetId)) throw Object.assign(new Error("素材不存在"),{statusCode:404}); return {...task,status:"generating",currentStep:"正在重新生成单张素材",assets:task.assets.map(asset=>asset.id===assetId?{...asset,status:"pending",verdict:"pending",retryEligible:false,approvedRisk:false,manuallyRejected:false}:asset)}; },revision);
    await processAsset(taskId,assetId,true);
    return await updateTask(taskId,task=>task.status === "pausing" ? {...task,status:"paused",currentStep:"已暂停"} : {...task,status:task.assets.some(a=>a.status==="failed")?"partial_failed":"completed",progress:100,currentStep:"单张素材处理完成",completedAt:new Date().toISOString()});
  } catch(error) {
    if(error instanceof PauseRequested || error instanceof BudgetPause) return updateTask(taskId,task=>({...task,status:"paused",currentStep:"已暂停，继续时先检查已生成图片"}));
    if(isFatalProviderError(error)) { await tripProviderCircuit(); return updateTask(taskId,task=>({...task,status:"paused",currentStep:"模型账户不可用，恢复后可继续",error:error.message})); }
    throw error;
  } finally { active=undefined; void drain(); }
}

async function run(id: string) {
  try {
    await checkpoint(id);
    let task = await transition(id, "analyzing", 8, "正在识别商品关键特征");
    if (!task.productAnalyses.length) { const result = await analyzeProducts(task, observeCalls(id)); task = await updateTask(id, (current) => ({ ...current, productAnalyses: result.analyses })); }
    await checkpoint(id);
    task = await transition(id, "planning", 18, "正在规划三套微购结构");
    if (!task.plans.length) { const result = await planTask(task, observeCalls(id)); task = await updateTask(id, (current) => prepareAssets({ ...current, plans: result.plans })); }
    assertStructure(task);
    const total = task.assets.length;
    for (let index = 0; index < total; index++) {
      task = await readTask(id);
      if (task.status === "pausing") { await transition(id, "paused", task.progress, "已暂停，将从下一张素材继续"); return; }
      const asset = task.assets[index];
      if (asset.status === "ready" || (asset.status === "failed" && !asset.retryEligible)) continue;
      await transition(id, "generating", 20 + Math.round((index / total) * 70), `正在准备素材 ${index + 1}/${total}`);
      await processAsset(id, asset.id);
    }
    await checkpoint(id);
    await transition(id, "checking", 94, "正在检查结构与素材状态"); await delay(250);
    task = await readTask(id);
    assertStructure(task);
    const failed = task.assets.some((asset) => asset.status === "failed" || asset.verdict === "reject");
    await updateTask(id, (current) => current.status === "pausing" ? ({...current,status:"paused",currentStep:"已暂停"}) : ({ ...current, status: failed ? "partial_failed" : "completed", progress: 100, currentStep: failed ? "部分素材需要处理" : "三套方案已完成", completedAt: new Date().toISOString() }));
  } catch (error) {
    if (error instanceof BudgetPause) { await updateTask(id,task=>({...task,status:"paused",currentStep:error.message,error:error.message})); return; }
    if (error instanceof PauseRequested) { await transition(id,"paused",(await readTask(id)).progress,"已暂停，继续时从未完成步骤恢复"); return; }
    if (isFatalProviderError(error)) await tripProviderCircuit();
    await updateTask(id, (task) => ({ ...task, status: isFatalProviderError(error) ? "paused" : "failed", error: error instanceof Error ? error.message : "任务执行失败", currentStep: isFatalProviderError(error) ? "模型账户不可用，恢复后可继续" : "任务执行失败", completedAt: isFatalProviderError(error) ? undefined : new Date().toISOString() })).catch(() => undefined);
  } finally { active = undefined; void drain(); }
}
async function drain() { if (active || providerBlocked) return; const id = queue.shift(); if (!id) return; active = id; await run(id); }
export async function enqueue(id: string, revision: number) { if(providerBlocked) throw Object.assign(new Error("模型账户不可用，请恢复已暂停任务后再开始"),{statusCode:409}); if (active === id || queue.includes(id)) return; await updateTask(id, (task) => ({ ...task, status: "queued", currentStep: "等待生成", error: undefined, startedAt: task.startedAt ?? new Date().toISOString(), completedAt: undefined }), revision); queue.push(id); void drain(); }
export async function pause(id: string, revision: number) { if (active !== id) { const position = queue.indexOf(id); if (position >= 0) queue.splice(position, 1); } return updateTask(id, (task) => ({ ...task, status: active === id ? "pausing" : "paused", currentStep: active === id ? "当前请求完成并保存后暂停" : "已暂停" }), revision); }
export async function resume(id: string, revision: number) { if (active === id || queue.includes(id)) return readTask(id); await updateTask(id, (task) => ({ ...task, status: "queued", currentStep: "等待继续生成" }), revision); providerBlocked = false; queue.push(id); void drain(); return readTask(id); }
export function queueSnapshot() { return { active, providerBlocked, queued: [...queue] }; }

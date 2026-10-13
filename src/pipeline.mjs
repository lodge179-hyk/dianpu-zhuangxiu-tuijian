/**
 * 流程编排：店铺截图 → AI 决策 → 生成组合素材 → 裁剪 → 固定模块渲染 → 素材交付。
 *
 * 状态区分（界面必须如实呈现）：
 * - complete：全部走通，素材包含 AI 生成图与截图裁切图。
 * - partial ：拿到了可用的完整预览，但有明确的降级（例如某张生成图失败，用占位图顶上）。
 * - failed  ：关键步骤失败，没有可用预览。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError, analyzeStore, prepareScreenshot } from './analyze.mjs';
import { CATALOG } from './catalog.mjs';
import { planDesign } from './plan.mjs';
import { validatePlan } from './validate.mjs';
import { buildSheetPrompt, cropFromScreenshot, cropSheetIntoSlots, generateSheet, layoutSheet, panelsFromSheet, readImageAsDataUrl } from './assets.mjs';
import { buildManifest, renderPlan } from './render.mjs';

export function readEnv(env = process.env) {
  return {
    apiKey: env.ARK_API_KEY || '',
    responsesEndpoint: env.ARK_RESPONSES_ENDPOINT || '',
    visionModel: env.ARK_VISION_MODEL || '',
    imageEndpoint: env.ARK_IMAGE_ENDPOINT || '',
    imageModel: env.ARK_IMAGE_MODEL || '',
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES || 80 * 1024 * 1024),
    port: Number(env.ASSISTED_PORT || env.PORT || 5191),
  };
}

export const envReady = env => Boolean(env.apiKey && env.responsesEndpoint && env.visionModel && env.imageEndpoint && env.imageModel);

export function createState(id) {
  return {
    id,
    version: 'ai-design-1',
    status: 'running',
    stage: '准备截图',
    step: 0,
    totalSteps: 6,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    calls: [],
    usage: [],
    warnings: [],
    hasPreview: false,
    shop: null,
    design: null,
    plan: null,
    validation: null,
    sheet: null,
    assets: [],
    render: null,
    error: null,
    catalogVersion: CATALOG.version,
  };
}

const STEPS = [
  '读取并规范化截图',
  'AI 看懂这家店',
  'AI 做装修决策',
  '生成组合素材并裁切',
  '用固定模块渲染完整页面',
  '打包素材与装修清单',
];

export async function runTask({ state, screenshotBytes, dir, env, save, log = () => {} }) {
  const mark = async (step, stage) => {
    state.step = step;
    state.stage = stage;
    await save(state);
  };
  const call = async (kind, operation) => {
    const record = { kind, status: 'started', startedAt: new Date().toISOString() };
    state.calls.push(record);
    await save(state);
    try {
      const value = await operation();
      record.status = 'success';
      return value;
    } catch (error) {
      record.status = 'failed';
      record.error = error instanceof AppError ? error.message : String(error?.message || error);
      record.hint = error?.hint ? String(error.hint).slice(0, 300) : '';
      throw error;
    } finally {
      record.finishedAt = new Date().toISOString();
      await save(state);
    }
  };
  const warn = message => { if (message && !state.warnings.includes(message)) state.warnings.push(message); };

  const assetsDir = path.join(dir, 'assets');
  const sheetsDir = path.join(dir, 'sheets');
  let degraded = false;
  const assetsBySlot = new Map();
  const allAssets = [];

  try {
    await mkdir(assetsDir, { recursive: true });
    await mkdir(sheetsDir, { recursive: true });

    // ---- 1. 规范化截图 ----
    await mark(1, STEPS[0]);
    const screenshot = await call('normalize', () => prepareScreenshot(screenshotBytes));
    await writeFile(path.join(dir, 'screenshot.png'), screenshot.buffer);
    if (screenshot.downscaled) warn(`原图 ${screenshot.original.width}×${screenshot.original.height} 已按比例缩小到 ${screenshot.width}×${screenshot.height} 用于识别（原图保留）。`);

    // ---- 2. 看懂店铺 ----
    await mark(2, STEPS[1]);
    const analyzed = await call('analyze-store', () => analyzeStore(env, screenshot, log));
    state.shop = analyzed.shop;
    if (analyzed.usage) state.usage.push({ step: 'analyze', ...pickUsage(analyzed.usage, env.visionModel) });
    await writeFile(path.join(dir, 'shop.json'), JSON.stringify(analyzed.shop, null, 2));
    if (analyzed.shop.confidence.missing.length) {
      warn(`截图里看不清：${analyzed.shop.confidence.missing.join('、')}。这些内容没有替你编造。`);
    }

    // ---- 3. AI 做装修决策 ----
    await mark(3, STEPS[2]);
    const planned = await call('plan-design', () => planDesign(env, analyzed.shop, log));
    state.plan = planned.plan;
    state.design = planned.plan.design;
    state.validation = planned.plan.validation;
    if (planned.usage) state.usage.push({ step: 'plan', ...pickUsage(planned.usage, env.visionModel) });
    await writeFile(path.join(dir, 'plan.json'), JSON.stringify(planned.plan, null, 2));
    planned.plan.validation.warnings.forEach(warn);
    if (!planned.plan.design.decisions.length) warn('AI 没有给出设计决策理由，本轮的选型理由不可核对。');

    const plan = planned.plan;
    const slotsById = new Map(plan.validation.slots.map(s => [s.slotId, s]));

    // ---- 4. 生成组合素材并裁切 ----
    await mark(4, STEPS[3]);
    const sheets = plan.design.imagePlan.images;
    for (const [index, sheet] of sheets.entries()) {
      const panels = panelsFromSheet(sheet, slotsById);
      if (!panels.length) { warn(`生图计划 ${sheet.id} 没有对应到任何有效槽位，已跳过。`); continue; }
      const layout = layoutSheet(panels);
      const prompt = buildSheetPrompt({ sheet, layout, design: plan.design, shop: analyzed.shop });
      await writeFile(path.join(sheetsDir, `${sheet.id}-prompt.txt`), prompt);
      await writeFile(path.join(sheetsDir, `${sheet.id}-layout.json`), JSON.stringify({
        sheetId: sheet.id, purpose: sheet.purpose, requested: { width: layout.width, height: layout.height },
        panels: layout.panels.map(p => ({ slotId: p.slotId, subject: p.subject, source: p.source, ratio: p.ratio, panelRect: p.panelRect, slotPixels: [p.slotWidth, p.slotHeight] })),
      }, null, 2));

      const sheetFile = path.join(sheetsDir, `${sheet.id}.png`);
      try {
        const generated = await call(`generate-${sheet.id}`, () => generateSheet(env, prompt, sheetFile, layout, log));
        const cropped = await call(`crop-${sheet.id}`, () => cropSheetIntoSlots(sheetFile, layout, assetsDir, log));
        for (const asset of cropped) {
          assetsBySlot.set(asset.slotId, asset);
          allAssets.push(asset);
        }
        if (!generated.aspectMatchesRequest) warn(`素材画布实际尺寸 ${generated.width}×${generated.height} 与请求的 ${generated.requestedSize} 不同，裁切按实际画面进行。`);
        const upscaled = cropped.filter(a => a.upscaled);
        if (upscaled.length) warn(`有 ${upscaled.length} 张素材由较小像素放大到槽位尺寸（最大 ${Math.max(...upscaled.map(a => a.upscaleFactor))} 倍），大屏下会偏软。`);
        state.sheet = { ...(state.sheet || {}), [sheet.id]: { requested: { width: layout.width, height: layout.height }, actual: [generated.width, generated.height], panels: layout.panels.length } };
      } catch (error) {
        degraded = true;
        warn(`这一批素材（${sheet.id}）生成或裁切失败：${error.message}`);
        state.sheet = { ...(state.sheet || {}), [sheet.id]: { failed: error.message } };
      }
      await save(state);
    }

    // 真实商品照片：从截图裁切，优先按识别到的商品位置
    const productSlots = plan.validation.slots.filter(s => s.source === 'product-photo');
    if (productSlots.length) {
      const boxes = analyzed.shop.visibleProducts.map(p => p.box).filter(Boolean);
      if (!boxes.length) warn('识别阶段没有拿到商品位置，截图裁切的商品图只能取中上部区域，仅作装修示意。');
      try {
        const sliced = await call('crop-from-screenshot', () => cropFromScreenshot(screenshot.buffer, productSlots, assetsDir, log, boxes));
        for (const asset of sliced) {
          assetsBySlot.set(asset.slotId, asset);
          allAssets.push(asset);
        }
        const inaccurate = sliced.filter(a => !a.accurate).length;
        if (inaccurate) warn(`有 ${inaccurate} 张商品图没有精确位置，取的是截图中上部区域。`);
      } catch (error) {
        degraded = true;
        warn(`从截图裁切商品照片失败：${error.message}`);
      }
    }

    const missingSlots = plan.validation.slots.filter(s => !assetsBySlot.has(s.slotId)).map(s => s.slotId);
    if (missingSlots.length) {
      degraded = true;
      warn(`有 ${missingSlots.length} 个图片位没有拿到素材（${missingSlots.slice(0, 6).join('、')}），页面用标注占位图保持布局。`);
    }

    // ---- 5. 渲染完整页面 ----
    await mark(5, STEPS[4]);
    const rendered = await call('render', () => renderPlan(plan, assetsBySlot, dir, log));
    state.render = { width: rendered.width, height: rendered.height, moduleCount: rendered.moduleCount, photos: rendered.photos.length, htmlFile: 'preview.html' };
    state.assets = allAssets.map(a => ({
      slotId: a.slotId, file: `assets/${a.file}`, source: a.source, subject: a.subject,
      deliveredPixels: a.deliveredPixels, nativePixels: a.nativePixels, upscaled: !!a.upscaled,
      accurate: a.accurate === undefined ? null : a.accurate,
      note: a.note || '',
    }));

    // ---- 6. 交付清单 ----
    await mark(6, STEPS[5]);
    const manifest = await call('manifest', async () => buildManifest(plan, rendered, allAssets, analyzed.shop));
    manifest.warnings = state.warnings;
    manifest.calls = state.calls.map(c => ({ kind: c.kind, status: c.status, error: c.error || null }));
    manifest.generationCalls = state.calls.filter(c => c.kind.startsWith('generate-')).length;
    manifest.modelUsage = state.usage;
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    state.hasPreview = true;
    state.status = degraded ? 'partial' : 'complete';
    state.stage = degraded ? '装修方案已生成（有降级项，请看说明）' : '装修方案已生成';
    state.manifestFile = 'manifest.json';
    await writeFile(path.join(dir, 'shop.json'), JSON.stringify(analyzed.shop, null, 2));
  } catch (error) {
    state.status = 'failed';
    state.stage = '本次未完成';
    state.error = error instanceof AppError ? error.message : (error?.message || '处理未完成');
    state.errorHint = error?.hint ? String(error.hint).slice(0, 300) : '';
    state.errorStage = error?.stage || 'unknown';
    log(`任务失败于 ${state.errorStage}：${state.error}`);
  } finally {
    state.finishedAt = new Date().toISOString();
    await save(state);
  }
  return state;
}

function pickUsage(usage, model) {
  return {
    model,
    inputTokens: usage?.input_tokens ?? usage?.inputTokens ?? null,
    outputTokens: usage?.output_tokens ?? usage?.outputTokens ?? null,
  };
}

export { STEPS };

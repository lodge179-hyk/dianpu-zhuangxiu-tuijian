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
import sharp from 'sharp';
import { AppError, analyzeStore, prepareScreenshot } from './analyze.mjs';
import { CATALOG } from './catalog.mjs';
import { planDesign } from './plan.mjs';
import { validatePlan } from './validate.mjs';
import { buildSheetPrompt, cropFromScreenshot, cropSheetIntoSlots, generateSheet, layoutSheet, panelsFromSheet, readImageAsDataUrl, splitIntoSpanningSheets } from './assets.mjs';
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
  const skippedPanels = [];

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
    // 程序实测真实主色：防止 AI 用品类刻板印象（美妆→粉色）替代这家店真实的颜色
    try {
      const { extractPalette } = await import('./palette.mjs');
      const palette = await extractPalette(screenshot.buffer);
      analyzed.shop.measuredPalette = palette;
      state.shop.measuredPalette = palette;
      log(`实测主色：${palette.dominant.slice(0, 3).map(c => c.hex).join(' / ')}`);
    } catch (error) {
      warn(`主色提取失败（${error.message}），沿用模型判断的配色。`);
    }
    if (analyzed.usage) state.usage.push({ step: 'analyze', ...pickUsage(analyzed.usage, env.visionModel) });
    await writeFile(path.join(dir, 'shop.json'), JSON.stringify(analyzed.shop, null, 2));
    if (analyzed.shop.confidence.missing.length) {
      warn(`截图里看不清：${analyzed.shop.confidence.missing.join('、')}。这些内容没有替你编造。`);
    }

    // ---- 3. AI 做装修决策 ----
    await mark(3, STEPS[2]);
    let planned;
    try {
      planned = await call('plan-design', () => planDesign(env, analyzed.shop, log));
    } catch (error) {
      // 计划被拦下时把模型原始输出落盘，便于核对是提示词还是模型的问题
      if (error?.raw) await writeFile(path.join(dir, 'plan-raw.txt'), error.raw, 'utf8').catch(() => {});
      throw error;
    }
    state.plan = planned.plan;
    state.design = planned.plan.design;
    state.validation = planned.plan.validation;
    if (planned.usage) state.usage.push({ step: 'plan', ...pickUsage(planned.usage, env.visionModel) });
    await writeFile(path.join(dir, 'plan.json'), JSON.stringify(planned.plan, null, 2));
    planned.plan.validation.warnings.forEach(warn);
    (planned.plan.notes || []).forEach(warn);
    if (planned.plan.slotRenames?.length) {
      warn(`有 ${planned.plan.slotRenames.length} 个图片编号被纠正（模型把别的模块的编号复制了过来），已同步到生图计划：${planned.plan.slotRenames.map(r => `${r.from}→${r.to}`).join('、')}。`);
    }
    if (!planned.plan.design.decisions.length) warn('AI 没有给出设计决策理由，本轮的选型理由不可核对。');

    const plan = planned.plan;
    const slotsById = new Map(plan.validation.slots.map(s => [s.slotId, s]));

    // ---- 4. 生成组合素材并裁切 ----
    await mark(4, STEPS[3]);
    const plannedSheets = plan.design.imagePlan.images;
    // 把 AI 安排的画布按形状拆成真正可生成的若干张（宽幅/竖长格子单独成图），
    // 拆分由程序决定，实际生图次数会在界面上如实说明。
    const sheets = plannedSheets.flatMap(sheet => splitIntoSpanningSheets(sheet, slotsById));
    if (sheets.length > plannedSheets.length) {
      warn(`AI 计划 ${plannedSheets.length} 次生图；其中宽高比与方格差异大的格子已单独成图，实际生图 ${sheets.length} 次。`);
    }
    for (const [index, sheet] of sheets.entries()) {
      const panels = sheet.panels;
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
        for (const asset of cropped.assets) {
          assetsBySlot.set(asset.slotId, asset);
          allAssets.push(asset);
        }
        for (const skip of cropped.skipped) {
          degrade(skip.reason);
          skippedPanels.push(skip);
        }
        if (cropped.detection.rowCount !== layout.rows.length) {
          warn(`素材画布的实际行数（${cropped.detection.rowCount} 行，每行 ${cropped.detection.rowCounts.join('/')} 格）与计划（${layout.rows.length} 行）不同，已按实际检测结果顺序对应。`);
        }
        if (generated.sourceFormat && generated.sourceFormat !== 'png') {
          warn(`生图服务返回的是 ${generated.sourceFormat.toUpperCase()}，已统一转成 PNG 保存。`);
        }
        if (!generated.aspectMatchesRequest) warn(`素材画布实际尺寸 ${generated.width}×${generated.height} 与请求的 ${generated.requestedSize} 不同，裁切按实际画面进行。`);
        const upscaled = cropped.assets.filter(a => a.upscaled);
        if (upscaled.length) warn(`有 ${upscaled.length} 张素材由较小像素放大到槽位尺寸（最大 ${Math.max(...upscaled.map(a => a.upscaleFactor))} 倍），大屏下会偏软。`);
        state.sheet = {
          ...(state.sheet || {}),
          [sheet.id]: {
            requested: { width: layout.width, height: layout.height },
            actual: [generated.width, generated.height],
            sourceFormat: generated.sourceFormat,
            planned: { rows: layout.rows.length, panels: layout.panels.length },
            detected: cropped.detection,
            cropped: cropped.assets.length,
            skipped: cropped.skipped.length,
          },
        };
      } catch (error) {
        degraded = true;
        warn(`这一批素材（${sheet.id}）生成或裁切失败：${error.message}`);
        state.sheet = { ...(state.sheet || {}), [sheet.id]: { failed: error.message, requested: { width: layout.width, height: layout.height } } };
      }
      await save(state);
    }

    // 真实商品照片：从截图裁切。
    // 优先用程序实测的商品格（像素分析，不依赖模型的坐标），失败或数量不够再退回模型框。
    const productSlots = plan.validation.slots.filter(s => s.source === 'product-photo');
    if (productSlots.length) {
      const modelBoxes = analyzed.shop.visibleProducts.filter(p => p.box).map(p => p.box);
      const uncertain = analyzed.shop.visibleProducts.filter(p => p.box && p.boxPlausible === false).length;
      let boxes = modelBoxes;
      let locatedBy = 'model';
      try {
        const { detectProductGrid } = await import('./grid.mjs');
        const { data, info } = await sharp(screenshot.buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const cells = detectProductGrid(data, info.width, info.height, info.channels)
          .sort((a, b) => a.top - b.top || a.left - b.left);
        if (cells.length >= productSlots.length) {
          // 像素格转归一化坐标（与 cropFromScreenshot 的入参一致）
          boxes = cells.slice(0, productSlots.length).map(c => ({
            x: c.left / info.width, y: c.top / info.height, w: c.width / info.width, h: c.height / info.height,
          }));
          locatedBy = 'detected';
        } else if (cells.length) {
          warn(`程序只检测到 ${cells.length} 个商品格，少于需要的 ${productSlots.length} 个，商品照片改用识别阶段的模型框。`);
        }
      } catch (error) {
        warn(`程序检测商品格失败（${error.message}），商品照片退回识别阶段的模型框。`);
      }
      if (!boxes.length) warn('识别阶段没有拿到商品位置，截图裁切的商品图只能取中上部区域，仅作版式示意。');
      try {
        const sliced = await call('crop-from-screenshot', () => cropFromScreenshot(screenshot.buffer, productSlots, assetsDir, log, boxes));
        for (const asset of sliced) {
          assetsBySlot.set(asset.slotId, asset);
          allAssets.push(asset);
        }
        const notLocated = sliced.filter(a => a.reliability !== 'located').length;
        if (notLocated) {
          warn(`有 ${notLocated} 张商品图的位置不够可靠（${locatedBy === 'detected' ? '程序检测' : '模型框'}的形状不像完整商品照片），已标注为「位置待确认」，请核对后再上传到店铺。`);
        }
        if (uncertain && locatedBy === 'model') warn(`识别到 ${uncertain} 个商品框的形状异常，说明这张截图的商品定位不可全信。`);
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
    if (skippedPanels.length) {
      state.skippedPanels = skippedPanels.map(s => ({
        slotId: s.slotId, subject: s.subject, slotRatio: s.slotRatio,
        detectedRatio: s.detectedRatio, wouldRemovePercent: s.wouldRemovePercent, reason: s.reason,
      }));
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

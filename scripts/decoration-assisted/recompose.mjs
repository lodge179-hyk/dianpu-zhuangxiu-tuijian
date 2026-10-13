// Deliver a corrected layout from an existing user's assets. No model calls.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { normalizeDesign } from './design.mjs';
import { render } from './layout.mjs';

const sourceId = process.argv[2];
if (!/^[a-f0-9-]{36}$/.test(sourceId || '')) throw new Error('需要有效的历史任务编号');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'output/decoration-assisted');
const source = path.join(output, sourceId);
const prior = JSON.parse(await readFile(path.join(source, 'run.json'), 'utf8'));
if (!['complete', 'partial'].includes(prior.status)) throw new Error('原任务尚未完成，不能重排');
const analysis = JSON.parse(await readFile(path.join(source, 'analysis.json'), 'utf8'));
analysis.design = normalizeDesign(analysis.design, analysis.products, analysis.shopName);
analysis.design.summary = '保留已确认的招牌、权益、圆形导航、轮播、三列海报和三列商品橱窗，沿用上次生成素材恢复页面。';
const id = randomUUID(), dir = path.join(output, id);
await mkdir(dir, { recursive: false });
const state = {
  id, version: 'demo-4', status: 'running', stage: '按已确认UI恢复排版', step: 5,
  startedAt: new Date().toISOString(), calls: [], recomposedFrom: sourceId,
  sourceGenerationId: prior.sourceGenerationId || sourceId,
  shopName: analysis.shopName, productCount: analysis.products.length,
  design: analysis.design, style: analysis.style, hasPreview: false, canRetry: false,
  warnings: [...(prior.warnings || []).filter(w => !w.includes('版式参考已抓取') && !w.includes('固定布局的装修效果')),
    '本次沿用上次商品及海报素材恢复UI，没有重新调用模型。'],
};
const save = () => writeFile(path.join(dir, 'run.json'), JSON.stringify(state, null, 2));
await save();
try {
  for (const file of ['screenshot.png', 'banner.png', ...analysis.products.map((_, i) => `product-${i}.png`)]) {
    await copyFile(path.join(source, file), path.join(dir, file));
  }
  await writeFile(path.join(dir, 'analysis.json'), JSON.stringify(analysis, null, 2));
  await writeFile(path.join(dir, 'blueprint.json'), JSON.stringify({ shopName: analysis.shopName, design: analysis.design }, null, 2));
  const spec = await render(analysis, dir);
  state.artifacts = spec.artifacts;
  state.hasPreview = true;
  state.status = analysis.bannerSource === 'source-composite' ? 'partial' : 'complete';
  state.canRetry = state.status === 'partial';
  state.stage = '已按确认UI重新排版';
  if (state.status === 'partial') state.generationError = prior.generationError;
  state.warnings = [...new Set([...state.warnings, ...(spec.limitations || [])])];
} catch (error) {
  state.status = 'failed';
  state.stage = '排版恢复未完成';
  state.error = '已有素材未能完成重新排版。';
  process.exitCode = 1;
  console.error(error.message);
} finally {
  state.finishedAt = new Date().toISOString();
  await save();
}
console.log(JSON.stringify({ id, status: state.status, preview: path.join(dir, 'preview.png') }));

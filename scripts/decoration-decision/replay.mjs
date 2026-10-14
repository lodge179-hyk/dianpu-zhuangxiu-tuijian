// Offline replay: re-run crop + render against an existing run's sheets
// without any model calls. Usage:
//   node scripts/decoration-decision/replay.mjs <runId>
import fs from 'node:fs';
import path from 'node:path';
import { buildCatalog, decisionSubset } from './catalog.cjs';
import { cropSheets } from './crop.mjs';
import { renderStore } from './render.mjs';
import { layoutGrid } from './sheets.mjs';

const runId = process.argv[2];
if (!runId) { console.error('用法: node replay.mjs <runId>'); process.exit(1); }
const dir = path.resolve(import.meta.dirname, 'runs', runId);
if (!fs.existsSync(path.join(dir, 'plan.json'))) { console.error(`找不到 ${dir}/plan.json`); process.exit(1); }

const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8'));
const catalog = decisionSubset(buildCatalog());

// Reattach catalog entries (they carry slotRects since the rebuild).
for (const m of persisted.modules) {
  const entry = catalog.find(c => c.type === m.type);
  if (!entry) throw new Error(`目录中找不到模块类型 ${m.type}（旧 run 使用了已收窄的类型）`);
  m.catalog = entry;
}

// Rebuild sheet grouping the same way generateSheets does (≤6 cells × ≤2
// sheets), but point the sheet files at the run's existing sheet-N.png.
const generate = persisted.assets.filter(a => a.status !== 'ready' || !fs.existsSync(path.join(dir, a.file || '')));
for (const a of persisted.assets) a.status = 'pending', delete a.file;
generate.forEach((a, i) => {
  if (i >= 12) return; // beyond two sheets: stays pending → fails like in the pipeline
  a.sheet = `sheet-${Math.floor(i / 6) + 1}.png`;
  a.status = 'generated';
});
const sheetCount = Math.min(2, Math.ceil(generate.length / 6));
const sheets = [];
for (let i = 0; i < sheetCount; i++) {
  const file = `sheet-${i + 1}.png`;
  if (!fs.existsSync(path.join(dir, file))) continue;
  const group = generate.filter(a => a.sheet === file);
  const placed = layoutGrid(group.length);
  sheets.push({ file, cells: group.map((a, j) => ({ assetId: a.id, ...placed[j] })) });
}
if (!sheets.length) { console.error('该 run 目录中没有拼板图片，无法 replay。'); process.exit(1); }

console.log(`replay ${runId}: ${sheets.length} 张拼板 · ${generate.length} 张待裁素材`);
const notes = [];
await cropSheets(sheets, persisted.assets, dir, t => notes.push(t));
const ready = persisted.assets.filter(a => a.status === 'ready');
const failed = persisted.assets.filter(a => a.status === 'failed');
console.log(`crop: ${ready.length}/${persisted.assets.length} 成功`);
for (const a of failed) console.log(`  失败 ${a.id}: ${a.note}`);
if (notes.length) console.log(`  提示: ${notes.join('；')}`);

// Rebuild products from analysis.json for the render step.
const analysis = JSON.parse(fs.readFileSync(path.join(dir, 'analysis.json'), 'utf8'));
const usable = analysis.products.filter(p => p.box);
persisted.products = usable.map((p, i) => {
  const file = `product-${i + 1}.png`;
  return { id: `product_${i + 1}`, name: p.name, file: fs.existsSync(path.join(dir, file)) ? file : '', ratio: [1, 1], status: fs.existsSync(path.join(dir, file)) ? 'ready' : 'failed', note: '' };
});
persisted.design = persisted.design || analysis.design;

const result = renderStore(persisted, dir);
console.log(`render: ${result.moduleCount} 个模块 · 页面高 ${Math.round(result.height)}px · 降级 ${result.degradations.length} 条`);
for (const d of result.degradations) console.log(`  - ${d}`);

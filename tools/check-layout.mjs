import { readFile } from 'node:fs/promises';
import { layoutSheet, panelsFromSheet } from '../src/assets.mjs';
import { validatePlan } from '../src/validate.mjs';

const dir = process.argv[2];
const plan = JSON.parse(await readFile(`${dir}/plan.json`, 'utf8'));
const check = validatePlan(plan);
const slotsById = new Map(check.slots.map(s => [s.slotId, s]));

for (const sheet of plan.design.imagePlan.images) {
  const panels = panelsFromSheet(sheet, slotsById);
  if (!panels.length) continue;
  const layout = layoutSheet(panels);
  console.log(`画布 ${sheet.id}: ${layout.width}×${layout.height}（${layout.rowCount} 行，总像素 ${layout.totalPixels}，宽高比 1:${layout.aspect}）`);
  console.log(`  是否符合模型规格: 总像素 ${layout.totalPixels >= 921600 && layout.totalPixels <= 4624220 ? '是' : '否'} · 宽高比 ${layout.aspect <= 16 ? '是' : '否'} · 偶数边长 ${layout.width % 2 === 0 && layout.height % 2 === 0 ? '是' : '否'}`);
  for (const [r, row] of layout.rows.entries()) {
    const heights = row.map(p => p.panelRect.height);
    console.log(`  第 ${r + 1} 行（${row.length} 格，高 ${Math.min(...heights)}~${Math.max(...heights)}，等高 ${new Set(heights).size === 1 ? '是' : '否'}）:`);
    for (const p of row) {
      const drawn = p.panelRect.width / p.panelRect.height;
      const err = Math.abs(drawn - p.ratio) / p.ratio;
      console.log(`    ${p.slotId.padEnd(12)} 目标比例 ${p.ratio.toFixed(3)} → 画布 ${p.panelRect.width}×${p.panelRect.height}（${drawn.toFixed(3)}，偏差 ${(err * 100).toFixed(1)}%）`);
    }
  }
}

/**
 * 生成「改进前 vs 改进后」的提示词对照，便于人工判断同质化是否解决。
 * 不调用任何模型。
 * 用法：node tools/compare-prompts.mjs <已有任务目录>
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { layoutSheet, buildSheetPrompt, panelsFromSheet, splitIntoSpanningSheets } from '../src/assets.mjs';
import { validatePlan } from '../src/validate.mjs';

const dir = process.argv[2];
const plan = JSON.parse(await readFile(`${dir}/plan.json`, 'utf8'));
const shop = JSON.parse(await readFile(`${dir}/shop.json`, 'utf8'));
const check = validatePlan(plan);
const slotsById = new Map(check.slots.map(s => [s.slotId, s]));

await mkdir('output/prompt-compare', { recursive: true });
for (const sheet of plan.design.imagePlan.images) {
  for (const part of splitIntoSpanningSheets(sheet, slotsById)) {
    if (!part.panels.length) continue;
    const layout = layoutSheet(part.panels);
    const prompt = buildSheetPrompt({ sheet, layout, design: plan.design, shop });
    const file = `output/prompt-compare/${part.id}-new.txt`;
    await writeFile(file, prompt, 'utf8');
    // 旧版提示词：从上一轮实际保存的文件里取（如果存在），否则跳过对比
    console.log(`\n${'='.repeat(78)}\n${part.id}  ${layout.width}×${layout.height}  ${part.panels.length} 格（角色：${[...new Set(part.panels.map(p => p.role))].join('/')}）`);
    console.log(`新版提示词长度 ${prompt.length} 字符 → ${file}`);
    const oldFile = `${dir}/sheets/${sheet.id}-prompt.txt`;
    try {
      const old = await readFile(oldFile, 'utf8');
      console.log(`旧版提示词长度 ${old.length} 字符 → ${oldFile}`);
    } catch { /* 上一轮可能已清理 */ }
  }
}

// 打印第一张新提示词的全文，便于直接阅读
const first = plan.design.imagePlan.images[0];
const parts = splitIntoSpanningSheets(first, slotsById);
const chosen = parts.find(p => p.panels.length > 1) || parts[0];
const layout = layoutSheet(chosen.panels);
const prompt = buildSheetPrompt({ sheet: first, layout, design: plan.design, shop });
console.log(`\n${'='.repeat(78)}\n新提示词全文（${chosen.id}）：\n${'='.repeat(78)}\n${prompt}`);

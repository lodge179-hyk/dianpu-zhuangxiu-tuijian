/**
 * 单独复跑「装修决策」这一步，把模型的原始输出落盘，便于诊断形状问题。
 * 只调用 1 次文本模型（不调用生图）。
 * 用法：node tools/repro-plan.mjs <已有任务目录>
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readEnv } from '../src/pipeline.mjs';
import { callTextModel } from '../src/analyze.mjs';
import { CATALOG, catalogPromptText } from '../src/catalog.mjs';
import { normalizePlan } from '../src/plan.mjs';
import { validatePlan } from '../src/validate.mjs';

const dir = process.argv[2];
const env = readEnv(process.env);
const shop = JSON.parse(await readFile(path.join(dir, 'shop.json'), 'utf8'));

// 复用 plan.mjs 里的同一套提示词
const planModule = await import('../src/plan.mjs');
const SYSTEM = await (async () => {
  const src = await readFile(new URL('../src/plan.mjs', import.meta.url), 'utf8');
  const m = src.match(/const SYSTEM = `([\s\S]*?)`;/);
  return m[1].replace('{catalog}', catalogPromptText(CATALOG));
})();

const user = [
  '商家店铺信息（来自截图识别）：',
  JSON.stringify(shop, null, 2),
  '',
  '请为这家店做装修决策，按约定输出 JSON 计划。',
  '记住：所有图片槽位都必须被分配，且每张图都要归入四种来源之一。',
].join('\n');

const { value, text } = await callTextModel(env, { system: SYSTEM, user, maxTokens: 6000, timeoutMs: 240_000 });
await writeFile(path.join(dir, 'plan-raw.txt'), text, 'utf8');
console.log('原始输出已写入 plan-raw.txt，长度', text.length);

const plan = normalizePlan(value, shop);
await writeFile(path.join(dir, 'plan-normalized.json'), JSON.stringify(plan, null, 2), 'utf8');
const check = validatePlan(plan);
console.log('\n校验：', check.ok ? '通过' : '失败');
if (!check.ok) check.errors.forEach(e => console.log('  ! ' + e));

console.log('\n模块形状：');
for (const m of plan.modules) {
  console.log(`  ${m.id} ${m.type}`);
  console.log(`    content: ${JSON.stringify(m.content).slice(0, 200)}`);
  console.log(`    images : ${JSON.stringify(m.images).slice(0, 200)}`);
}
console.log('\n生图计划：');
for (const img of plan.design.imagePlan.images) {
  console.log(`  ${img.id}: ${img.slots.length} 格 ${img.slots.map(s => s.slotId).join(',')}`);
}

import { readFile } from 'node:fs/promises';
import { parseJsonLoose } from '../src/analyze.mjs';
import { normalizePlan } from '../src/plan.mjs';
import { validatePlan } from '../src/validate.mjs';
import { MODULE_BY_TYPE } from '../src/catalog.mjs';

const dir = process.argv[2];
const value = parseJsonLoose(await readFile(`${dir}/plan-raw.txt`, 'utf8'));
const shop = JSON.parse(await readFile(`${dir}/shop.json`, 'utf8'));
const plan = normalizePlan(value, shop);
const check = validatePlan(plan);

console.log('校验：', check.ok ? '通过' : '失败');
check.errors.forEach(e => console.log('  ! ' + e));

console.log('\n模块一览（类型 / 槽位数 / 计划图片数 / content 形状）：');
for (const m of plan.modules) {
  const spec = MODULE_BY_TYPE.get(m.type);
  const items = Array.isArray(m.content?.items) ? m.content.items.length : null;
  const imgs = Array.isArray(m.content?.images) ? m.content.images.length : null;
  console.log(`  ${m.id.padEnd(5)} ${m.type.padEnd(22)} 槽位=${spec?.slotCount ?? '?'} 容量=${spec ? spec.capacity.min + '-' + spec.capacity.max : '?'} images=${imgs ?? '—'} items=${items ?? '—'} 声明=${m.images.length}`);
}
console.log('\n生图计划：');
for (const img of plan.design.imagePlan.images) console.log(`  ${img.id}: ${img.slots.length} 格 → ${img.slots.map(s => s.slotId).join(',')}`);
console.log('\n哪些槽位需要生成但没进生图计划：');
const planned = new Set(plan.design.imagePlan.images.flatMap(i => i.slots.map(s => s.slotId)));
for (const s of check.slots) if (s.source !== 'product-photo' && !planned.has(s.slotId)) console.log(`  ${s.slotId} (${s.moduleType})`);

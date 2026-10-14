import { readFile } from 'node:fs/promises';
import { parseJsonLoose } from '../src/analyze.mjs';
import { normalizePlan } from '../src/plan.mjs';
import { MODULE_BY_TYPE } from '../src/catalog.mjs';

const raw = await readFile(process.argv[2] + '/plan-raw.txt', 'utf8');
const shop = JSON.parse(await readFile(process.argv[2] + '/shop.json', 'utf8'));
const plan = normalizePlan(parseJsonLoose(raw), shop);

// 完全复刻 validate.mjs 的 collectSlotIds
function collectSlotIds(module_, spec) {
  const content = module_.content || {};
  if (spec.group === '商品橱窗') {
    const items = Array.isArray(content.items) ? content.items : [];
    return items.map(item => (typeof item?.image === 'string' ? item.image : ''));
  }
  if (spec.group === '公告与文本') return [];
  if (spec.group === '店铺招牌') {
    const ids = [];
    if (spec.type !== 'signboard.minimal') ids.push(typeof content.background === 'string' ? content.background : '');
    ids.push(typeof content.shop?.avatar === 'string' ? content.shop.avatar : '');
    return ids;
  }
  return Array.isArray(content.images) ? content.images.map(i => (typeof i === 'string' ? i : i?.src || '')) : [];
}

const seen = new Map();
for (const m of plan.modules) {
  const spec = MODULE_BY_TYPE.get(m.type);
  if (!spec) { console.log(`${m.id}: 未知类型`); continue; }
  const ids = collectSlotIds(m, spec);
  console.log(`${m.id} ${m.type} (${spec.group}) → ${JSON.stringify(ids)}  content键=[${Object.keys(m.content || {}).join(',')}]`);
  for (const id of ids) {
    if (seen.has(id)) console.log(`    !! ${id} 已在 ${seen.get(id)} 用过`);
    else seen.set(id, m.id);
  }
}

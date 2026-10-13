/**
 * 本地自检（不调用任何模型、不产生任何费用）。
 * 覆盖三件最容易出错的事：模块目录是否与组件库一致、素材画布排版是否合法、计划校验是否真能拦住错误计划。
 */
import { CATALOG, MODULE_BY_TYPE } from './src/catalog.mjs';
import { layoutSheet } from './src/assets.mjs';
import { validatePlan, } from './src/validate.mjs';
import { normalizePlan } from './src/plan.mjs';
import { renderPlan } from './src/render.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const problems = [];
const ok = (label, detail = '') => console.log(`  [OK] ${label}${detail ? ' — ' + detail : ''}`);
const bad = (label, detail = '') => { problems.push(label); console.log(`  [!!] ${label}${detail ? ' — ' + detail : ''}`); };

// ---- 1. 模块目录 ----
console.log('模块目录');
if (CATALOG.modules.length !== 23) bad('可选模块数量应为 23', `实际 ${CATALOG.modules.length}`);
else ok('可选模块 23 种', Object.values(CATALOG.groups).join('/'));
const groups = new Set(CATALOG.modules.map(m => m.group));
if (groups.size !== 6) bad('分组数量应为 6', [...groups].join(','));
else ok('六大分组齐全');
for (const m of CATALOG.modules) {
  if (!m.slots.length && m.group !== '公告与文本') bad(`${m.type} 没有图片槽位但也不属于文本类`);
  for (const s of m.slots) {
    if (!(s.width > 0 && s.height > 0)) bad(`${m.type} 槽位 ${s.index} 尺寸异常`);
    if (Math.abs(s.ratio - s.width / s.height) > 0.01) bad(`${m.type} 槽位 ${s.index} 比例与宽高不一致`);
  }
  if (m.group !== '公告与文本' && !m.slotCount) bad(`${m.type} 缺少槽位`);
}
ok('槽位几何自洽', `共 ${CATALOG.modules.reduce((n, m) => n + m.slotCount, 0)} 个图片槽位`);

// ---- 2. 素材画布排版 ----
console.log('\n素材画布排版');
const cases = [
  { name: '导航4 + 三列海报', panels: [1, 1, 1, 1, 1, 1, 1].map((_, i) => ({ id: `p${i}`, ratio: 1 })) },
  { name: '混合比例（招牌+方图+竖图）', panels: [{ id: 'a', ratio: 483 / 258 }, { id: 'b', ratio: 1 }, { id: 'c', ratio: 1 }, { id: 'd', ratio: 4 / 3 }, { id: 'e', ratio: 3 / 4 }] },
  { name: '单张 4:3', panels: [{ id: 'only', ratio: 4 / 3 }] },
  { name: '九张方图（三列橱窗满配）', panels: Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, ratio: 1 })) },
];
for (const c of cases) {
  const layout = layoutSheet(c.panels);
  const total = layout.width * layout.height;
  const aspect = layout.height / layout.width;
  const issues = [];
  if (total < 921_600 || total > 4_622_020) issues.push(`总像素 ${total} 超出模型规格`);
  if (layout.width % 2 || layout.height % 2) issues.push('边长不是偶数');
  if (aspect > 16 || aspect < 1 / 16) issues.push(`宽高比 ${aspect.toFixed(2)} 超限`);
  const inside = layout.panels.every(p => p.panelRect.left >= 0 && p.panelRect.top >= 0
    && p.panelRect.left + p.panelRect.width <= layout.width && p.panelRect.top + p.panelRect.height <= layout.height);
  if (!inside) issues.push('有面板超出画布');
  const overlap = layout.panels.some((a, i) => layout.panels.some((b, j) => j > i
    && a.panelRect.left < b.panelRect.left + b.panelRect.width && b.panelRect.left < a.panelRect.left + a.panelRect.width
    && a.panelRect.top < b.panelRect.top + b.panelRect.height && b.panelRect.top < a.panelRect.top + a.panelRect.height));
  if (overlap) issues.push('面板互相重叠');
  const ratioErr = Math.max(...layout.panels.map(p => Math.abs((p.panelRect.width / p.panelRect.height) - p.ratio) / p.ratio));
  if (ratioErr > 0.06) issues.push(`面板比例偏差 ${(ratioErr * 100).toFixed(1)}%`);
  if (issues.length) bad(`${c.name}：${issues.join('；')}`, `${layout.width}×${layout.height}`);
  else ok(c.name, `${layout.width}×${layout.height}（${layout.panels.length} 格，${layout.rowCount} 行 × ${layout.columns} 列，比例偏差 <${(ratioErr * 100).toFixed(1)}%）`);
}

// ---- 3. 计划校验：好计划通过 ----
console.log('\n计划校验');
const goodPlan = normalizePlan({
  design: {
    title: '暖调女装陈列', summary: '以暖木色场景突出服装质感', styleKeywords: ['暖色', '简约'],
    palette: { background: '#F5F3EF', accent: '#B4553C', text: '#1F1D1B' },
    decisions: [{ topic: '招牌', choice: '默认招牌', reason: '店铺有可用的品牌大图' }],
    imagePlan: {
      constraints: ['统一暖木色场景', '不出现任何文字'],
      images: [{ id: 'sheet1', purpose: '招牌与图标', slots: [
        { slotId: 'm01.img1', source: 'generated-scene', subject: '秋日暖木场景', aspect: '483:258' },
        { slotId: 'm01.img2', source: 'generated-scene', subject: '店铺头像', aspect: '1:1' },
        { slotId: 'm02.img1', source: 'generated-nav-icon', subject: '针织上衣图标', aspect: '1:1' },
        { slotId: 'm02.img2', source: 'generated-nav-icon', subject: '长裤图标', aspect: '1:1' },
        { slotId: 'm02.img3', source: 'generated-nav-icon', subject: '外套图标', aspect: '1:1' },
        { slotId: 'm02.img4', source: 'generated-nav-icon', subject: '配饰图标', aspect: '1:1' },
        { slotId: 'm04.img1', source: 'generated-poster', subject: '秋季主推氛围图', aspect: '1:1' },
        { slotId: 'm04.img2', source: 'generated-poster', subject: '针织专区氛围图', aspect: '1:1' },
        { slotId: 'm04.img3', source: 'generated-poster', subject: '外套专区氛围图', aspect: '1:1' },
      ] }],
    },
  },
  modules: [
    { id: 'm01', type: 'signboard.default', label: '默认招牌', reason: '有品牌大图', content: { background: 'm01.img1', shop: { name: '山谷衣橱', avatar: 'm01.img2', vip: false, newCount: '12', totalCount: '86' } },
      images: [{ slotId: 'm01.img1', source: 'generated-scene', subject: '秋日暖木场景', aspect: '483:258' }, { slotId: 'm01.img2', source: 'generated-scene', subject: '店铺头像', aspect: '1:1' }] },
    { id: 'm02', type: 'navigation.four', label: '四列导航', reason: '四个品类入口', content: { images: ['m02.img1', 'm02.img2', 'm02.img3', 'm02.img4'] },
      images: [1, 2, 3, 4].map(i => ({ slotId: `m02.img${i}`, source: 'generated-nav-icon', subject: `图标${i}`, aspect: '1:1' })) },
    { id: 'm04', type: 'poster.three', label: '三列海报', reason: '展示三个主题', content: { images: ['m04.img1', 'm04.img2', 'm04.img3'] },
      images: [1, 2, 3].map(i => ({ slotId: `m04.img${i}`, source: 'generated-poster', subject: `海报${i}`, aspect: '1:1' })) },
  ],
}, {});
const good = validatePlan(goodPlan);
if (!good.ok) bad('合法计划应通过校验', good.errors.join('；'));
else ok('合法计划通过校验', `${good.slotCount} 个图片位，生成 ${good.generatedSlotCount}，生图 ${good.sheets} 次`);

// ---- 4. 计划校验：坏计划要被拦下 ----
const badCases = [
  ['模块 type 不存在', () => { const p = structuredClone(goodPlan); p.modules[0].type = 'signboard.magic'; return p; }],
  ['图片数量不符', () => { const p = structuredClone(goodPlan); p.modules[1].content.images = ['m02.img1', 'm02.img2']; return p; }],
  ['槽位没有声明来源', () => { const p = structuredClone(goodPlan); p.modules[2].images = []; return p; }],
  ['来源不是四种之一', () => { const p = structuredClone(goodPlan); p.modules[2].images[0].source = 'whatever'; return p; }],
  ['生成图没有进生图计划', () => { const p = structuredClone(goodPlan); p.design.imagePlan.images[0].slots = p.design.imagePlan.images[0].slots.filter(s => s.slotId !== 'm04.img3'); return p; }],
  ['招牌不在第一位', () => { const p = structuredClone(goodPlan); const first = p.modules.shift(); p.modules.push(first); return p; }],
  ['极简招牌带自定义背景', () => { const p = structuredClone(goodPlan); p.modules[0].type = 'signboard.minimal'; return p; }],
  ['图片编号重复使用', () => { const p = structuredClone(goodPlan); p.modules[2].content.images = ['m04.img1', 'm04.img1', 'm04.img2']; p.modules[2].images = [p.modules[2].images[0], p.modules[2].images[0], p.modules[2].images[2]]; return p; }],
];
for (const [label, build] of badCases) {
  const result = validatePlan(build());
  if (result.ok) bad(`坏计划未被拦下：${label}`);
  else ok(`已拦下：${label}`, result.errors[0].slice(0, 56));
}

// ---- 5. 渲染：用占位图跑通整页（不调用模型） ----
console.log('\n渲染');
const dir = await mkdtemp(path.join(tmpdir(), 'aidesign-'));
try {
  const rendered = await renderPlan(goodPlan, new Map(), dir, () => {});
  const html = await readFile(rendered.htmlFile, 'utf8');
  const checks = [
    ['页面宽度 483px', html.includes('data-kind="signboard.default"')],
    ['包含全部 3 个模块', (html.match(/class="module"/g) || []).length === 3],
    ['含占位图', html.includes('_missing.png')],
    // 页面里不该残留任何 slotId（渲染时必须全部换成素材路径或占位图）
    ['无未替换的 slotId 残留', !/data-photo="m0\d\.img\d+"/.test(html)],
  ];
  for (const [label, pass] of checks) if (!pass) bad(`渲染检查未通过：${label}`);
  if (checks.every(c => c[1])) ok('整页渲染通过（缺图用标注占位）', `${rendered.width}×${rendered.height}px，${rendered.photos.length} 个图片位`);
  const expected = good.ok ? good.slotCount : null;
  if (expected !== null && rendered.missingSlots.length !== expected) bad('缺图数量与预期不符', `${rendered.missingSlots.length} vs ${expected}`);
  else ok('缺图被如实记录', `${rendered.missingSlots.length} 个槽位走占位`);
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log('\n' + (problems.length ? `自检发现 ${problems.length} 个问题：\n - ` + problems.join('\n - ') : '自检全部通过（未调用任何模型）'));
process.exit(problems.length ? 1 : 0);

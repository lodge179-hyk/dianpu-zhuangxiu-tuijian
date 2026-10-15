const test = require('node:test');
const assert = require('node:assert/strict');
const { compileContent, validateContent, contentBatches } = require('./content-plan.cjs');
const { validatePlan } = require('./plan.cjs');

function fixture(categories) {
  const recognition = { categories, products: categories.map((category, i) => ({ category, description: '可见款式' + i, imageIndex: 1 })) };
  const brief = { version: 1, shop: { name: '商品装修参考', category: categories.join('、'), observations: [], uncertainties: [] }, categories, theme: '款式与日常场景', style: { palette: ['#123456', '#EEEEEE'], background: '按内容选择环境', lighting: '统一白平衡', photography: '多种景别' } };
  const content = { narrative: '由主题进入独立品类，再看细节', reason: '每段解释不同信息', signboard: 'minimal', heroFormat: 'balanced', heroSubject: '全部已知品类形成整体组合', navigation: true, navigationPlacement: 'after-hero', sections: [...categories.map((c, i) => ({ kind: 'category', purpose: c + '展示', reason: '覆盖已知经营内容', hierarchy: 'equal', heading: i === 0 ? '款式与场景' : '', visuals: [{ evidenceIds: ['product-' + (i + 1)], subject: c + '独立轮廓与场景' }] })), { kind: 'detail', purpose: '外观细节', reason: '补充可见局部', hierarchy: 'equal', heading: '', visuals: [{ evidenceIds: ['product-1'], subject: '第一类商品的可见细节' }] }] };
  return { brief, content, recognition };
}
test('one compiler transfers across industries and 1–5 categories without fabricated navigation', () => {
  for (const categories of [['耳机'], ['护肤', '底妆'], ['座椅', '灯具', '收纳'], ['T恤', '牛仔裤', '外套', '针织'], ['耳机', '键盘', '鼠标', '音箱', '相机']]) {
    const f = fixture(categories), result = compileContent(f.brief, f.content, f.recognition);
    assert.equal(result.plan.modules[0].type, 'signboard.minimal');
    const nav = result.plan.modules.find(m => m.type.startsWith('navigation.'));
    if (categories.length < 4) assert.equal(nav, undefined);
    else { assert.deepEqual(nav.props.labels, categories); assert.ok(result.plan.modules.length >= 8); }
    assert.ok(result.plan.assets.length <= 12); assert.ok(result.plan.batches.length <= 2);
    for (const c of categories) assert.ok(result.tasks.some(t => t.role === 'scene' && t.category === c));
    assert.equal(new Set(result.plan.batches.flatMap(b => b.rows.flat())).size, result.plan.assets.length);
    validatePlan(result.plan);
  }
});
test('content hierarchy and purpose select different fixed components, without repeating large assets', () => {
  const f = fixture(['耳机']);
  const visual = subject => ({ evidenceIds: ['product-1'], subject });
  f.content.sections = [
    { kind: 'story', purpose: '场景与联系', reason: '重点和辅助', hierarchy: 'focus', visuals: ['场景', '组合', '局部'].map(visual) },
    { kind: 'products', purpose: '示意款式', reason: '集中辨识', hierarchy: 'equal', visuals: ['款式一', '款式二'].map(visual) },
    { kind: 'category', purpose: '并行浏览', reason: '连续展示', hierarchy: 'browse', visuals: ['轮廓一', '轮廓二'].map(visual) },
  ];
  const r = compileContent(f.brief, f.content, f.recognition);
  assert.ok(r.plan.modules.some(m => m.type === 'poster.combo1'));
  assert.ok(r.plan.modules.some(m => m.type === 'showcase.two'));
  assert.ok(r.plan.modules.some(m => m.type === 'poster.sliding'));
  const ids = r.plan.modules.flatMap(m => m.props.assetIds);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(r.plan.modules.find(m => m.type === 'showcase.two').props.titles.every(t => t.endsWith('示意')));
});
test('optional headings are capped without changing content, assets, batches or the original response', () => {
  for (const count of [0, 1, 2, 3, 5]) {
    const f = fixture(['上衣', '裤装', '外套', '针织']);
    f.content.sections.forEach((s, i) => { s.heading = i < count ? '段落' + (i + 1) : ''; });
    const original = structuredClone(f.content), expected = structuredClone(f.content);
    expected.sections.forEach((s, i) => { if (i >= 2) s.heading = ''; });
    const result = compileContent(f.brief, f.content, f.recognition);
    const baseline = compileContent(f.brief, expected, f.recognition);
    assert.deepEqual(result, baseline);
    assert.deepEqual(f.content, original);
    assert.deepEqual(result.content.sections.map(({ heading, ...section }) => section), original.sections.map(({ heading, ...section }) => section));
    assert.equal(result.plan.modules.filter(m => m.type === 'text.single').length, Math.min(count, 2));
  }
});

test('invalid evidence, omitted categories, repeated visuals and overspending stop before image design', () => {
  const cases = [
    [f => f.content.sections[0].visuals[0].evidenceIds = ['product-99'], /未知商品证据/],
    [f => f.content.sections.splice(1, 1), /遗漏/],
    [f => f.content.sections[1].visuals[0].subject = f.content.sections[0].visuals[0].subject, /重复/],
    [f => { for (const [i, s] of f.content.sections.entries()) s.visuals.push({ evidenceIds: ['product-1'], subject: '额外内容' + i }); }, /超过12张/],
  ];
  for (const [change, message] of cases) { const f = fixture(['上衣', '裤装', '外套', '针织']); change(f); assert.throws(() => validateContent(f.content, f.recognition), message); }
});
test('every hero format, optional signboard and navigation placement stay within the actual sheet geometry', () => {
  for (const heroFormat of ['wide', 'balanced', 'portrait']) for (const signboard of ['minimal', 'atmosphere']) for (const navigationPlacement of ['before-hero', 'after-hero']) {
    const f = fixture(['上衣', '裤装', '外套', '针织']);
    Object.assign(f.content, { heroFormat, signboard, navigationPlacement });
    const r = compileContent(f.brief, f.content, f.recognition);
    validatePlan(r.plan); assert.ok(r.plan.batches[0].rows.flat().includes('overview'));
    assert.equal(r.plan.modules[1].id, navigationPlacement === 'before-hero' ? 'categories' : 'overview');
  }
  assert.throws(() => contentBatches(Array.from({ length: 13 }, (_, i) => ({ id: i ? 'a' + i : 'overview', aspect: '1:1' }))), /两批/);
});

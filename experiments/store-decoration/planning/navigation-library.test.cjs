const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { categoryFor, resolveNavigation, assetFile } = require('./navigation-library.cjs');
const { navigationExamplePlan } = require('./navigation-example.cjs');
const { compose } = require('./compose.cjs');
const { cropBatch } = require('./crop.cjs');
const { validatePlan, buildBatches } = require('./plan.cjs');

function workspace(t) {
  const root = path.resolve(__dirname, 'output'); fs.mkdirSync(root, { recursive: true });
  const folder = fs.mkdtempSync(path.join(root, 'navigation-test-'));
  t.after(() => { if (!path.resolve(folder).startsWith(root + path.sep)) throw Error('Unsafe cleanup path'); fs.rmSync(folder, { recursive: true, force: true }); });
  return folder;
}

test('recognizes exact category aliases without inventing unsupported categories', () => {
  assert.equal(categoryFor('衬衣').id, 'shirts'); assert.equal(categoryFor('Ｔ-shirt').id, 'tops');
  for (const label of ['鞋包', '半身裙', '衬衫/上衣', '童装', '男装', '毛衣']) assert.equal(categoryFor(label), undefined);
});

test('selects different style variants automatically and respects explicit style', () => {
  const clean = resolveNavigation(navigationExamplePlan('clean')), warmPlan = navigationExamplePlan('warm');
  const warm = resolveNavigation(warmPlan);
  assert.equal(clean.style.id, 'clean'); assert.equal(warm.style.id, 'warm');
  assert.equal(clean.matched.length, 4); assert.equal(warm.matched.length, 4);
  assert.ok(clean.matched.every(a => a.libraryId.startsWith('clean-')));
  assert.ok(warm.matched.every(a => a.libraryId.startsWith('warm-')));
  warmPlan.navigationLibrary.style = 'clean'; assert.equal(resolveNavigation(warmPlan).style.id, 'clean');
});

test('all-library navigation is ready with zero generation batches and real copied assets', async t => {
  const folder = workspace(t), compiled = compose(folder, navigationExamplePlan());
  assert.equal(compiled.batches.length, 0); assert.equal(compiled.metrics.generationCalls, 0);
  assert.equal(compiled.metrics.libraryAssets, 4); assert.equal(compiled.metrics.generatedAssets, 0);
  for (const m of compiled.navigationLibrary.matched) {
    const copied = fs.readFileSync(path.join(folder, 'assets', m.assetId + '.png'));
    assert.deepEqual(copied, fs.readFileSync(assetFile(m.libraryId)));
    const meta = await sharp(copied).metadata(); assert.ok(meta.width > 100 && meta.width === meta.height);
  }
  assert.ok(fs.readFileSync(path.join(folder, 'shop.html'), 'utf8').includes('assets/nav-shirts.png'));
});

test('unknown category stays in reduced generation batch and crop import preserves library assets', async t => {
  const folder = workspace(t), plan = navigationExamplePlan();
  plan.modules[1].props.labels[0] = '鞋履'; plan.assets.find(a => a.id === 'nav-shirts').subject = '一双无标识运动鞋';
  const compiled = compose(folder, plan), batch = compiled.batches[0];
  assert.equal(compiled.metrics.libraryAssets, 3); assert.equal(compiled.metrics.generatedAssets, 1);
  assert.deepEqual(batch.rows, [['nav-shirts']]); assert.equal(batch.referenceBatchId, null);
  assert.equal(compiled.navigationLibrary.unmatched[0].uses[0].label, '鞋履');
  assert.ok(!batch.prompt.includes('panel 1 (nav-tops)'));
  const before = fs.readFileSync(path.join(folder, 'assets/nav-tops.png'));
  const panel = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#eeeeee' } }).png().toBuffer();
  const sheet = await sharp({ create: { width: 280, height: 280, channels: 3, background: '#ff00ff' } }).composite([{ input: panel, top: 12, left: 12 }]).png().toBuffer();
  const report = await cropBatch(sheet, plan, batch.id, folder, batch);
  assert.deepEqual(report.crops.map(c => c.assetId), ['nav-shirts']);
  const result = compose(folder, plan); assert.equal(result.libraryAssetIds.length, 3);
  assert.deepEqual(fs.readFileSync(path.join(folder, 'assets/nav-tops.png')), before);
  assert.ok((await sharp(path.join(folder, 'assets/nav-shirts.png')).metadata()).width > 100);
});

test('large editorial reuse and missing library files fall back to generation', () => {
  const plan = navigationExamplePlan();
  plan.modules.push({ id: 'hero', type: 'poster.single', purpose: '独立海报', props: { assetIds: ['nav-shirts'], text: '', labels: [], titles: [] } });
  validatePlan(plan); const selection = resolveNavigation(plan);
  assert.equal(selection.matched.length, 3); assert.match(selection.unmatched[0].reason, /大画面/);
  const unavailable = resolveNavigation(navigationExamplePlan(), () => false);
  assert.equal(unavailable.matched.length, 0); assert.equal(unavailable.unmatched.length, 4);
  assert.equal(buildBatches(navigationExamplePlan(), []).flatMap(b => b.rows.flat()).length, 4);
});

test('old plans remain unchanged and pending references skip removed library batches', () => {
  const plan = navigationExamplePlan(); delete plan.navigationLibrary;
  assert.equal(resolveNavigation(plan).enabled, false); assert.equal(validatePlan(plan).metrics.generationCalls, 1);
  plan.batches = [{ id: 'nav-first', rows: [['nav-tops', 'nav-shirts']] }, { id: 'remaining', rows: [['nav-pants', 'nav-dresses']] }];
  validatePlan(plan); const batches = buildBatches(plan, ['nav-tops', 'nav-shirts']);
  assert.equal(batches.length, 1); assert.equal(batches[0].id, 'remaining'); assert.equal(batches[0].referenceBatchId, null);
});

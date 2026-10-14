const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { once } = require('events');
const { unzipSync } = require('fflate');
const sharp = require('sharp');
const { exampleBrief, recommendPlan, validateBrief, manualBrief, briefFromPlan } = require('./structure.cjs');
const { examplePlan } = require('./example.cjs');
const { compose } = require('./compose.cjs');
const { fillStructureExample } = require('./structure-example.cjs');
const { materialsZip } = require('./download.cjs');
const { structurePrompt, planScreenshot } = require('./planner.cjs');
const { cropBatch } = require('./crop.cjs');
const { aspectRatios } = require('./plan.cjs');

function workspace(t) {
  const root = path.resolve(__dirname, 'output'); fs.mkdirSync(root, { recursive: true });
  const folder = fs.mkdtempSync(path.join(root, 'structure-test-'));
  t.after(() => { if (!path.resolve(folder).startsWith(root + path.sep)) throw Error('Unsafe cleanup'); fs.rmSync(folder, { recursive: true, force: true }); });
  return folder;
}
test('one recommendation covers all known categories within module, image and batch constraints', () => {
  for (const example of ['beauty', 'apparel']) for (let n = 2; n <= 5; n++) {
    const brief = exampleBrief(example); brief.categories = [...brief.categories, '其他明确品类'].slice(0, n);
    const snapshot = JSON.stringify(brief), result = recommendPlan(brief), { plan, metrics, warnings, recommendation } = result;
    assert.equal(JSON.stringify(brief), snapshot);
    assert.equal(result.candidates, undefined); assert.equal(result.plans, undefined);
    assert.ok(metrics.uniqueAssets <= 12 && metrics.generationCalls <= 2);
    assert.equal(warnings.length, 0); assert.deepEqual(plan.shop, brief.shop);
    assert.equal(recommendation.decisions.length, plan.modules.length);
    for (let i = 1; i <= n; i++) assert.ok(plan.modules.some(m => m.props.assetIds.includes('scene-' + i)));
    assert.equal(plan.modules.some(m => m.type.startsWith('navigation.')), n >= 4);
    assert.equal(plan.modules.some(m => m.id === 'category-copy'), n < 4);
    assert.ok(!plan.modules.some(m => m.type === 'text.single'));
    assert.ok(recommendation.sources.length > 0);
  }
});
test('a proposed theme is not evidence of merchandising priority; real priority controls focus', () => {
  const brief = exampleBrief('beauty'); brief.theme = '以香氛为主视觉的设计提案';
  assert.equal(recommendPlan(brief).recommendation.recipeId, 'category-first');
  const focused = recommendPlan({ ...brief, featuredCategory: { name: '香氛', evidence: '截图横幅明确写着香氛专题' } });
  assert.equal(focused.recommendation.recipeId, 'theme-first');
  assert.equal(focused.plan.modules[1].type, 'carousel.medium');
  assert.equal(focused.plan.modules.find(m => m.type.startsWith('navigation.')).props.labels[0], '香氛');
  assert.match(focused.plan.assets.find(a => a.id === 'detail').subject, /^香氛/);
  const small = recommendPlan({ ...brief, categories: ['护肤', '底妆'] });
  assert.equal(small.recommendation.density, 'compact'); assert.equal(small.plan.assets.length, 3);
  assert.equal(small.plan.modules[1].type, 'carousel.small');
});
test('invalid or ambiguous briefs do not silently gain invented categories', () => {
  const brief = exampleBrief('beauty');
  for (const categories of [[], ['护肤', '护肤'], ['A', 'Ｂ', 'b'], ['A', 'B', 'C', 'D', 'E', 'F']]) assert.throws(() => validateBrief({ ...brief, categories }));
  assert.throws(() => validateBrief({ ...brief, featuredCategory: { name: '鞋子', evidence: '错误资料' } }), /主推品类/);
  assert.throws(() => manualBrief({ name: '', categories: '上衣、衬衫' }), /资料/);
  const custom = manualBrief({ name: '<测试店>', categories: '工具、家居', theme: '居家片刻' });
  assert.deepEqual(custom.categories, ['工具', '家居']);
  assert.ok(!recommendPlan(custom).plan.assets.some(a => /梳妆|护肤/.test(a.subject)));
  recommendPlan({ ...brief, theme: '主题'.repeat(50), categories: Array.from({ length: 5 }, (_, i) => String(i) + '品'.repeat(19)), style: { ...brief.style, background: '景'.repeat(200) } });
});
test('legacy plans remain unchanged when their known categories are used as new input', () => {
  const plan = examplePlan(), snapshot = JSON.stringify(plan), brief = briefFromPlan(plan);
  assert.equal(JSON.stringify(plan), snapshot); assert.deepEqual(brief.categories, ['服饰', '鞋履', '包袋', '针织']);
  assert.match(structurePrompt(), /不安排模块/); assert.match(structurePrompt(), /不能作为主推证据/);
  assert.equal(brief.featuredCategory, null);
});
test('beauty example is downloadable without generation; apparel reuses only matching navigation', async t => {
  const folder = workspace(t), { plan } = recommendPlan(exampleBrief('beauty'));
  const filled = fillStructureExample(folder, { exampleId: 'beauty' }, plan);
  assert.equal(filled.length, plan.assets.length);
  const compiled = compose(folder, plan);
  const archive = unzipSync(await materialsZip(folder, { ...compiled, status: 'ready', filledAssets: filled }));
  assert.ok(archive['素材对照.json']); assert.ok(archive['店铺预览/shop.html']);
  const apparel = recommendPlan(exampleBrief('apparel')), clothes = compose(workspace(t), apparel.plan);
  assert.equal(clothes.libraryAssetIds.length, 4); assert.equal(clothes.metrics.generatedAssets, 6);
  await assert.rejects(materialsZip(folder, { ...clothes, status: 'ready', filledAssets: clothes.libraryAssetIds }), /未填入/);
});
test('screenshot analysis makes one request, validates only a brief and does not retry bad output', async t => {
  const oldFetch = global.fetch, keys = ['ARK_RESPONSES_ENDPOINT', 'ARK_API_KEY', 'ARK_VISION_MODEL'];
  const original = keys.map(k => process.env[k]);
  t.after(() => { global.fetch = oldFetch; keys.forEach((k, i) => { if (original[i] === undefined) delete process.env[k]; else process.env[k] = original[i]; }); });
  Object.assign(process.env, { ARK_RESPONSES_ENDPOINT: 'https://example.invalid', ARK_API_KEY: 'test-only', ARK_VISION_MODEL: 'test-only' });
  const bytes = await sharp({ create: { width: 100, height: 200, channels: 3, background: '#eee' } }).png().toBuffer();
  let calls = 0, responseText = JSON.stringify(exampleBrief('beauty'));
  global.fetch = async () => { calls++; return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: responseText }] }], usage: { total_tokens: 1 } }) }; };
  const good = await planScreenshot(bytes, workspace(t), { structure: true });
  assert.equal(calls, 1); assert.ok(good.brief); assert.equal(good.plan, undefined);
  responseText = '{"error":"无法可靠识别至少两个经营品类"}';
  await assert.rejects(planScreenshot(bytes, workspace(t), { structure: true }), /无法可靠识别/);
  assert.equal(calls, 2);
  responseText = '{"version":1}';
  await assert.rejects(planScreenshot(bytes, workspace(t), { structure: true }), /资料不完整/);
  assert.equal(calls, 3);
});
test('provider billing failures are actionable, redacted and never automatically retried', async t => {
  const oldFetch = global.fetch, keys = ['ARK_RESPONSES_ENDPOINT', 'ARK_API_KEY', 'ARK_VISION_MODEL'];
  const original = keys.map(k => process.env[k]);
  t.after(() => { global.fetch = oldFetch; keys.forEach((k, i) => { if (original[i] === undefined) delete process.env[k]; else process.env[k] = original[i]; }); });
  Object.assign(process.env, { ARK_RESPONSES_ENDPOINT: 'https://example.invalid', ARK_API_KEY: 'test-secret-value', ARK_VISION_MODEL: 'test-only' });
  const bytes = await sharp({ create: { width: 100, height: 200, channels: 3, background: '#eee' } }).png().toBuffer();
  const folder = workspace(t); let calls = 0;
  global.fetch = async () => { calls++; return { ok: false, status: 403, json: async () => ({ error: { code: 'AccountOverdueError', message: 'Overdue account; test-secret-value\n' } }) }; };
  await assert.rejects(planScreenshot(bytes, folder, { structure: true }), error => /账号欠费/.test(error.message) && /手动重新提交/.test(error.message) && !error.message.includes('test-secret-value'));
  assert.equal(calls, 1);
  const audit = JSON.parse(fs.readFileSync(path.join(folder, 'planner-call.json'), 'utf8'));
  assert.equal(audit.httpStatus, 403); assert.equal(audit.errorCode, 'AccountOverdueError');
  assert.equal(audit.automaticRetries, 0); assert.equal(audit.requestAttempts, 1);
  assert.match(audit.errorMessage, /已隐藏/); assert.ok(!audit.errorMessage.includes('test-secret-value'));
  global.fetch = async () => { calls++; return { ok: false, status: 502, json: async () => { throw Error('not JSON'); } }; };
  await assert.rejects(planScreenshot(bytes, workspace(t), { structure: true }), /HTTP 502；没有自动重试/);
  assert.equal(calls, 2);
  global.fetch = async () => { calls++; return { ok: false, status: 403, json: async () => ({ error: { code: '<script>test-secret-value</script>', message: 'Untrusted provider instructions' } }) }; };
  await assert.rejects(planScreenshot(bytes, workspace(t), { structure: true }), error => error.message === '规划服务返回HTTP 403；没有自动重试。');
  assert.equal(calls, 3);
});

test('new batch layout crops back into its slots while retaining copied navigation', async t => {
  const folder = workspace(t), { plan } = recommendPlan(exampleBrief('apparel'));
  const compiled = compose(folder, plan), assets = new Map(plan.assets.map(a => [a.id, a]));
  const filled = [...compiled.libraryAssetIds], original = fs.readFileSync(path.join(folder, 'assets', filled[0] + '.png'));
  for (const batch of compiled.batches) {
    const width = 960, gap = 12, layers = []; let top = gap;
    for (const row of batch.rows) {
      const cellWidth = Math.floor((width - gap * (row.length + 1)) / row.length);
      const height = Math.round(cellWidth / aspectRatios[assets.get(row[0]).aspect]);
      for (let i = 0; i < row.length; i++) layers.push({ top, left: gap + i * (cellWidth + gap), input: await sharp({ create: { width: cellWidth, height, channels: 3, background: i % 2 ? '#ccd5cf' : '#d8d2c5' } }).png().toBuffer() });
      top += height + gap;
    }
    const sheet = await sharp({ create: { width, height: top, channels: 3, background: '#ff00ff' } }).composite(layers).png().toBuffer();
    const report = await cropBatch(sheet, plan, batch.id, folder, batch);
    assert.deepEqual(report.crops.map(c => c.assetId), batch.rows.flat()); filled.push(...report.crops.map(c => c.assetId));
  }
  assert.equal(new Set(filled).size, plan.assets.length);
  assert.deepEqual(fs.readFileSync(path.join(folder, 'assets', compiled.libraryAssetIds[0] + '.png')), original);
  const complete = compose(folder, plan);
  assert.ok((await materialsZip(folder, { ...complete, status: 'ready', filledAssets: filled })).length > 1000);
});
test('HTTP creates a single ready plan, exports it and preserves older tasks without selection routes', async t => {
  const folder = workspace(t);
  const child = spawn(process.execPath, ['server.cjs'], { cwd: __dirname, env: { ...process.env, PLANNER_PORT: '0', PLANNER_OUTPUT_DIR: folder }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } });
  const address = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('server startup timeout')), 10000);
    child.once('error', e => { clearTimeout(timeout); reject(e); });
    child.stdout.on('data', bytes => { const match = bytes.toString().match(/http:\/\/127.0.0.1:(\d+)/); if (match) { clearTimeout(timeout); resolve(match[0]); } });
    child.once('exit', () => { clearTimeout(timeout); reject(Error('server stopped')); });
  });
  const post = async (route, data = {}) => { const response = await fetch(address + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); return { status: response.status, data: await response.json() }; };
  const initial = await post('/api/recommendation-example', { example: 'beauty' });
  assert.equal(initial.status, 201); assert.equal(initial.data.status, 'ready');
  assert.equal(initial.data.structure, undefined); assert.equal(initial.data.selections, undefined);
  assert.equal(initial.data.filledAssets.length, 10); assert.equal(initial.data.planningRequestAttempts, 0);
  const id = initial.data.id, savedFile = path.join(folder, id, 'state.json'), snapshot = fs.readFileSync(savedFile);
  assert.equal((await post(`/api/runs/${id}/select-structure`, { candidateId: 'any' })).status, 404);
  const exported = await post(`/api/runs/${id}/download/materials.zip`); assert.equal(exported.status, 200); assert.ok(exported.data.bytes > 1000);
  const updated = await post(`/api/runs/${id}/recommendation`); assert.equal(updated.data.status, 'ready'); assert.notEqual(updated.data.id, id);
  assert.deepEqual(fs.readFileSync(savedFile), snapshot);
  const single = await post('/api/recommendation', { name: '测试', categories: '只有一类' });
  assert.equal(single.status, 201); assert.ok(!single.data.plan.modules.some(m => m.type.startsWith('navigation.')));
  assert.equal((await post('/api/recommendation', { name: '测试', categories: '' })).status, 400);
  const restored = await (await fetch(address + '/api/runs/' + id)).json(); assert.equal(restored.id, id);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { randomUUID } = require('crypto');
const { unzipSync } = require('fflate');
const { productWorkflow, generateRemaining, prepareInputs, applyDesign, sourceChoices, validateResearch, cachedResearch, resumeResearch } = require('./product-workflow.cjs');
const { searchSources, batchSize, imageBytes, askJson, parseJson } = require('./qwen-provider.cjs');
const { aspectRatios } = require('./plan.cjs');
const { materialsZip } = require('./download.cjs');

function workspace(t) {
  const root = path.resolve(__dirname, 'output'); fs.mkdirSync(root, { recursive: true });
  const folder = fs.mkdtempSync(path.join(root, 'product-test-'));
  t.after(() => { if (!path.resolve(folder).startsWith(root + path.sep)) throw Error('Unsafe cleanup'); fs.rmSync(folder, { recursive: true, force: true }); });
  const old = process.env.DASHSCOPE_API_KEY; process.env.DASHSCOPE_API_KEY = 'test-secret-no-real-requests';
  t.after(() => { if (old === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = old; });
  return { id: randomUUID(), folder, state: { status: 'planning', filledAssets: [], importedBatches: [], planningRequestAttempts: 0, imageGenerationCallsByThisTool: 0 } };
}
const save = (folder, state) => fs.writeFileSync(path.join(folder, 'state.json'), JSON.stringify(state));
async function screenshot(height = 700) { return { name: '商品列表.png', data: 'data:image/png;base64,' + (await sharp({ create: { width: 500, height, channels: 3, background: '#aaccee' } }).png().toBuffer()).toString('base64') }; }
async function sheet(plan, batch) {
  const width = 960, gap = 12, layers = []; let top = gap;
  for (const row of batch.rows) {
    const cellWidth = Math.floor((width - gap * (row.length + 1)) / row.length);
    const height = Math.round(cellWidth / aspectRatios[plan.assets.find(a => a.id === row[0]).aspect]);
    for (let i = 0; i < row.length; i++) layers.push({ top, left: gap + i * (cellWidth + gap), input: await sharp({ create: { width: cellWidth, height, channels: 3, background: i % 2 ? '#95b9b5' : '#c2d3e8' } }).png().toBuffer() });
    top += height + gap;
  }
  return sharp({ create: { width, height: top, channels: 3, background: '#ff00ff' } }).composite(layers).png().toBuffer();
}
function mockProvider(run, options = {}) {
  const calls = [], categories = options.categories || ['耳机']; let imageCalls = 0;
  const source = { url: 'https://www.example.com/products', title: '测试用数码展示参考' };
  const recognition = { sufficient: !options.insufficient, categories, products: Array.from({ length: options.insufficient ? 1 : Math.max(2, categories.length) }, (_, i) => ({ category: categories[i % categories.length], description: `可见商品款式 ${i + 1}`, imageIndex: 1 })), observations: ['列表包含不同款式'], uncertainties: ['具体材质未确认'], missing: options.insufficient ? ['请补充其他清楚款式'] : [] };
  const research = { concept: '清透的数码日常', reason: '结合搜索主题提出画面设计，实际效果待验证', style: { palette: ['#124578', '#CCEEDD'], background: '明亮工作空间与抽象色面', lighting: '清晰自然光', photography: '按用途切换场景与局部视角' }, anchors: ['蓝绿关系'], selectedSources: [{ sourceId: options.fakeSource ? 'source-99' : 'source-1', application: '来源主题是数码展示，建议使用主体留白组织新画面，未观察原网页图片' }] };
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, body });
    assert.match(body.model, /^qwen/); assert.ok(!/ark|volces|doubao/i.test(url));
    const response = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    if (body.model.startsWith('qwen-image')) {
      imageCalls++;
      if (options.failImage === imageCalls) return new Response(JSON.stringify({ code: 'ServiceUnavailable', message: 'test-secret-no-real-requests' }), { status: 503 });
      const batch = run.state.batches.find(b => b.prompt === body.input.messages[0].content.find(c => c.text)?.text);
      assert.ok(batch, 'sent prompt must equal the reviewable batch prompt');
      const bytes = options.badSheet ? Buffer.from((await screenshot()).data.split(',')[1], 'base64') : await sheet(run.state.plan, batch);
      return response({ request_id: 'mock-image', output: { choices: [{ message: { content: [{ image: 'data:image/png;base64,' + bytes.toString('base64') }] } }] } });
    }
    const textOnly = url.includes('/text-generation/'), input = JSON.parse(textOnly ? body.input.messages[1].content : body.input.messages[1].content[0].text);
    if (!textOnly) assert.deepEqual(body.parameters.response_format, { type: 'json_object' });
    else assert.equal(body.parameters.response_format, undefined);
    let value = recognition;
    if (textOnly) {
      assert.equal(body.parameters.enable_search, true); assert.equal(body.parameters.search_options.forced_search, true); assert.equal(body.parameters.search_options.enable_source, true);
      value = { selectedSources: [{ url: 'https://fabricated.example.com/product-2026' }], reason: '未核实的搜索回答，不能流入后续设计' };
    } else if (input.sources) {
      assert.equal(body.parameters.enable_search, undefined);
      assert.deepEqual(input.sources, [{ id: 'source-1', ...source }]);
      assert.ok(!JSON.stringify(body).includes('fabricated.example.com'));
      value = research;
    } else if (input.tasks) value = {
      artDirection: { concept: research.concept, narrative: '主视觉到品类场景', anchors: research.anchors, focalAssetId: 'overview' },
      assets: input.tasks.map((a, i) => ({ id: a.id, aspect: a.aspect, subject: a.category + '示意商品', composition: '按图片用途组织画面，主体留出安全边距', prompt: `${a.category}同类型示意商品，画面用途为${a.role}，放置于蓝绿色协调空间中，保持自然光、主体留白以及清楚的外形，每张按用途组织视角，不绘制任何文字或商标。`, direction: { role: a.role, camera: i % 2 ? 'top-down' : 'eye-level', background: '蓝绿空间', accents: '银色局部', treatment: i % 2 ? 'still-life' : 'environment' } }))
    };
    return response({ output: { choices: [{ message: { content: textOnly ? '搜索概括（不要求 JSON）：' + JSON.stringify(value) : [{ text: JSON.stringify(value) }] } }], ...(textOnly ? { search_info: { search_results: options.noSources ? [] : [source] } } : {}) }, usage: { total_tokens: 1 }, request_id: 'mock-text' });
  };
  return { fetcher, calls, recognition, research };
}

test('multiple product screenshots create one generic plan, exact prompts, crops and downloadable ZIP', async t => {
  const run = workspace(t), mock = mockProvider(run);
  const result = await productWorkflow(run, [await screenshot(), await screenshot(1800)], save, mock);
  assert.equal(result.workflow.stage, 'complete'); assert.equal(result.inputs.length, 2);
  assert.equal(result.planningRequestAttempts, 4); assert.equal(result.imageGenerationCallsByThisTool, 1);
  assert.equal(result.plan.imageMode, 'category-inspired'); assert.equal(result.plan.navigationLibrary, undefined);
  assert.equal(result.libraryAssetIds.length, 0); assert.equal(result.filledAssets.length, result.plan.assets.length);
  assert.ok(!result.plan.modules.some(m => m.type.startsWith('navigation.'))); assert.equal(result.candidates, undefined);
  assert.ok(!/护肤|梳妆|美妆|beige/i.test(result.batches[0].prompt));
  assert.equal(mock.calls.length, 5); assert.equal(mock.calls[0].body.input.messages[1].content.filter(c => c.image).length, 4);
  assert.equal(result.research.selectedSources[0].url, 'https://www.example.com/products');
  const actual = fs.readFileSync(path.join(run.folder, result.batches[0].id + '-attempt-1-prompt.txt'), 'utf8');
  assert.equal(actual, result.batches[0].prompt);
  const imageRequest = mock.calls.at(-1).body;
  assert.equal(imageRequest.parameters.prompt_extend, false); assert.equal(imageRequest.parameters.n, 1);
  const [w, h] = batchSize(result.plan, result.batches[0]).split('*').map(Number); assert.ok(w * h <= 2048 * 2048);
  const files = unzipSync(await materialsZip(run.folder, result));
  assert.ok(files['店铺预览/shop.html']); assert.ok(!Object.keys(files).some(f => /input-|response|research|secret/.test(f)));
  assert.throws(() => applyDesign(result.plan, { artDirection: result.plan.artDirection, assets: result.plan.assets.map((a, i) => i ? a : { ...a, aspect: '1:1' }) }), /比例/);
});

test('insufficient evidence stops before research or image generation; invalid inputs do not reach a model', async t => {
  const run = workspace(t), mock = mockProvider(run, { insufficient: true });
  await productWorkflow(run, [await screenshot()], save, mock);
  assert.equal(run.state.status, 'needs-input'); assert.equal(mock.calls.length, 1); assert.equal(run.state.plan, undefined);
  await assert.rejects(prepareInputs([], run.folder), /1 至 6/);
  await assert.rejects(prepareInputs([{ data: 'data:image/svg+xml;base64,PHN2Zz4=' }], run.folder), /PNG/);
});

test('web references must be real search records, not model-written URLs', async t => {
  for (const options of [{ noSources: true }, { fakeSource: true }]) {
    const run = workspace(t), mock = mockProvider(run, options);
    await assert.rejects(productWorkflow(run, [await screenshot()], save, mock), /来源|搜索之外/);
    assert.equal(mock.calls.length, options.noSources ? 2 : 3); assert.equal(run.state.imageGenerationCallsByThisTool, 0);
  }
  assert.deepEqual(searchSources({ output: { search_info: { search_results: [{ url: 'javascript:alert(1)' }, { url: 'http://127.0.0.1/test' }, { url: 'https://www.example.com/a#x' }, { url: 'https://www.example.com/a#y' }] } } }).map(s => s.url), ['https://www.example.com/a']);
  let fetched = false; await assert.rejects(imageBytes('https://untrusted.example.com/image.png', async () => { fetched = true; }), /未下载/); assert.equal(fetched, false);
});

test('second batch failure preserves the first batch; explicit continuation generates only the missing batch', async t => {
  const run = workspace(t), mock = mockProvider(run, { categories: ['耳机', '键盘', '鼠标', '音箱', '相机'], failImage: 2 });
  await productWorkflow(run, [await screenshot()], save, mock);
  assert.equal(run.state.workflow.stage, 'generation-failed'); assert.equal(run.state.batches.length, 2);
  assert.equal(mock.calls.length, 6); assert.equal(run.state.imageGenerationCallsByThisTool, 2);
  const first = run.state.batches[0], preserved = fs.readFileSync(path.join(run.folder, 'assets', first.rows[0][0] + '.png'));
  assert.deepEqual(run.state.filledAssets, first.rows.flat()); assert.ok(!run.state.generationError.includes('test-secret'));
  await generateRemaining(run, save, mock);
  assert.equal(mock.calls.length, 7); assert.equal(run.state.workflow.stage, 'complete');
  assert.deepEqual(run.state.generationAttempts, { [first.id]: 1, [run.state.batches[1].id]: 2 });
  assert.deepEqual(fs.readFileSync(path.join(run.folder, 'assets', first.rows[0][0] + '.png')), preserved);
  assert.ok(mock.calls.at(-1).body.input.messages[0].content.some(c => c.image));
  await generateRemaining(run, save, mock); assert.equal(mock.calls.length, 7);
});

test('a malformed generated sheet is retained for review and never automatically regenerated', async t => {
  const run = workspace(t), mock = mockProvider(run, { badSheet: true });
  await productWorkflow(run, [await screenshot()], save, mock);
  assert.equal(run.state.workflow.stage, 'generation-failed'); assert.equal(run.state.filledAssets.length, 0);
  const id = run.state.batches[0].id; assert.equal(run.state.generatedSheets[id], 1);
  assert.ok(fs.existsSync(path.join(run.folder, id + '-attempt-1-source.png'))); assert.equal(mock.calls.length, 5);
});

test('source selection retains later results and rejects invented IDs, duplicate citations and model-written URLs', t => {
  const run = workspace(t), { research } = mockProvider(run);
  const results = Array.from({ length: 15 }, (_, i) => ({ url: `https://www.example.com/page-${i}`, title: `来源 ${i}` }));
  const sources = sourceChoices(searchSources({ output: { search_info: { search_results: results } } }));
  assert.equal(sources.length, 15);
  assert.equal(validateResearch({ ...research, selectedSources: [{ sourceId: 'source-15', application: '参考主题，提出新画面' }] }, sources).selectedSources[0].url, results[14].url);
  assert.throws(() => validateResearch({ ...research, selectedSources: [{ url: 'https://fabricated.example.com/', application: '编造' }] }, sources));
  assert.throws(() => validateResearch({ ...research, selectedSources: [research.selectedSources[0], research.selectedSources[0]] }, sources), /重复/);
});

test('a legacy failed-link run resumes from cached evidence without repeating recognition/search or modifying inputs', async t => {
  const run = workspace(t), mock = mockProvider(run);
  const prepared = await prepareInputs([await screenshot()], run.folder);
  Object.assign(run.state, { status: 'failed', inputs: prepared.inputs, recognition: mock.recognition, planningRequestAttempts: 2, workflow: { stage: 'researching' }, error: '选定风格引用了本次搜索之外的链接，已停止。' });
  const sourcesFile = path.join(run.folder, 'search-sources.json'), inputFile = path.join(run.folder, 'input-1.jpg');
  const oldResponse = '模型所写的不匹配链接'; fs.writeFileSync(path.join(run.folder, 'research-response.txt'), oldResponse);
  fs.writeFileSync(sourcesFile, JSON.stringify([{ url: 'https://www.example.com/products', title: '测试用数码展示参考' }]));
  const original = fs.readFileSync(inputFile), originalSources = fs.readFileSync(sourcesFile);
  assert.ok(cachedResearch(run));
  await resumeResearch(run, save, { ...mock, generate: false });
  assert.equal(mock.calls.length, 2); assert.ok(mock.calls.every(c => !c.url.includes('/text-generation/')));
  assert.equal(run.state.status, 'ready'); assert.equal(run.state.planningRequestAttempts, 4); assert.equal(run.state.previousErrors.length, 1);
  assert.deepEqual(fs.readFileSync(inputFile), original); assert.deepEqual(fs.readFileSync(sourcesFile), originalSources);
  assert.equal(fs.readFileSync(path.join(run.folder, 'research-response.txt'), 'utf8'), oldResponse);
  assert.equal(cachedResearch(run), null);
  await assert.rejects(resumeResearch(run, save, mock), /无法从风格选择继续/); assert.equal(mock.calls.length, 2);
});

test('native-provider errors and malformed JSON are recorded without retry or leaking credentials', async t => {
  const run = workspace(t); let calls = 0;
  const fetcher = async () => { calls++; return new Response(JSON.stringify({ code: 'InvalidApiKey', message: process.env.DASHSCOPE_API_KEY }), { status: 401 }); };
  await assert.rejects(askJson(run.folder, 'test', 'test', {}, { fetcher }), /权限.*没有自动重试/);
  assert.equal(calls, 1); assert.ok(!fs.readFileSync(path.join(run.folder, 'test-call.json'), 'utf8').includes(process.env.DASHSCOPE_API_KEY));
  await assert.rejects(askJson(run.folder, 'bad-json', 'test', {}, { fetcher: async () => { calls++; return new Response(JSON.stringify({ output: { choices: [{ message: { content: 'not JSON' } }] } })); } }), /JSON 格式/);
  assert.equal(calls, 2); assert.equal(fs.readFileSync(path.join(run.folder, 'bad-json-response.txt'), 'utf8'), 'not JSON');
});

test('JSON quote repair preserves wording but never fills truncated or missing content', t => {
  const run = workspace(t);
  const raw = '{"application":"借鉴标题中"V 领开叉”与“回头率”的主题。"}';
  assert.deepEqual(parseJson(raw, run.folder, 'quote'), { application: '借鉴标题中"V 领开叉”与“回头率”的主题。' });
  const audit = JSON.parse(fs.readFileSync(path.join(run.folder, 'quote-parse-repair.json')));
  assert.equal(audit.insertedEscapes, 1); assert.equal(audit.modelRequests, 0);
  for (const bad of ['{"application":"未完成', '{"application":', '{"application":"a" "extra":true}', '{"a":undefined}']) assert.throws(() => parseJson(bad), /JSON 格式/);
  assert.deepEqual(parseJson('```json\n{"a":"escaped \\" text"}\n```'), { a: 'escaped " text' });
});

test('continuation reuses a complete saved style with broken quote escaping and makes no second style request', async t => {
  const run = workspace(t), mock = mockProvider(run), prepared = await prepareInputs([await screenshot()], run.folder);
  Object.assign(run.state, { status: 'failed', inputs: prepared.inputs, recognition: mock.recognition, planningRequestAttempts: 3, styleSelectionAttempts: 1, workflow: { stage: 'selecting-style' }, error: 'JSON 格式不正确' });
  fs.writeFileSync(path.join(run.folder, 'search-sources.json'), JSON.stringify([{ url: 'https://www.example.com/products', title: '测试用数码展示参考' }]));
  const research = { ...mock.research, reason: '根据"数码”主题设计' };
  const raw = JSON.stringify(research).replace('\\"数码', '"数码');
  fs.writeFileSync(path.join(run.folder, 'style-attempt-1-response.txt'), raw);
  fs.writeFileSync(path.join(run.folder, 'style-attempt-1-call.json'), JSON.stringify({ status: 'completed', finishReason: 'stop' }));
  await resumeResearch(run, save, { ...mock, generate: false });
  assert.equal(mock.calls.length, 1); assert.equal(run.state.reusedStyleAttempt, 1); assert.equal(run.state.styleSelectionAttempts, 1);
  assert.equal(run.state.planningRequestAttempts, 4); assert.equal(run.state.research.reason, research.reason);
  assert.equal(fs.readFileSync(path.join(run.folder, 'style-attempt-1-response.txt'), 'utf8'), raw);
});

test('provider length termination is never accepted as complete JSON', async t => {
  const run = workspace(t);
  await assert.rejects(askJson(run.folder, 'length', 'JSON', {}, { fetcher: async () => new Response(JSON.stringify({ output: { choices: [{ finish_reason: 'length', message: { content: '{"apparently":"valid"}' } }] } })) }), /长度上限/);
});

test('HTTP upload, saved progress, download and restart use the new provider without automatic replay', async t => {
  const http = require('http'), { spawn } = require('child_process'), { once } = require('events');
  const run = workspace(t), runsRoot = path.join(run.folder, 'runs'); fs.mkdirSync(runsRoot);
  let latestId, held, release;
  const bridge = { get state() { return JSON.parse(fs.readFileSync(path.join(runsRoot, latestId, 'state.json'), 'utf8')); } };
  let mock = mockProvider(bridge, { categories: ['耳机', '键盘', '鼠标', '音箱'] });
  const provider = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      if (held) await held;
      const response = await mock.fetcher('http://mock-provider' + req.url, { body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(response.status, { 'Content-Type': 'application/json' }); res.end(await response.text());
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ code: 'MockFailure', message: error.message })); }
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  let child, browser;
  const start = async () => {
    child = spawn(process.execPath, ['server.cjs'], { cwd: __dirname, windowsHide: true, env: { ...process.env, PLANNER_PORT: '0', PLANNER_OUTPUT_DIR: runsRoot, PLANNER_DASHSCOPE_BASE_URL: 'http://127.0.0.1:' + provider.address().port }, stdio: ['ignore', 'pipe', 'pipe'] });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('server startup timeout')), 10000);
      child.once('error', e => { clearTimeout(timeout); reject(e); });
      child.stdout.on('data', bytes => { const m = bytes.toString().match(/http:\/\/127.0.0.1:\d+/); if (m) { clearTimeout(timeout); resolve(m[0]); } });
      child.once('exit', () => { clearTimeout(timeout); reject(Error('server stopped')); });
    });
  };
  const stop = async () => { if (child?.exitCode === null) { child.kill(); await once(child, 'exit'); } };
  try {
    let address = await start();
    const post = (route, data = {}) => fetch(address + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const read = async () => (await fetch(address + '/api/runs/' + latestId)).json();
    const waitReady = async () => { for (let i = 0; i < 200; i++) { const state = await read(); if (!['planning', 'generating'].includes(state.status)) return state; await new Promise(r => setTimeout(r, 50)); } throw Error('workflow timeout'); };
    const config = await (await fetch(address + '/api/config')).json(); assert.equal(config.oldProviderDisabled, true); assert.ok(!JSON.stringify(config).includes(process.env.DASHSCOPE_API_KEY));
    assert.equal((await post('/api/legacy-plan')).status, 410);
    assert.equal((await post('/api/plan', { images: [] })).status, 400);
    held = new Promise(resolve => { release = resolve; });
    const inputs = [await screenshot(), await screenshot(1800)];
    const response = await post('/api/plan', { images: inputs }); assert.equal(response.status, 202);
    latestId = (await response.json()).id;
    assert.equal((await post('/api/plan', { images: inputs })).status, 409);
    assert.equal((await post('/api/runs/' + latestId + '/download/materials.zip')).status, 409);
    release(); held = null;
    let state = await waitReady(); assert.equal(state.workflow.stage, 'complete'); assert.equal(mock.calls.length, 6);
    assert.equal(state.filledAssets.length, 10); assert.equal(state.libraryAssetIds.length, 0);
    assert.equal((await fetch(address + '/runs/' + latestId + '/input-2.jpg')).status, 200);
    assert.equal((await fetch(address + '/runs/' + latestId + '/research-call.json')).status, 404);
    assert.equal((await post('/api/runs/' + latestId + '/generate')).status, 200); assert.equal(mock.calls.length, 6);
    const zip = await post('/api/runs/' + latestId + '/download/materials.zip'); assert.equal(zip.status, 200);
    assert.ok((await zip.json()).bytes > 1000);

    if (process.env.PLANNER_BROWSER_PROOF) {
      const { chromium } = require('playwright-core');
      browser = await chromium.launch({ channel: 'chrome', headless: true });
      const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, locale: 'zh-CN' });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(address + '/?run=' + latestId);
      await page.waitForFunction(() => !document.getElementById('download-png').disabled);
      assert.match(await page.locator('#pipeline').innerText(), /耳机.*键盘.*鼠标.*音箱/);
      await page.locator('#pipeline details').last().locator('summary').click();
      assert.equal(await page.locator('#pipeline a').getAttribute('href'), 'https://www.example.com/products');
      await page.locator('#batches .batch').first().locator('summary').click();
      assert.equal(await page.locator('#batches pre').first().innerText(), state.batches[0].prompt);
      const zipEvent = page.waitForEvent('download'); await page.locator('#download-zip').click();
      assert.equal(await (await zipEvent).failure(), null);
      await page.waitForFunction(() => !document.getElementById('download-png').disabled);
      const pngEvent = page.waitForEvent('download'); await page.locator('#download-png').click();
      assert.equal(await (await pngEvent).failure(), null);
      const proof = path.resolve(__dirname, 'output/product-workflow-browser'); fs.mkdirSync(proof, { recursive: true });
      await page.screenshot({ path: path.join(proof, 'mock-complete.png'), fullPage: true });
      mock = mockProvider(bridge, { insufficient: true });
      await page.locator('#screenshot').setInputFiles(inputs.map((img, i) => ({ name: '测试商品' + i + '.png', mimeType: 'image/png', buffer: Buffer.from(img.data.split(',')[1], 'base64') })));
      assert.equal(await page.locator('#input-list .input-item').count(), 2);
      held = new Promise(resolve => { release = resolve; });
      const submitted = page.waitForResponse(r => r.url().endsWith('/api/plan') && r.request().method() === 'POST');
      await page.locator('#plan').click(); latestId = (await (await submitted).json()).id;
      release(); held = null;
      await page.waitForFunction(() => document.getElementById('status').innerText.includes('请补充截图'));
      assert.equal(mock.calls.length, 1); assert.equal(await page.locator('#download-png').isDisabled(), true);
      await page.screenshot({ path: path.join(proof, 'mock-needs-input.png'), fullPage: true });
      assert.deepEqual(errors, []); await browser.close(); browser = null;
    }

    mock = mockProvider(bridge, { fakeSource: true });
    held = new Promise(resolve => { release = resolve; });
    latestId = (await (await post('/api/plan', { images: inputs })).json()).id; release(); held = null;
    const failed = await waitReady(); assert.equal(failed.status, 'failed'); assert.equal(failed.canResumeResearch, true);
    assert.equal(mock.calls.length, 3);
    const preservedRecognition = fs.readFileSync(path.join(runsRoot, latestId, 'recognition.json'));
    mock = mockProvider(bridge);
    held = new Promise(resolve => { release = resolve; });
    if (process.env.PLANNER_BROWSER_PROOF) {
      browser = await require('playwright-core').chromium.launch({ channel: 'chrome', headless: true });
      const page = await browser.newPage(); await page.goto(address + '/?run=' + latestId);
      const resumed = page.waitForResponse(r => r.url().endsWith('/resume-research'));
      await page.getByRole('button', { name: '沿用已有资料继续' }).click(); assert.equal((await resumed).status(), 202);
      assert.equal(await page.locator('#screenshot').isDisabled(), true);
    } else assert.equal((await post('/api/runs/' + latestId + '/resume-research')).status, 202);
    assert.equal((await post('/api/runs/' + latestId + '/resume-research')).status, 409);
    release(); held = null;
    state = await waitReady(); assert.equal(state.workflow.stage, 'complete'); assert.equal(mock.calls.length, 3);
    assert.ok(mock.calls.every(c => !c.url.includes('/text-generation/')));
    assert.deepEqual(fs.readFileSync(path.join(runsRoot, latestId, 'recognition.json')), preservedRecognition);
    assert.equal((await post('/api/runs/' + latestId + '/resume-research')).status, 400);
    if (browser) { await browser.close(); browser = null; }

    state = await read(); state.status = 'generating';
    const file = path.join(runsRoot, latestId, 'state.json'); fs.writeFileSync(file, JSON.stringify(state));
    const callCount = mock.calls.length; await stop(); address = await start();
    const restored = await read(); assert.ok(['failed', 'ready'].includes(restored.status));
    assert.match(restored.generationError || restored.error, /中断.*没有自动重新调用/);
    assert.equal(mock.calls.length, callCount);
  } finally {
    release?.(); if (browser) await browser.close(); await stop(); await new Promise(resolve => provider.close(resolve));
  }
});

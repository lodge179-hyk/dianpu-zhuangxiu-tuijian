require('./test-network-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { generateSheet, MODEL, publicImageSettings } = require('./ark-image-provider.cjs');
const { publicSettings, imageBytes } = require('./qwen-provider.cjs');
function setup(t) {
  const root = path.resolve(__dirname, 'output'); fs.mkdirSync(root, { recursive: true });
  const folder = fs.mkdtempSync(path.join(root, 'ark-test-'));
  t.after(() => { if (!path.resolve(folder).startsWith(root + path.sep)) throw Error('Unsafe cleanup'); fs.rmSync(folder, { recursive: true, force: true }); });
  for (const [key, value] of Object.entries({ ARK_API_KEY: 'ark-test-key-never-real', ARK_IMAGE_MODEL: MODEL })) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => old === undefined ? delete process.env[key] : process.env[key] = old);
  }
  const plan = { assets: [{ id: 'overview', aspect: '4:3' }] }, batch = { id: 'structure-1', rows: [['overview']], prompt: '模拟提示词，不进行真实生图', referenceBatchId: null };
  return { folder, plan, batch };
}
test('Ark request uses the exact original model and single-sheet contract; audit excludes credentials', async t => {
  const { folder, plan, batch } = setup(t), bytes = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#112233' } }).png().toBuffer();
  let calls = 0;
  const result = await generateSheet(folder, plan, batch, 1, { fetcher: async (url, init) => {
    calls++; const b = JSON.parse(init.body);
    assert.equal(b.model, MODEL); assert.equal(b.prompt, batch.prompt); assert.equal(b.response_format, 'b64_json');
    assert.equal(b.parameters, undefined); assert.equal(b.sequential_image_generation, undefined); assert.equal(b.image, undefined);
    const [w, h] = b.size.split('x').map(Number); assert.ok(w * h >= 921600 && w * h <= 4624220);
    return new Response(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] }));
  } });
  assert.equal(calls, 1); assert.ok(result.length);
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, 'structure-1-attempt-1-call.json'))).model, MODEL);
  assert.ok(!JSON.stringify(publicSettings()).includes(process.env.ARK_API_KEY));
  for (const f of fs.readdirSync(folder).filter(f => f.endsWith('.json'))) assert.ok(!fs.readFileSync(path.join(folder, f), 'utf8').includes(process.env.ARK_API_KEY));
});
test('missing or mismatched Ark configuration never falls back to another model', async t => {
  const f = setup(t); let calls = 0; const fetcher = async () => { calls++; throw Error('must not call'); };
  process.env.ARK_IMAGE_MODEL = 'qwen-image-3.0-pro';
  assert.equal(publicImageSettings().imageConfigured, false);
  await assert.rejects(generateSheet(f.folder, f.plan, f.batch, 1, { fetcher }), /原来的火山/);
  process.env.ARK_IMAGE_MODEL = MODEL; process.env.ARK_API_KEY = '';
  await assert.rejects(generateSheet(f.folder, f.plan, f.batch, 1, { fetcher }), /ARK_API_KEY/);
  assert.equal(calls, 0);
});
test('Ark errors and uncertain transport are saved once, without automatic retry', async t => {
  const f = setup(t); let calls = 0;
  await assert.rejects(generateSheet(f.folder, f.plan, f.batch, 1, { fetcher: async () => { calls++; return new Response(JSON.stringify({ error: { code: 'AccountOverdueError', message: process.env.ARK_API_KEY } }), { status: 403 }); } }), /余额.*没有自动重试/);
  const audit = fs.readFileSync(path.join(f.folder, 'structure-1-attempt-1-call.json'), 'utf8'); assert.ok(!audit.includes(process.env.ARK_API_KEY));
  await assert.rejects(generateSheet(f.folder, f.plan, f.batch, 2, { fetcher: async () => { calls++; throw Error('timeout'); } }), /计费未确认/);
  assert.equal(calls, 2);
});
test('image recovery keeps provider-specific URL rules; tests block any accidental external request', async () => {
  let calls = 0;
  await assert.rejects(imageBytes('https://untrusted.example/image.png', async () => { calls++; }, 'volcengine'), /未下载/);
  await assert.rejects(imageBytes('https://assets.aliyuncs.com/a.png', async () => { calls++; }, 'volcengine'), /未下载/);
  assert.equal(calls, 0);
  assert.throws(() => fetch('https://ark.cn-beijing.volces.com/api/v3/images/generations'), /Tests forbid external/);
});

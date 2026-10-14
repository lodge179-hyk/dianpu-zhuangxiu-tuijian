const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { unzipSync, strFromU8 } = require('fflate');
const { compose } = require('./compose.cjs');
const { navigationExamplePlan } = require('./navigation-example.cjs');
const { materialsZip, attachmentHeader, readExport } = require('./download.cjs');

function fixture(t, edit = () => {}) {
  const root = path.resolve(__dirname, 'output'); fs.mkdirSync(root, { recursive: true });
  const folder = fs.mkdtempSync(path.join(root, 'download-test-'));
  t.after(() => { if (!path.resolve(folder).startsWith(root + path.sep)) throw Error('Unsafe cleanup path'); fs.rmSync(folder, { recursive: true, force: true }); });
  const plan = navigationExamplePlan(); edit(plan);
  const compiled = compose(folder, plan);
  return { folder, state: { ...compiled, id: 'export-test', status: 'ready', filledAssets: compiled.libraryAssetIds } };
}

test('ZIP maps module order, repeated images and Chinese copy; offline preview is self-contained', async t => {
  const { folder, state } = fixture(t, plan => {
    plan.modules[2].props.text = '=示例文案，保留中文';
    plan.modules.push({ ...structuredClone(plan.modules[1]), id: 'second-navigation' });
  });
  for (const file of ['input.jpg', 'planner-response.json', '.env.local', 'batch-source.png']) fs.writeFileSync(path.join(folder, file), 'not an export asset');
  const files = unzipSync(await materialsZip(folder, state));
  const manifest = JSON.parse(strFromU8(files['素材对照.json']));
  assert.deepEqual(manifest.modules.map(m => m.id), state.plan.modules.map(m => m.id));
  assert.equal(manifest.modules[2].text, '=示例文案，保留中文');
  assert.equal(manifest.modules[0].images.length, 0);
  for (const module of manifest.modules) for (const image of module.images) {
    assert.deepEqual(Buffer.from(files[image.file]), fs.readFileSync(path.join(folder, 'assets', image.assetId + '.png')));
    assert.ok(image.width > 1 && image.height > 1);
  }
  assert.equal(manifest.modules[1].images[0].assetId, manifest.modules[3].images[0].assetId);
  assert.notEqual(manifest.modules[1].images[0].file, manifest.modules[3].images[0].file);
  assert.match(strFromU8(files['模块对照表.csv']), /'=示例文案，保留中文/);
  const html = strFromU8(files['店铺预览/shop.html']);
  for (let i = 0; i < state.plan.modules[1].props.labels.length; i++) {
    assert.ok(html.includes(`data-component="${state.plan.modules[1].id}.label${i + 1}"`));
    assert.ok(html.includes('>' + state.plan.modules[1].props.labels[i] + '</div>'));
  }
  for (const [, source] of html.matchAll(/src="([^"]+)"/g)) {
    if (source.startsWith('data:')) continue;
    assert.ok(files['店铺预览/' + source], `Missing offline image: ${source}`);
  }
  assert.ok(Object.keys(files).every(name => !/input\.jpg|planner-response|\.env|batch-source|\.\.|^[\/\\]/.test(name)));
  assert.ok(files['模块素材/03-文字/模块说明.txt']);
});

test('export rejects unfinished runs, missing fills, missing files and placeholder images', async t => {
  const { folder, state } = fixture(t);
  await assert.rejects(readExport(folder, { ...state, status: 'planning' }), /先完成装修方案/);
  await assert.rejects(materialsZip(folder, { ...state, filledAssets: state.filledAssets.slice(1) }), /还有 1 张素材未填入/);
  const file = path.join(folder, 'assets', state.plan.assets[0].id + '.png'), original = fs.readFileSync(file);
  fs.unlinkSync(file);
  await assert.rejects(readExport(folder, state), /文件缺失/);
  fs.writeFileSync(file, await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } }).png().toBuffer());
  await assert.rejects(readExport(folder, state), /占位图/);
  fs.writeFileSync(file, original);
  await readExport(folder, state);
});

test('re-export uses replacement material, including every module and offline preview', async t => {
  const { folder, state } = fixture(t);
  const first = unzipSync(await materialsZip(folder, state));
  const assetId = state.plan.assets[0].id;
  const replacement = await sharp({ create: { width: 48, height: 48, channels: 3, background: '#335544' } }).png().toBuffer();
  fs.writeFileSync(path.join(folder, 'assets', assetId + '.png'), replacement);
  const second = unzipSync(await materialsZip(folder, state));
  const names = Object.keys(second).filter(name => name.endsWith('/' + assetId + '.png') || name.endsWith('-' + assetId + '.png'));
  assert.equal(names.length, 2);
  for (const name of names) { assert.notDeepEqual(first[name], second[name]); assert.deepEqual(Buffer.from(second[name]), replacement); }
});

test('download filename supports Unicode and removes header/path delimiters', () => {
  const state = { plan: { shop: { name: '../测试店👗\r\n"/\\:*?' } } };
  const header = attachmentHeader(state, 'png');
  assert.ok(!/[\r\n]/.test(header));
  assert.ok(header.startsWith('attachment; filename="store-preview.png";'));
  const unicodeName = decodeURIComponent(header.split("UTF-8''")[1]);
  assert.match(unicodeName, /测试店👗/);
  assert.ok(!/[\r\n/\\:"?*]/.test(unicodeName));
  assert.ok(unicodeName.endsWith('装修长图.png'));
});

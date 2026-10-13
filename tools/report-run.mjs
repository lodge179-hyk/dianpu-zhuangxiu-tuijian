import { readFile } from 'node:fs/promises';

const d = process.argv[2];
const m = JSON.parse(await readFile(`${d}/manifest.json`, 'utf8'));
console.log(`页面：${m.page.width}×${m.page.height}  模块：${m.modules.length}  素材：${m.assetFiles.length}`);
console.log(`生成时间：${m.generatedAt}`);
console.log(`生图调用：${m.generationCalls} 次  模型用量：${JSON.stringify(m.modelUsage)}`);

console.log('\n模块顺序与图片位：');
for (const mod of m.modules) {
  console.log(`  ${mod.order}. ${mod.label} (${mod.type})`);
  console.log(`     理由：${(mod.reason || '').slice(0, 76)}`);
  for (const s of mod.slots) {
    console.log(`     - ${s.file.padEnd(22)} 槽位 ${s.slotPixels.join('×')} → 交付 ${s.deliveredPixels.join('×')}${s.upscaled ? ' 放大' : ''}  页面位置 ${s.pageRect.join(',')}  来源 ${s.source}`);
  }
  if (mod.items) console.log(`     商品：${mod.items.map(i => i.title.split('\n')[0] + (i.price ? ` ¥${i.price}` : '（无价格）')).join(' | ')}`);
  if (mod.text) console.log(`     文案：${mod.text}`);
}

const html = await readFile(`${d}/preview.html`, 'utf8');
const photoIds = [...html.matchAll(/data-photo="([^"]+)"/g)].map(x => x[1]);
console.log(`\n页面 image 位 (${photoIds.length})：${photoIds.join(' ')}`);
console.log(`页面是否引用占位图：${html.includes('_missing.png')}`);
console.log(`页面是否残留 slotId 作为 src：${/src="m\d+\.img\d+"/.test(html)}`);

console.log('\n素材来源统计：');
const bySource = {};
for (const a of m.assetFiles) bySource[a.source] = (bySource[a.source] || 0) + 1;
for (const [k, v] of Object.entries(bySource)) console.log(`  ${k}: ${v} 张`);
console.log('\n素材质量：');
for (const a of m.assetFiles) {
  console.log(`  ${a.slotId.padEnd(11)} 原生 ${String(a.nativePixels.join('×')).padEnd(10)} 交付 ${a.deliveredPixels.join('×').padEnd(10)} ${a.upscaled ? '放大' : '未放大'}${a.separatorPixels != null ? ` 残留品红 ${a.separatorPixels}px` : ''}${a.removedAreaPercent != null ? ` 裁切丢弃 ${a.removedAreaPercent}%` : ''}`);
}

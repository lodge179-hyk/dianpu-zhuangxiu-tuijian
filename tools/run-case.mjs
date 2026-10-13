/**
 * 用指定截图跑一次真实案例（会产生模型费用）。
 * 用法：node tools/run-case.mjs "<截图路径>"
 * 它会：提交 → 轮询真实进度 → 打印每一步的真实结果与素材质量指标。
 */
const BASE = 'http://127.0.0.1:5191';
const file = process.argv[2];
if (!file) { console.error('用法：node tools/run-case.mjs <截图路径>'); process.exit(1); }

const { readFile } = await import('node:fs/promises');
const bytes = await readFile(file);
const name = file.split(/[\\/]/).pop();
console.log(`提交 ${name}（${(bytes.length / 1048576).toFixed(2)} MB）`);

const form = new FormData();
form.append('screenshot', new Blob([bytes], { type: 'image/jpeg' }), name);
const t0 = Date.now();
const res = await fetch(`${BASE}/api/generate?confirm=1`, { method: 'POST', headers: { Origin: BASE }, body: form });
const body = await res.json().catch(() => ({}));
if (!res.ok) { console.error('提交被拒绝：', res.status, JSON.stringify(body)); process.exit(1); }
const id = body.id;
console.log(`任务 ${id} 已开始（识别 1 次 + 决策 1 次 + 生图 1 次起）\n`);

let lastStage = '';
for (;;) {
  await new Promise(r => setTimeout(r, 3000));
  let state = null;
  try { state = await fetch(`${BASE}/runs/${id}/run.json`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null); } catch { /* 重试 */ }
  if (!state) continue;
  if (state.stage !== lastStage) {
    lastStage = state.stage;
    console.log(`[${Math.round((Date.now() - t0) / 1000)}s] 第 ${state.step}/${state.totalSteps} 步 · ${state.stage}`);
  }
  if (state.status !== 'running') {
    console.log(`\n=== 终态：${state.status} · ${state.stage} · 总耗时 ${Math.round((Date.now() - t0) / 1000)}s ===`);
    console.log('调用记录：');
    for (const c of state.calls || []) console.log(`  ${c.kind.padEnd(24)} ${c.status}${c.error ? ' — ' + c.error : ''}${c.hint ? ' | ' + String(c.hint).slice(0, 120) : ''}`);
    if (state.error) console.log(`错误：${state.error}\n提示：${state.errorHint || ''}`);

    if (state.shop) {
      console.log('\n--- AI 看到的店铺 ---');
      console.log(`店名：${state.shop.shopName || '(未识别)'}  品类：${state.shop.category || '(未识别)'}`);
      console.log(`定位：${state.shop.positioning || ''}`);
      console.log(`可见商品 ${state.shop.visibleProducts?.length || 0} 件：${(state.shop.visibleProducts || []).map(p => `${p.name}${p.box ? '(有框)' : '(无框)'}`).join('、')}`);
      console.log(`信息缺口：${(state.shop.confidence?.missing || []).join('、') || '无'}`);
    }
    if (state.design) {
      console.log('\n--- AI 的装修决策 ---');
      console.log(`方案：${state.design.title} —— ${state.design.summary}`);
      for (const d of state.design.decisions || []) console.log(`  · ${d.topic}：${d.choice}\n    理由：${d.reason}`);
      console.log(`风格关键词：${(state.design.styleKeywords || []).join('、')}`);
      console.log(`生图约束：${(state.design.imagePlan?.constraints || []).join('；')}`);
      const images = state.design.imagePlan?.images || [];
      console.log(`生图计划 ${images.length} 张画布：`);
      for (const img of images) console.log(`  · ${img.id}（${img.purpose}）：${img.slots.length} 格 → ${img.slots.map(s => s.slotId).join(', ')}`);
    }
    if (state.validation) {
      console.log(`\n校验：${state.validation.slotCount} 个图片位 · 生成 ${state.validation.generatedSlotCount} · 截图裁切 ${state.validation.productSlotCount} · 生图 ${state.validation.sheets} 次`);
    }
    if (state.sheet) {
      console.log('\n--- 素材画布 ---');
      for (const [k, v] of Object.entries(state.sheet)) console.log(`  ${k}: 请求 ${v.requested ? v.requested.width + '×' + v.requested.height : '—'} → 实际 ${v.actual ? v.actual.join('×') : '—'}，${v.panels ?? '—'} 格${v.failed ? ' 失败：' + v.failed : ''}`);
    }
    if ((state.assets || []).length) {
      console.log('\n--- 素材清单 ---');
      for (const a of state.assets) {
        console.log(`  ${a.slotId.padEnd(14)} ${a.file.padEnd(22)} ${String(a.source).padEnd(20)} 交付 ${a.deliveredPixels.join('×')}${a.upscaled ? ' 放大' : ''}${a.accurate === false ? ' 未定位' : ''}`);
      }
    }
    if (state.render) console.log(`\n页面：${state.render.width}×${state.render.height}px · ${state.render.moduleCount} 个模块 · ${state.render.photos} 个图片位`);
    if ((state.warnings || []).length) {
      console.log('\n--- 真实说明 ---');
      state.warnings.forEach(w => console.log('  · ' + w));
    }
    console.log(`\n预览：${BASE}/runs/${id}/preview.html`);
    console.log(`清单：${BASE}/runs/${id}/manifest.json`);
    console.log(`RUN_ID=${id}`);
    break;
  }
}

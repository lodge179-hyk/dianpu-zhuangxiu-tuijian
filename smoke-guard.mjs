// 只验证提交通道与费用保护，不触发任何模型调用。
import sharp from 'sharp';

const BASE = 'http://127.0.0.1:5191';
const png = await sharp({ create: { width: 483, height: 900, channels: 3, background: '#efe6da' } }).png().toBuffer();

const post = async (url, blob, type = 'image/png', name = 't.png') => {
  const form = new FormData();
  form.append('screenshot', new Blob([blob], { type }), name);
  const r = await fetch(url, { method: 'POST', headers: { Origin: BASE }, body: form });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

const noConfirm = await post(`${BASE}/api/generate`, png);
console.log('不带 confirm:', noConfirm.status, JSON.stringify(noConfirm.body).slice(0, 160));

const badType = await post(`${BASE}/api/generate?confirm=1`, Buffer.from('xx'), 'text/plain', 'a.txt');
console.log('非法类型    :', badType.status, JSON.stringify(badType.body));

const forged = await fetch(`${BASE}/api/generate?confirm=1`, { method: 'POST', headers: { Origin: 'http://evil.example' } });
console.log('伪造来源    :', forged.status, JSON.stringify(await forged.json()));

// 计划预检接口（纯本地，不调用模型）
const { normalizePlan } = await import('./src/plan.mjs');
const sample = normalizePlan({ design: { title: 'x' }, modules: [{ id: 'm01', type: '不存在', content: {} }] }, {});
const pre = await fetch(`${BASE}/api/preview-plan`, {
  method: 'POST', headers: { Origin: BASE, 'Content-Type': 'application/json' }, body: JSON.stringify(sample),
});
const preBody = await pre.json();
console.log('计划预检    :', pre.status, preBody.validation.ok ? '通过' : '拦下 → ' + preBody.validation.errors[0]);
console.log('服务是否空闲:', (await fetch(`${BASE}/api/status`).then(r => r.json())).busy ? '忙' : '空闲');
console.log('任务目录数  :', (await import('node:fs/promises')).readdir('output/runs').then(a => a.length));

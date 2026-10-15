const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { writeJson, batchSize, recoverSheet } = require('./qwen-provider.cjs');

const MODEL = 'doubao-seedream-5-0-pro-260628';
function imageSettings(env = process.env) {
  return { key: env.ARK_API_KEY || '', model: env.ARK_IMAGE_MODEL || MODEL, endpoint: env.ARK_IMAGE_ENDPOINT || 'https://ark.cn-beijing.volces.com/api/v3/images/generations' };
}
function publicImageSettings(env = process.env) {
  const c = imageSettings(env);
  return { imageConfigured: !!c.key && c.model === MODEL, imageProvider: '火山引擎', imageModel: c.model, imageConfigurationError: c.model !== MODEL ? '请将 ARK_IMAGE_MODEL 配置为 ' + MODEL : !c.key ? '请配置 ARK_API_KEY' : null };
}
async function generateSheet(folder, plan, batch, attempt, { fetcher = fetch } = {}) {
  const c = imageSettings();
  if (c.model !== MODEL) throw Error('本流程使用原来的火山 Seedream 5 Pro，请将 ARK_IMAGE_MODEL 配置为 ' + MODEL + '。未调用其他模型。');
  if (!c.key) throw Error('尚未配置 ARK_API_KEY，未发起生图。');
  const stage = `${batch.id}-attempt-${attempt}`;
  const body = { model: c.model, prompt: batch.prompt, size: batchSize(plan, batch).replace('*', 'x'), stream: false, response_format: 'b64_json', watermark: false };
  // Seedream 5 Pro produces one sheet; do not send Qwen parameters or group-generation options.
  if (batch.referenceBatchId) {
    const file = path.join(folder, `${batch.referenceBatchId}-source.png`);
    if (!fs.existsSync(file)) throw Error('上一批总图尚未成功填入，暂不能生成本批。');
    const image = await sharp(file).resize({ width: 1800, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    body.image = 'data:image/jpeg;base64,' + image.toString('base64');
  }
  fs.writeFileSync(path.join(folder, `${stage}-prompt.txt`), batch.prompt);
  writeJson(folder, `${stage}-settings.json`, { provider: 'volcengine', model: c.model, size: body.size, stream: false, response_format: body.response_format, watermark: false, referenceBatchId: batch.referenceBatchId, productReferences: '商品为品类示意，不要求复刻输入SKU' });
  const record = { provider: 'volcengine', stage, model: c.model, startedAt: new Date().toISOString(), requestAttempts: 1, automaticRetries: 0, status: 'started' };
  const audit = `${stage}-call.json`, start = Date.now(); writeJson(folder, audit, record);
  let response, raw;
  try {
    response = await fetcher(c.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(600000) });
    record.httpStatus = response.status;
    raw = await response.text();
  } catch {
    record.status = 'transport-unknown'; record.durationMs = Date.now() - start; writeJson(folder, audit, record);
    throw Error('火山生图请求连接中断或超时，结果及计费未确认；没有自动重试。');
  }
  record.durationMs = Date.now() - start;
  let data; try { data = JSON.parse(raw); } catch { data = null; }
  if (!response.ok || data?.error) {
    record.status = 'failed'; record.code = String(data?.error?.code || '').slice(0, 100); record.message = String(data?.error?.message || '').slice(0, 600); writeJson(folder, audit, record);
    const hint = /Overdue|Balance|Arrearage/.test(record.code) ? '请核对火山账户余额和计费状态。' : /AccessDenied|Unauthorized|InvalidApiKey|Authentication/.test(record.code) ? '请核对火山密钥及模型权限。' : '';
    throw Error(`火山生图返回 HTTP ${response.status}${record.code ? ' / ' + record.code : ''}。${hint}没有自动重试。`);
  }
  if (!data || typeof data !== 'object') { record.status = 'invalid-response'; writeJson(folder, audit, record); throw Error('火山生图未返回有效的响应对象，没有自动重试。'); }
  const part = data.data?.[0];
  if (!part?.b64_json && !part?.url) { record.status = 'invalid-response'; writeJson(folder, audit, record); throw Error('火山生图接口没有返回图片，未重试。'); }
  // Persist the response before normalization so download/crop errors never require a new generation.
  writeJson(folder, `${stage}-image.json`, { provider: 'volcengine', url: part.b64_json ? 'data:image/png;base64,' + part.b64_json : part.url, receivedAt: new Date().toISOString() });
  record.status = 'completed'; record.usage = data.usage || null; writeJson(folder, audit, record);
  return recoverSheet(folder, batch, attempt, { fetcher });
}
module.exports = { MODEL, imageSettings, publicImageSettings, generateSheet, recoverSheet };

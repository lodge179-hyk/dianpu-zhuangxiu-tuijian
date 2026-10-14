const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { jsonrepair } = require('jsonrepair');

function settings(env = process.env) {
  const base = (env.PLANNER_DASHSCOPE_BASE_URL || (env.DASHSCOPE_WORKSPACE_ID ? `https://${env.DASHSCOPE_WORKSPACE_ID}.cn-beijing.maas.aliyuncs.com` : 'https://dashscope.aliyuncs.com')).replace(/\/$/, '');
  return { base, key: env.DASHSCOPE_API_KEY || '', vision: env.PLANNER_VISION_MODEL || 'qwen3.5-plus', search: env.PLANNER_SEARCH_MODEL || 'qwen-plus', image: env.PLANNER_IMAGE_MODEL || 'qwen-image-3.0-pro' };
}
function publicSettings() {
  const c = settings();
  return { configured: !!c.key, visionModel: c.vision, searchModel: c.search, imageModel: c.image, provider: '阿里云百炼', oldProviderDisabled: true };
}
function redact(text) {
  let value = String(text);
  for (const [key, secret] of Object.entries(process.env)) if (/API_KEY|TOKEN|SECRET/.test(key) && secret?.length >= 6) value = value.replaceAll(secret, '[已隐藏]');
  return value.replace(/sk-[a-zA-Z0-9_-]{12,}/g, '[已隐藏]');
}
function writeJson(folder, name, value) { fs.writeFileSync(path.join(folder, name), redact(JSON.stringify(value, null, 2))); }
function responseText(payload) {
  const content = payload.output?.choices?.[0]?.message?.content ?? payload.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : Array.isArray(content) ? content.map(p => p.text || '').join('') : '';
}
function parseJson(text, folder, stage) {
  const source = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(source); } catch {}
  try {
    const fixed = jsonrepair(source);
    // Accept only inserted quote escapes. Never complete truncated JSON or invent missing values.
    let i = 0, inserted = 0;
    for (let j = 0; j < fixed.length; j++) {
      if (fixed[j] === source[i]) { i++; continue; }
      if (fixed[j] === '\\' && fixed[j + 1] === '"' && source[i] === '"') { inserted++; continue; }
      throw Error('Unsupported repair');
    }
    if (i !== source.length || !inserted) throw Error('Unsupported repair');
    const value = JSON.parse(fixed);
    if (folder && stage) writeJson(folder, `${stage}-parse-repair.json`, { method: 'escape-interior-quotes-only', insertedEscapes: inserted, modelRequests: 0 });
    return value;
  } catch { throw Error('模型返回的 JSON 格式不正确或内容被截断，原始文本已保存；没有自动重试。'); }
}
async function call(folder, stage, model, payload, { textOnly = false, timeout = 240000, fetcher = fetch } = {}) {
  const config = settings();
  if (!config.key) throw Error('尚未配置 DASHSCOPE_API_KEY，无法调用千问。旧火山模型已停用。');
  if (!/^qwen[\w.\-]*$/.test(model)) throw Error('此流程仅允许已配置的千问模型，不会调用旧火山模型。');
  const record = { stage, model, startedAt: new Date().toISOString(), requestAttempts: 1, automaticRetries: 0, status: 'started', usage: null };
  const auditFile = `${stage}-call.json`, started = Date.now();
  writeJson(folder, auditFile, record);
  let response, data;
  try {
    response = await fetcher(`${config.base}/api/v1/services/aigc/${textOnly ? 'text' : 'multimodal'}-generation/generation`, { method: 'POST', headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeout), body: JSON.stringify({ model, ...payload }) });
    record.httpStatus = response.status;
    data = await response.json();
  } catch {
    Object.assign(record, { status: 'transport-unknown', durationMs: Date.now() - started }); writeJson(folder, auditFile, record);
    throw Error('模型响应未完整取得，结果及计费未确认；没有自动重试。');
  }
  record.durationMs = Date.now() - started;
  record.requestId = data.request_id || data.id || null;
  record.usage = data.usage || null;
  record.finishReason = data.output?.choices?.[0]?.finish_reason || null;
  if (!response.ok || data.code || data.error) {
    const code = String(data.code || data.error?.code || '').replace(/[^\w.\-]/g, '').slice(0, 80);
    Object.assign(record, { status: 'failed', errorCode: code, errorMessage: String(data.message || data.error?.message || '').slice(0, 800) }); writeJson(folder, auditFile, record);
    const hint = /InvalidApiKey|AccessDenied|Unauthorized/i.test(code) ? '请核对百炼密钥、地域与模型权限。' : /Arrearage|Overdue|Balance/i.test(code) ? '请核对百炼账户可用额度。' : '';
    throw Error(`千问服务返回 HTTP ${response.status}${code ? ' / ' + code : ''}。${hint}没有自动重试。`);
  }
  record.status = 'completed'; writeJson(folder, auditFile, record);
  fs.writeFileSync(path.join(folder, `${stage}-response.txt`), redact(responseText(data)));
  return data;
}
async function ask(folder, stage, system, input, { images = [], search = false, fetcher } = {}) {
  fs.writeFileSync(path.join(folder, `${stage}-instructions.txt`), system);
  writeJson(folder, `${stage}-input.json`, input);
  const c = settings(), text = JSON.stringify(input);
  const messages = search ? [{ role: 'system', content: system }, { role: 'user', content: text }] : [{ role: 'system', content: [{ text: system }] }, { role: 'user', content: [{ text }, ...images.map(image => ({ image }))] }];
  const parameters = { result_format: 'message', max_tokens: 10000, enable_thinking: false, ...(search ? { enable_search: true, search_options: { forced_search: true, enable_source: true, search_strategy: 'max' } } : { response_format: { type: 'json_object' } }) };
  return call(folder, stage, search ? c.search : c.vision, { input: { messages }, parameters }, { textOnly: search, fetcher });
}
async function askJson(...args) {
  const payload = await ask(...args);
  if (payload.output?.choices?.[0]?.finish_reason === 'length') throw Error('模型输出达到长度上限，内容被截断；原始文本已保存，没有自动重试。');
  return { value: parseJson(responseText(payload), args[0], args[1]), payload };
}
async function searchWeb(folder, stage, system, input, options = {}) {
  // Search answers are unverified model prose. Only provider search records become selectable sources.
  return searchSources(await ask(folder, stage, system, input, { ...options, search: true }));
}
function publicSourceUrl(value) {
  try {
    const u = new URL(value);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || !u.hostname.includes('.') || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname) || u.hostname.includes(':')) return null;
    u.hash = ''; return u.href;
  } catch { return null; }
}
function searchSources(payload) {
  const results = payload.output?.search_info?.search_results || payload.search_info?.search_results || [];
  const seen = new Set();
  return results.flatMap(item => { const url = publicSourceUrl(item.url || item.link); if (!url || seen.has(url)) return []; seen.add(url); return [{ url, title: String(item.title || item.name || new URL(url).hostname).slice(0, 160) }]; });
}
function batchSize(plan, batch) {
  const { aspectRatios } = require('./plan.cjs');
  const ratio = batch.rows.reduce((sum, row) => sum + 1 / (row.length * aspectRatios[plan.assets.find(a => a.id === row[0]).aspect]), 0);
  const width = Math.floor(Math.sqrt(2048 * 2048 / ratio) / 16) * 16;
  return `${width}*${Math.floor(width * ratio / 16) * 16}`;
}
async function imageBytes(url, fetcher = fetch) {
  const data = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(url || '');
  if (data) { const bytes = Buffer.from(data[2], 'base64'); if (bytes.length > 30 * 1024 * 1024) throw Error('生成图片超过 30MB。'); return bytes; }
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !/(^|\.)(aliyuncs\.com|alicdn\.com)$/.test(parsed.hostname)) throw Error('生成图片地址不是受支持的百炼资源地址，未下载。');
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw Error('生成图片下载失败。');
  const chunks = []; let length = 0;
  for await (const part of response.body) { length += part.length; if (length > 30 * 1024 * 1024) { await response.body.cancel?.().catch(() => {}); throw Error('生成图片超过 30MB。'); } chunks.push(part); }
  return Buffer.concat(chunks);
}
async function generateSheet(folder, plan, batch, attempt, { fetcher } = {}) {
  const content = [{ text: batch.prompt }];
  if (batch.referenceBatchId) {
    const file = path.join(folder, `${batch.referenceBatchId}-source.png`);
    if (!fs.existsSync(file)) throw Error('上一批总图尚未成功填入，暂不能生成本批。');
    const reference = await sharp(file).resize({ width: 1800, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    content.unshift({ image: 'data:image/jpeg;base64,' + reference.toString('base64') });
  }
  const stage = `${batch.id}-attempt-${attempt}`, parameters = { n: 1, size: batchSize(plan, batch), prompt_extend: false, watermark: false };
  fs.writeFileSync(path.join(folder, `${stage}-prompt.txt`), batch.prompt);
  writeJson(folder, `${stage}-settings.json`, { model: settings().image, parameters, referenceBatchId: batch.referenceBatchId, productReferences: '商品为品类示意，不要求复刻输入 SKU' });
  const payload = await call(folder, stage, settings().image, { input: { messages: [{ role: 'user', content }] }, parameters }, { timeout: 600000, fetcher });
  const image = payload.output?.choices?.[0]?.message?.content?.find(c => c.image)?.image;
  if (!image) throw Error('生图接口没有返回图片，未重试。');
  const bytes = await imageBytes(image, fetcher);
  // Save the unmodified output even when separator detection subsequently fails.
  await sharp(bytes, { limitInputPixels: 40000000 }).png().toFile(path.join(folder, `${stage}-source.png`));
  return bytes;
}
module.exports = { settings, publicSettings, redact, writeJson, parseJson, askJson, searchWeb, searchSources, publicSourceUrl, batchSize, generateSheet, imageBytes };

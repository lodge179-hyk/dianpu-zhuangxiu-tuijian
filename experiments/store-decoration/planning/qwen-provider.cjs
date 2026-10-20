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
  const image = require('./ark-image-provider.cjs').publicImageSettings();
  return { configured: !!c.key && image.imageConfigured, plannerConfigured: !!c.key, visionModel: c.vision, searchModel: c.search, planningProvider: '阿里云百炼', ...image };
}
function redact(text) {
  let value = String(text);
  for (const [key, secret] of Object.entries(process.env)) if (/API_KEY|TOKEN|SECRET/.test(key) && secret?.length >= 6) value = value.replaceAll(secret, '[已隐藏]');
  return value.replace(/sk-[a-zA-Z0-9_-]{12,}/g, '[已隐藏]');
}
function writeJson(folder, name, value) {
  const file = path.join(folder, name), temporary = file + '.tmp';
  fs.writeFileSync(temporary, redact(JSON.stringify(value, null, 2))); fs.renameSync(temporary, file);
}
function responseText(payload) {
  const content = payload.output?.choices?.[0]?.message?.content ?? payload.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : Array.isArray(content) ? content.map(p => p?.text || '').join('') : '';
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
  if (!config.key) throw Error('尚未配置 DASHSCOPE_API_KEY，无法调用千问规划。');
  if (!/^qwen[\w.\-]*$/.test(model)) throw Error('识别与文字规划仅允许已配置的千问模型。');
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
    throw Error(`模型响应未完整取得${record.httpStatus ? `（HTTP ${record.httpStatus}）` : ''}，结果及计费未确认；没有自动重试。`);
  }
  record.durationMs = Date.now() - started;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    record.status = 'invalid-response'; writeJson(folder, auditFile, record);
    throw Error('模型服务没有返回有效的响应对象；已保存调用记录，没有自动重试。');
  }
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
async function ask(folder, stage, system, input, { images = [], search = false, temperature, jsonMode = true, maxTokens = 10000, fetcher } = {}) {
  fs.writeFileSync(path.join(folder, `${stage}-instructions.txt`), system);
  writeJson(folder, `${stage}-input.json`, input);
  const c = settings(), text = JSON.stringify(input);
  const messages = search ? [{ role: 'system', content: system }, { role: 'user', content: text }] : [{ role: 'system', content: [{ text: system }] }, { role: 'user', content: [{ text }, ...images.map(image => ({ image }))] }];
  if (typeof jsonMode !== 'boolean' || (search && !jsonMode)) throw Error('模型输出模式参数无效，尚未请求模型。');
  if(!Number.isInteger(maxTokens)||maxTokens<1000||maxTokens>24000)throw Error('规划输出长度参数无效。');
  const parameters = { result_format: 'message', max_tokens: maxTokens, enable_thinking: false, ...(search ? { enable_search: true, search_options: { forced_search: true, enable_source: true, search_strategy: 'max' } } : jsonMode ? { response_format: { type: 'json_object' } } : {}) };
  // Opt-in for extraction only. Creative, legacy and search callers retain
  // their original sampling; do not add a provider-wide default or retry.
  if (temperature !== undefined) {
    if (search || !Number.isFinite(temperature) || temperature < 0 || temperature >= 2) throw Error('识别采样参数无效，尚未请求模型。');
    parameters.temperature = temperature;
  }
  if (temperature !== undefined || !jsonMode) writeJson(folder, `${stage}-settings.json`, { model: c.vision, parameters, inputImageCount: images.length, outputMode: jsonMode ? 'json_object' : 'prompt-json' });
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
  const raw = payload.output?.search_info?.search_results || payload.search_info?.search_results;
  const results = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  return results.flatMap(item => { const url = publicSourceUrl(item?.url || item?.link); if (!url || seen.has(url)) return []; seen.add(url); return [{ url, title: String(item.title || item.name || new URL(url).hostname).slice(0, 160) }]; });
}
function batchSize(plan, batch) {
  const { aspectRatios } = require('./plan.cjs');
  const ratio = batch.rows.reduce((sum, row) => sum + 1 / (row.length * aspectRatios[plan.assets.find(a => a.id === row[0]).aspect]), 0);
  const width = Math.floor(Math.sqrt(2048 * 2048 / ratio) / 16) * 16;
  return `${width}*${Math.floor(width * ratio / 16) * 16}`;
}
async function imageBytes(url, fetcher = fetch, provider = 'dashscope') {
  const data = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(url || '');
  if (data) { const bytes = Buffer.from(data[2], 'base64'); if (bytes.length > 30 * 1024 * 1024) throw Error('生成图片超过 30MB。'); return bytes; }
  let parsed; try { parsed = new URL(url); } catch { throw Error('生图返回的图片地址无效，未下载。'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port && parsed.port !== '443' || !(provider === 'volcengine' ? /(^|\.)(volces\.com|byteimg\.com)$/ : /(^|\.)(aliyuncs\.com|alicdn\.com)$/).test(parsed.hostname)) throw Error('生成图片地址不是受支持的生图服务资源地址，未下载。');
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw Error(`图片已生成，但下载返回 HTTP ${response.status}；可以继续下载，无须重新生图。`);
  const chunks = []; let length = 0;
  for await (const part of response.body) { length += part.length; if (length > 30 * 1024 * 1024) { await response.body.cancel?.().catch(() => {}); throw Error('生成图片超过 30MB。'); } chunks.push(part); }
  return Buffer.concat(chunks);
}
async function recoverSheet(folder, batch, attempt, { fetcher } = {}) {
  if (!Number.isInteger(attempt) || attempt < 1) return null;
  const stage = `${batch.id}-attempt-${attempt}`, file = path.join(folder, `${stage}-source.png`), manifest = path.join(folder, `${stage}-image.json`);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  if (!fs.existsSync(manifest)) return null;
  try {
    const saved = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const bytes = await imageBytes(saved.url, fetcher, saved.provider);
    let normalized;
    try { normalized = await sharp(bytes, { limitInputPixels: 40000000 }).rotate().png().toBuffer(); }
    catch { throw Error('已取得生图地址，但下载内容不是可用图片或尺寸超限；地址已保留，可继续下载，无须立即重新生图。'); }
    fs.writeFileSync(file + '.tmp', normalized); fs.renameSync(file + '.tmp', file);
    return normalized;
  } catch (error) { error.phase = 'download'; throw error; }
}
module.exports = { settings, publicSettings, redact, writeJson, parseJson, askJson, searchWeb, searchSources, publicSourceUrl, batchSize, recoverSheet, imageBytes };

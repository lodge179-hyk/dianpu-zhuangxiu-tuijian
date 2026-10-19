const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { writeJson, batchSize, recoverSheet } = require('./qwen-provider.cjs');
const { prepareGenerationReferences } = require('./visual-skill.cjs');

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
  const visual = await prepareGenerationReferences(folder, batch.visualReferences);
  const images = [...visual.images];
  let previousSheetAttachment = null;
  // Seedream 5 Pro produces one sheet; do not send Qwen parameters or group-generation options.
  if (batch.referenceBatchId) {
    const file = path.join(folder, `${batch.referenceBatchId}-source.png`);
    if (!fs.existsSync(file)) throw Error('上一批总图尚未成功填入，暂不能生成本批。');
    const image = await sharp(file).resize({ width: 1800, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    images.push('data:image/jpeg;base64,' + image.toString('base64'));
    previousSheetAttachment = images.length;
  }
  // The official image API accepts a string or string[]. Keep legacy single-reference requests unchanged.
  if (images.length) body.image = images.length === 1 ? images[0] : images;
  if (visual.records.length) {
    const referenceBackground = batch.backgroundGuidance === 'reference-background-v1';
    const plannedReference = batch.backgroundGuidance === 'planned-reference-v1';
    const referenceGuide = [
      plannedReference
        ? '【输入图片用途与整页计划】按下文各格已定的商品、场景、构图、尺度及明暗安排创作总图，不拼贴输入图片。参考照片只用于该格“借鉴”所明确的焦点、空间或光影关系，不自动继承整套背景；实际场景和视觉强度以该格描述为准，不能把清楚浏览图改成与主图相同的复杂布景，也不能把丰富场景简化成素底摆拍。案例商品、品牌、文字、UI和真实商品属性不继承。行列、比例和洋红分隔带按正文要求。'
        : referenceBackground
        ? '【输入图片用途与优先关系】请新创作下述总图，不拼贴输入图片。商品内容、经营类型及主要外观方向以各格描述为准；行列、比例和洋红分隔带以正文要求为准。案例中的商品、品牌、文字、UI、价格及无关道具不继承。仅在背景表现上，各格指定案例及“保留”说明优先于泛化的深暗背景、冷硬光、哑光台面等文字，也优先于上一批总图。保留所选案例的亮暗面积分布、过渡方向、表面纹理与阴影/倒影关系；可沿用适合商品的背景颜色，需要换色时仍保留上述关系，不能把大面积亮面变成暗底上的小光斑。背景颜色不改变商品本色或材质。'
        : '【输入图片用途】请新创作下述总图，不是编辑、拼贴或复制输入图片。案例照片只提供视觉语言，商品内容完全以各格描述为准。案例中的商品、品牌、文字、UI、价格、配色及道具不自动继承，不增加未经营品类，不改变本次商品的经营类型及主要外观方向。总图的行列、比例和洋红分隔带以正文要求为准。',
      ...visual.records.map(ref => `参考图片${ref.attachment}是视觉案例，仅用于以下格子：\n` + ref.uses.map(use => referenceBackground
        ? `第${use.row}行第${use.column}格：保留：${use.borrow}；排除：${use.avoid}`
        : `第${use.row}行第${use.column}格：借鉴${use.borrow}；不继承${use.avoid}`).join('\n')),
      previousSheetAttachment ? (plannedReference
        ? `参考图片${previousSheetAttachment}是上一批总图，仅辅助保持表面质感与色彩联系；本批的场景、明暗、主次尺度和款式以各格已定计划为准，不复制上一批布景。`
        : referenceBackground
        ? `参考图片${previousSheetAttachment}是本任务上一批总图，只辅助保持商品本色与表面表现，不用于决定本批背景、色温、反差、布景或格子布局。本批背景按上面各格指定案例与“保留”说明呈现。`
        : `参考图片${previousSheetAttachment}是本任务上一批总图，只维持色彩关系、白平衡、反差和质感；不复刻其商品、布景或格子布局。各格的视觉力度遵循指定案例与本图提示，不将已有平淡画面当作质量上限。`) : '',
    ].filter(Boolean).join('\n\n');
    body.prompt = referenceGuide + '\n\n' + batch.prompt;
  }
  fs.writeFileSync(path.join(folder, `${stage}-prompt.txt`), body.prompt);
  writeJson(folder, `${stage}-settings.json`, { provider: 'volcengine', model: c.model, size: body.size, stream: false, response_format: body.response_format, watermark: false, referenceBatchId: batch.referenceBatchId, ...(visual.records.length ? { visualReferences: visual.records, previousSheetAttachment, inputImageCount: images.length, ...(batch.backgroundGuidance ? { backgroundGuidance: batch.backgroundGuidance } : {}) } : {}), productReferences: '商品为品类示意，不要求复刻输入SKU；上传商品截图不作为火山视觉案例输入' });
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

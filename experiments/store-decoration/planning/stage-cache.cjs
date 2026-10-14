const fs = require('fs');
const path = require('path');
const { parseJson } = require('./qwen-provider.cjs');
function stages(folder, base) {
  const pattern = new RegExp(`^${base}(?:-attempt-(\\d+))?-call\\.json$`);
  return fs.readdirSync(folder).flatMap(file => { const m = pattern.exec(file); return m ? [{ name: file.slice(0, -10), attempt: Number(m[1] || 1) }] : []; }).sort((a, b) => b.attempt - a.attempt);
}
function nextStage(folder, base) {
  const attempt = (stages(folder, base)[0]?.attempt || 0) + 1;
  return { attempt, name: attempt === 1 && base !== 'style' ? base : `${base}-attempt-${attempt}` };
}
function cachedStage(folder, base, validate) {
  const latest = stages(folder, base)[0];
  if (!latest) return null;
  try {
    const audit = JSON.parse(fs.readFileSync(path.join(folder, latest.name + '-call.json'), 'utf8'));
    if (audit.status !== 'completed' || audit.finishReason === 'length') return null;
    return { ...latest, value: validate(parseJson(fs.readFileSync(path.join(folder, latest.name + '-response.txt'), 'utf8'), folder, latest.name)) };
  } catch { return null; }
}
module.exports = { stages, nextStage, cachedStage };

const { z } = require('zod');
const { evidenceFor } = require('./content-plan.cjs');

// Only a saved revision with isolated reference failures is eligible. Structural
// changes still use the full revision; this never adds an automatic retry.
function referenceRepairTargets(revision, recognition, profile) {
  const changes = revision?.reviewContext?.requiredChanges;
  if (!(profile?.studio?.version >= 2 && profile.studio.options.preserveProducts)
    || changes?.code !== 'STOREFRONT_PRODUCT_REFERENCES'
    || changes.schemaIssues?.length || changes.studioIssues?.length || changes.copyIssues?.length
    || changes.reduceByAtLeast || !changes.referenceIssues?.length) return null;
  const evidence = new Map(evidenceFor(recognition, profile).map(item => [item.id, item]));
  const collection = revision.creative.content.collection;
  if (collection.some(item => {
    const source = evidence.get(item.sourceEvidenceId);
    return !source?.imageIndex || source.category !== item.category;
  })) return null;
  const targets = changes.referenceIssues.map(issue => {
    const match = /^content\.modules\.(\d+)\.visuals\.(\d+)$/.exec(issue.path);
    if (!match) return null;
    const moduleIndex = Number(match[1]), visualIndex = Number(match[2]);
    const module = revision.creative.content.modules[moduleIndex], visual = module?.visuals[visualIndex];
    if (!visual || module.type.startsWith('signboard.')) return null;
    return { moduleIndex, visualIndex, module: { type: module.type, chapter: module.chapter, message: module.message },
      visual, problem: issue.reason };
  });
  return targets.every(Boolean) ? targets : null;
}

function applyReferenceRepair(creative, targets, response) {
  const result = z.object({ repairs: z.array(z.object({
    moduleIndex: z.number().int().nonnegative(), visualIndex: z.number().int().nonnegative(),
    designIds: z.array(z.string().min(1)).min(1).max(40),
    subject: z.string().trim().min(1).max(180),
    picture: z.string().trim().min(1).max(600),
    difference: z.string().trim().min(1).max(160),
  }).strict()).length(targets.length) }).strict().parse(response);
  const pending = new Set(targets.map(t => `${t.moduleIndex}:${t.visualIndex}`));
  const designs = new Map(creative.content.collection.map(item => [item.id, item]));
  const repaired = structuredClone(creative);
  for (const patch of result.repairs) {
    if (!pending.delete(`${patch.moduleIndex}:${patch.visualIndex}`)) throw Error('局部修订重复或越过待修复画面，已保留响应。');
    if (new Set(patch.designIds).size !== patch.designIds.length
      || patch.designIds.some(id => !designs.get(id)?.sourceEvidenceId)) throw Error('局部修订必须选择已定义的原商品款式，不能空选、重复或编造编号。');
    const visual = repaired.content.modules[patch.moduleIndex].visuals[patch.visualIndex];
    visual.subject = patch.subject;
    visual.visualPlan = { ...visual.visualPlan, designIds: patch.designIds, picture: patch.picture, difference: patch.difference };
    // The model chooses actual products; the program follows their already
    // validated source IDs, without asking for a second, conflicting ID list.
    visual.evidenceIds = [...new Set(patch.designIds.map(id => designs.get(id).sourceEvidenceId))];
  }
  return repaired;
}

const referenceRepairPrompt = [
  '你正在修复已完成店铺方案中少量画面的商品选择。只返回待修复画面的实际数据，不重写整页，不写解释或JSON Schema。',
  '商品保真已开启。查看所附原商品图片及collection，按每个画面的用途自行选择实际入画款式，填写非空designIds。多商品群像也必须明确选择；不能把主轮播图当作无商品氛围图。',
  '同时重写subject、picture和difference，明确所选商品的可见外观、数量、各自位置和人物接触关系；不只补编号而保留不对应的构图，不混合不同商品的结构或改掉原标识。保留本图既定机位、图像形式、文字及其位置，风格服从style。参考案例不提供商品身份。',
  '仅返回{repairs:[...]}。每项包含moduleIndex、visualIndex（照抄输入的零起始编号）、designIds（仅从collection.id选择）、subject（1至180字）、picture（1至600字）、difference（1至160字）。每个待修复画面恰好一项。无需输出evidenceIds，程序按已选款式的sourceEvidenceId关联原图；其他字段与整页模块原样保留。',
].join('\n\n');

module.exports = { referenceRepairTargets, applyReferenceRepair, referenceRepairPrompt };

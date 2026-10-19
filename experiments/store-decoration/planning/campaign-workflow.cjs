const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { z } = require('zod');
const { planSchema, validatePlan } = require('./plan.cjs');
const { compileContent, evidenceFor } = require('./content-plan.cjs');
const { applyDesign } = require('./model-contracts.cjs');
const { campaignPrompt, usesCampaignIdentity } = require('./campaign-contract.cjs');
const { usesNarrativePage } = require('./narrative-contract.cjs');
const { compileNarrative } = require('./narrative-plan.cjs');
const { prepareVisualReferences } = require('./visual-skill.cjs');
const { askJson, writeJson } = require('./qwen-provider.cjs');
const { stages, nextStage, cachedStage } = require('./stage-cache.cjs');

const creativeSchema = z.object({
  concept: z.string().trim().min(1).max(100), reason: z.string().trim().min(1).max(300),
  style: planSchema.shape.style,
  anchors: z.array(z.string().trim().min(1).max(120)).min(1).max(3),
  content: z.unknown(),
});

// Source SKU observations stay in recognition.json. Creative calls receive only the
// AI-authored business scope; the program does not choose or rewrite its traits.
function creativeRecognition(recognition) {
  const scope = recognition.businessScope;
  return {
    categories: recognition.categories,
    products: recognition.categories.map(category => ({ category, description: scope.categories.find(c => c.category === category).traits })),
    observations: [], uncertainties: ['示意设计，不证明真实材质、品质或功能，不要求复刻上传SKU'],
  };
}
function compileCreative(value, recognition, profile, { draft = false } = {}) {
  const parsed = creativeSchema.safeParse(value);
  if (!parsed.success) throw Error('整页创作内容不完整：' + parsed.error.issues.map(i => i.path.join('.')).join('、') + '。已保存响应，可从本阶段继续。');
  const creative = parsed.data;
  // This is optional display copy, never an input required for generation.
  // Keep an actual supplied summary, but do not fabricate one or block a plan
  // because the model omitted this nonessential field. Content is validated below.
  if (typeof value.revisionSummary === 'string' && value.revisionSummary.trim()) creative.revisionSummary = value.revisionSummary.trim().slice(0, 400);
  const brief = {
    version: 1, shop: { name: '商品装修参考', category: recognition.categories.join('、').slice(0, 100), observations: [], uncertainties: recognition.uncertainties },
    categories: recognition.categories, theme: creative.concept, style: creative.style, navigationStyle: 'auto', featuredCategory: null,
  };
  let skeleton;
  try {
    skeleton = usesNarrativePage(profile)
      ? compileNarrative(brief, creative.content, recognition, profile)
      : compileContent(brief, creative.content, recognition, { visualProfile: profile });
  } catch (error) {
    if (draft && profile.pageComposition === 'platform-slots-v1' && error.code === 'STOREFRONT_IMAGE_BUDGET' && error.reviewDraft) {
      const { content, ...reviewContext } = error.reviewDraft;
      return { creative: { ...creative, content }, reviewContext };
    }
    throw error;
  }
  return { creative: { ...creative, content: skeleton.content }, skeleton };
}

async function planJewelryCampaign(run, profile, save, { fetcher, reuse, setStage }) {
  const recognition = creativeRecognition(run.state.recognition);
  const businessScope = run.state.recognition.businessScope;
  const visual = await prepareVisualReferences(profile, { includePage: true });
  const context = {
    businessScope, evidence: evidenceFor(recognition, profile),
    visualReferences: visual.references, pageReferences: visual.pageReferences,
    attachmentRoles: '附图均为视觉案例，不是商品原图；摄影案例用于画面表现，整页案例用于浏览节奏。经营方向仅来自 businessScope。',
    assetBudget: 12, maxBatches: 2,
  };
  const parse = (value, base) => compileCreative(value, recognition, profile, { draft: base === 'content' });
  const validationFailures = new Map();
  const cachedCreative = base => cachedStage(run.folder, base, value => {
    try { return parse(value, base); }
    catch (error) {
      // Feed the actual failure into the existing user-requested continuation.
      // No extra call, automatic retry, or program-selected creative changes.
      if (profile.pageComposition === 'platform-slots-v1') validationFailures.set(base, { error: error.message });
      throw error;
    }
  });
  const call = async (base, input, review) => {
    const stage = nextStage(run.folder, base);
    run.state.planningRequestAttempts++; save(run.folder, run.state);
    // Only the campaign's nested creative responses opt out of provider JSON
    // mode. askJson still parses JSON and compileCreative validates the full plan.
    const request = validationFailures.has(base) ? { ...input, validationFeedback: validationFailures.get(base) } : input;
    const result = await askJson(run.folder, stage.name, campaignPrompt(profile, { review }), request, { images: visual.images, jsonMode: false, fetcher });
    return parse(result.value, base);
  };
  const saveCreative = result => {
    const { creative, skeleton } = result;
    run.state.contentPlan = creative.content;
    run.state.research = {
      concept: creative.concept, reason: creative.reason, style: creative.style, anchors: creative.anchors,
      selectedSources: [], sources: [], visualSkill: profile.visualSkill, visualReferences: visual.references, pageReferences: visual.pageReferences,
      basis: '实际读取所附整页、人物佩戴和静物案例，依据AI提炼的经营边界统一创作；本流程不执行网页检索。效果待用户生图验收。',
    };
    writeJson(run.folder, 'style-research.json', run.state.research);
    writeJson(run.folder, 'content-plan.json', creative.content);
    if (skeleton) writeJson(run.folder, 'structure-plan.json', skeleton.plan);
    save(run.folder, run.state);
  };
  setStage(run, 'planning-content', usesNarrativePage(profile) ? '正在组织章节与模块，设计整页图文' : '正在看案例，统一创作款式、整页与画面提示词', save);
  const draft = (reuse ? cachedCreative('content')?.value : null) || await call('content', context, false);
  writeJson(run.folder, 'creative-draft.json', draft.creative);
  saveCreative(draft);

  setStage(run, 'designing', usesNarrativePage(profile) ? '正在修订内容衔接、图文表达与视觉一致性' : usesCampaignIdentity(profile) ? '正在修订整页的一致性、视觉焦点与画面变化' : '正在进行一次整套修订：款式变化、人物佩戴与案例运用', save);
  const draftSignature = createHash('sha256').update(JSON.stringify({ creative: draft.creative, businessScope, profile })).digest('hex');
  const previous = reuse ? stages(run.folder, 'design')[0] : null;
  let reviewed = null;
  if (previous) {
    try {
      const input = JSON.parse(fs.readFileSync(path.join(run.folder, previous.name + '-input.json'), 'utf8'));
      if (input.draftSignature === draftSignature) reviewed = cachedCreative('design')?.value || null;
    } catch {}
  }
  reviewed ||= await call('design', {
    ...context, draftSignature, draft: draft.creative,
    ...(draft.reviewContext || {
      pageOrder: draft.skeleton.plan.modules.map(m => ({ type: m.type, purpose: m.purpose, assetIds: m.props.assetIds, ...(m.story ? { story: m.story } : {}), ...(m.narrative ? { narrative: m.narrative } : {}) })),
      currentSlots: draft.skeleton.tasks.map(t => ({ id: t.id, aspect: t.aspect, display: t.display, safeArea: t.safeArea, designIds: t.visualPlan.designIds })),
    }),
    reviewScope: '这些槽位描述初稿显示方式，不冻结创意。可以修正款式、图片数量、顺序与组件组合，返回完整终稿；仍遵守12张和两批预算。只评审计划和参考，不声称看过尚未生成的成图。',
  }, true);

  const { creative, skeleton } = reviewed;
  let plan = applyDesign(skeleton.plan, {
    artDirection: { concept: creative.concept, narrative: creative.content.narrative, anchors: creative.anchors },
    assets: skeleton.tasks.map(task => ({
      id: task.id, prompt: task.visualPlan.picture, camera: task.visualPlan.camera,
      treatment: task.visualPlan.treatment, visualReference: task.visualPlan.visualReference,
    })),
  }, { visualProfile: profile });
  if (usesCampaignIdentity(profile)) {
    // Carry the AI's existing hero reference and collection through to generation.
    // No extra model fields, inferred product features or newly generated master image.
    const taskDesigns = new Map(skeleton.tasks.map(task => [task.id, task.visualPlan.designIds]));
    plan = validatePlan({
      ...plan,
      campaign: { reference: usesNarrativePage(profile) ? creative.content.reference : creative.content.heroVisualPlan.visualReference, collection: creative.content.collection },
      assets: plan.assets.map(asset => ({ ...asset, designIds: taskDesigns.get(asset.id) })),
    }).plan;
  }
  // Publish the generation-ready plan only after the full reviewed result is valid.
  writeJson(run.folder, 'creative-final.json', creative);
  saveCreative(reviewed);
  run.state.reviewSummary = creative.revisionSummary;
  run.state.plan = plan;
  run.state.recommendation = { ...skeleton.recommendation, name: usesNarrativePage(profile) ? '章节叙事与视觉一致性驱动的整页创作' : '经营方向与视觉案例驱动的整页创作', sources: [] };
  save(run.folder, run.state);
}

module.exports = { planJewelryCampaign, compileCreative };

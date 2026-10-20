const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { z } = require('zod');
const { planSchema, validatePlan } = require('./plan.cjs');
const { compileContent, evidenceFor } = require('./content-plan.cjs');
const { applyDesign } = require('./model-contracts.cjs');
const { campaignPrompt, usesCampaignIdentity, campaignVisualSchema, campaignBackdropSchema } = require('./campaign-contract.cjs');
const { storefrontContentSchema } = require('./storefront-contract.cjs');
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

// A complete draft may need field corrections before it can be compiled. Keep
// that draft verbatim for the existing design pass; it is never executable.
// Empty/malformed responses still stop instead of fabricating missing content.
const reviewDraftSchema = creativeSchema.extend({
  concept: z.string().trim().min(1).max(1000),
  reason: z.string().trim().min(1).max(3000),
  content: z.object({
    narrative: z.string().trim().min(1),
    reason: z.string().trim().min(1),
    reference: z.object({ id: z.string().min(1) }).passthrough(),
    pageDesign: z.object({}).passthrough(),
    collection: z.array(z.object({ id: z.string().min(1), category: z.string().min(1), appearance: z.string().min(1) }).passthrough()).min(1).max(48),
    modules: z.array(z.object({ type: z.string().min(1), chapter: z.string().min(1), message: z.string().min(1) }).passthrough()
      .refine(m => m.type.startsWith('text.') ? typeof m.text === 'string' && m.text.trim().length > 0 : Array.isArray(m.visuals))).min(1).max(32),
  }).passthrough(),
});
function fieldIssue(issue, value) {
  const actual = issue.path.reduce((item, key) => item?.[key], value);
  let reason = issue.message;
  if (issue.code === 'too_big' || issue.code === 'too_small') {
    const limit = issue.code === 'too_big' ? `最多 ${issue.maximum}` : `至少 ${issue.minimum}`;
    reason = typeof actual === 'string' ? `${limit} 个字符，当前 ${actual.trim().length} 个`
      : Array.isArray(actual) ? `${limit} 项，当前 ${actual.length} 项` : `${limit}，当前 ${actual}`;
  } else if (actual === undefined) reason = '缺少此字段';
  else if (issue.code === 'invalid_value') reason = `只允许 ${issue.values.join(' / ')}，当前为 ${JSON.stringify(actual)}`;
  return { path: issue.path.join('.'), reason };
}

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
  const issues = parsed.success ? [] : [...parsed.error.issues];
  if (profile?.studio) {
    const content = storefrontContentSchema(campaignVisualSchema, campaignBackdropSchema, { studio: true }).safeParse(value?.content);
    if (!content.success) issues.push(...content.error.issues.map(issue => ({ ...issue, path: ['content', ...issue.path] })));
  }
  if (issues.length) {
    const schemaIssues = issues.map(issue => fieldIssue(issue, value));
    const error = Error('整页创作字段不符合要求：' + schemaIssues.slice(0, 4).map(i => `${i.path}（${i.reason}）`).join('；') + '。已保存响应，可从本阶段继续。');
    error.schemaIssues = schemaIssues;
    if (profile?.studio && reviewDraftSchema.safeParse(value).success) {
      error.creativeDraft = {
        creative: structuredClone(value),
        reviewContext: { requiredChanges: { schemaIssues,
          instruction: 'draft是完整但尚不可执行的原始初稿。逐项修正schemaIssues，保持有依据的内容与用户选择；同步检查真实组件图数、商品引用、图文容量、预算和事实边界，返回完整有效终稿。程序没有删字、替换图像形式或补造字段。',
        } },
      };
      if (draft) return error.creativeDraft;
    }
    throw error;
  }
  const creative = parsed.data;
  // This is optional display copy, never an input required for generation.
  // Keep an actual supplied summary, but do not fabricate one or block a plan
  // because the model omitted this nonessential field. Content is validated below.
  if (typeof value.revisionSummary === 'string' && value.revisionSummary.trim()) creative.revisionSummary = value.revisionSummary.trim().slice(0, 400);
  const brief = {
    version: 1, shop: { name: profile?.studio?.options.shopName || '店铺装修参考', category: recognition.categories.join('、').slice(0, 100), observations: [], uncertainties: recognition.uncertainties },
    categories: recognition.categories, theme: creative.concept, style: creative.style, navigationStyle: 'auto', featuredCategory: null,
  };
  let skeleton;
  try {
    skeleton = usesNarrativePage(profile)
      ? compileNarrative(brief, creative.content, recognition, profile)
      : compileContent(brief, creative.content, recognition, { visualProfile: profile });
  } catch (error) {
    if (profile.pageComposition === 'platform-slots-v1'
      && ['STOREFRONT_IMAGE_BUDGET', 'STOREFRONT_COPY_LAYOUT', 'STOREFRONT_PRODUCT_REFERENCES', 'STOREFRONT_STUDIO_REQUIREMENTS'].includes(error.code) && error.reviewDraft) {
      const { content, ...reviewContext } = error.reviewDraft;
      error.creativeDraft = { creative: { ...creative, content }, reviewContext };
      if (draft) return error.creativeDraft;
    }
    throw error;
  }
  return { creative: { ...creative, content: skeleton.content }, skeleton };
}

async function planCampaign(run, profile, save, { fetcher, reuse, setStage }) {
  const preserveProducts = !!profile.studio?.options.preserveProducts;
  const recognition = preserveProducts ? run.state.recognition : creativeRecognition(run.state.recognition);
  const businessScope = run.state.recognition.businessScope;
  const visual = await prepareVisualReferences(profile, { includePage: true });
  const productAttachments = preserveProducts ? await Promise.all(run.state.inputs.map(async (input,index)=>({
    imageIndex:index+1, attachment:visual.images.length+index+1, role:'原商品身份依据；保留商品，不继承拍摄背景',
    data:'data:image/jpeg;base64,'+(await require('sharp')(path.join(run.folder,input.file)).resize({width:1400,height:2400,fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toBuffer()).toString('base64'),
  }))) : [];
  const context = {
    businessScope, evidence: evidenceFor(recognition, profile),
    visualReferences: visual.references, pageReferences: visual.pageReferences,
    attachmentRoles: preserveProducts ? 'visualReferences和pageReferences仅用于设计表现；productAttachments是上传的原商品图片，商品身份以它们和对应evidence为准。' : '附图均为视觉案例，不是商品原图；摄影案例用于画面表现，整页案例用于浏览节奏。经营方向仅来自 businessScope。',
    productAttachments:productAttachments.map(({data,...metadata})=>metadata),
    ...(profile.studio ? { userRequirements:profile.studio } : {}),
    assetBudget: profile.studio?.maxAssets || 12, maxBatches: profile.studio?.maxBatches || 2,
    ...(profile.editorialReferences ? { editorialReferences: profile.editorialReferences } : {}),
  };
  const parse = (value, base) => compileCreative(value, recognition, profile, { draft: base === 'content' });
  const validationFailures = new Map();
  let incompleteRevision = null;
  const cachedCreative = base => cachedStage(run.folder, base, value => {
    try { return parse(value, base); }
    catch (error) {
      // Feed the actual failure into the existing user-requested continuation.
      // No extra call, automatic retry, or program-selected creative changes.
      if (profile.pageComposition === 'platform-slots-v1') validationFailures.set(base, { error: error.message, ...(error.schemaIssues ? { schemaIssues: error.schemaIssues } : {}) });
      // A user-requested continuation repairs the latest revision, not the older
      // content draft. Only reached for a matching draft signature below.
      if (base === 'design' && error.creativeDraft) incompleteRevision = error.creativeDraft;
      throw error;
    }
  });
  const call = async (base, input, review) => {
    const stage = nextStage(run.folder, base);
    run.state.planningRequestAttempts++; save(run.folder, run.state);
    // Only the campaign's nested creative responses opt out of provider JSON
    // mode. askJson still parses JSON and compileCreative validates the full plan.
    const request = validationFailures.has(base) ? { ...input, validationFeedback: validationFailures.get(base) } : input;
    const result = await askJson(run.folder, stage.name, campaignPrompt(profile, { review }), request, { images: [...visual.images,...productAttachments.map(i=>i.data)], jsonMode: false, ...(profile.studio ? { maxTokens:24000 } : {}), fetcher });
    return parse(result.value, base);
  };
  const saveCreative = result => {
    const { creative, skeleton } = result;
    run.state.contentPlan = creative.content;
    run.state.research = {
      concept: creative.concept, reason: creative.reason, style: creative.style, anchors: creative.anchors,
      selectedSources: [], sources: [], visualSkill: profile.visualSkill, visualReferences: visual.references, pageReferences: visual.pageReferences,
      basis: profile.editorialReferences ? '实际读取所附品类摄影案例，结合已核对官网的叙事记录，依据经营边界统一创作；整页附图以pageReferences为准，运行时不联网搜索，效果待用户生图验收。' : '实际读取所附整页、人物佩戴和静物案例，依据AI提炼的经营边界统一创作；本流程不执行网页检索。效果待用户生图验收。',
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
  const signatureForDraft = creative => createHash('sha256').update(JSON.stringify({ creative, businessScope, profile })).digest('hex');
  const draftSignature = signatureForDraft(draft.creative);
  const previous = reuse ? stages(run.folder, 'design')[0] : null;
  let reviewed = null;
  if (previous) {
    try {
      const input = JSON.parse(fs.readFileSync(path.join(run.folder, previous.name + '-input.json'), 'utf8'));
      // Deterministic reference normalization must not discard an already-saved
      // revision. Require both the original signature and the same parsed draft;
      // different content, scope or profile still invalidates this cache.
      const sameDraft = input.draftSignature === draftSignature
        || (input.draft && signatureForDraft(input.draft) === input.draftSignature
          && signatureForDraft(parse(input.draft, 'content').creative) === draftSignature);
      if (sameDraft) reviewed = cachedCreative('design')?.value || null;
    } catch {}
  }
  const reviewDraft = incompleteRevision || draft;
  reviewed ||= await call('design', {
    ...context, draftSignature, draft: reviewDraft.creative,
    ...(reviewDraft.reviewContext || {
      pageOrder: reviewDraft.skeleton.plan.modules.map(m => ({ type: m.type, purpose: m.purpose, assetIds: m.props.assetIds, ...(m.story ? { story: m.story } : {}), ...(m.narrative ? { narrative: m.narrative } : {}) })),
      currentSlots: reviewDraft.skeleton.tasks.map(t => ({ id: t.id, aspect: t.aspect, display: t.display, safeArea: t.safeArea, designIds: t.visualPlan.designIds })),
    }),
    reviewScope: profile.studio ? '依据本次已保存的模块、风格、保真要求修订完整页面；按requiredChanges修复问题。24张以内，最多6批，内容丰富但不重复，不声称看过生成结果。' : incompleteRevision
      ? 'draft是上次已保存但未通过交付检查的最新修订稿。按requiredChanges修正明确问题及关联构图，保留其他已完成内容；需要时可调整相关组件和文案，返回完整终稿。仍遵守12张和两批预算，不声称看过尚未生成的成图。'
      : '这些槽位描述初稿显示方式，不冻结创意。可以修正款式、图片数量、顺序与组件组合，返回完整终稿；仍遵守12张和两批预算。只评审计划和参考，不声称看过尚未生成的成图。',
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

module.exports = { planCampaign, planJewelryCampaign: planCampaign, compileCreative };

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { z } = require('zod');
const { planSchema, validatePlan } = require('./plan.cjs');
const { compileContent, evidenceFor } = require('./content-plan.cjs');
const { applyDesign } = require('./model-contracts.cjs');
const { campaignPrompt, usesCampaignIdentity, campaignVisualSchema, campaignBackdropSchema } = require('./campaign-contract.cjs');
const { storefrontContentSchema, normalizeStudioContent } = require('./storefront-contract.cjs');
const { usesNarrativePage } = require('./narrative-contract.cjs');
const { compileNarrative } = require('./narrative-plan.cjs');
const { prepareVisualReferences } = require('./visual-skill.cjs');
const { askJson, writeJson } = require('./qwen-provider.cjs');
const { stages, nextStage, cachedStage } = require('./stage-cache.cjs');
const { referenceRepairTargets, applyReferenceRepair, referenceRepairPrompt } = require('./studio-reference-repair.cjs');
const { layoutRepairContext, applyLayoutRepair, normalizeLayoutResponse, reviseLayoutAdditions,
  layoutBudgetOptions, applyLayoutBudgetChoice, layoutRepairPrompt, layoutRevisionPrompt, layoutBudgetPrompt } = require('./studio-layout-repair.cjs');

const creativeSchema = z.object({
  concept: z.string().trim().min(1).max(100), reason: z.string().trim().min(1).max(300),
  style: planSchema.shape.style,
  anchors: z.array(z.string().trim().min(1).max(120)).min(1).max(3),
  content: z.unknown(),
});

// An otherwise substantive draft may omit module copy or need field corrections.
// Keep that draft for the existing design pass; it is never executable.
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
      .refine(m => m.type.startsWith('text.') ? m.text === undefined || typeof m.text === 'string' : Array.isArray(m.visuals))).min(1).max(32),
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
  else if (issue.path.includes('evidenceIds')) reason = `当前为${JSON.stringify(actual)}；此字段只能引用输入evidence的product-*商品资料，不能填写视觉案例编号；款式放designIds，案例放visualReference.id`;
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
  if(profile?.studio?.version>=2 && value && typeof value==='object') value={...value,content:normalizeStudioContent(value.content,profile,evidenceFor(recognition,profile))};
  const parsed = creativeSchema.safeParse(value);
  const issues = parsed.success ? [] : [...parsed.error.issues];
  if (profile?.studio) {
    const content = storefrontContentSchema(campaignVisualSchema, campaignBackdropSchema, { studio: true, studioVersion:profile.studio.version, allowEmptyProductReferences:profile.studio.version>=2 }).safeParse(value?.content);
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
          instruction: 'draft已有整页结构但尚不可执行，可能缺少局部字段。逐项修正schemaIssues：文字模块必须由你填写实际text文案，不能把message的用途说明自动当成展示文案；缺少画面描述时提供必要构图信息，不为字数堆空话。保持有依据的内容与用户选择，同步检查真实组件图数、商品引用、图文容量、预算和事实边界，返回完整有效终稿。程序没有删字、替换图像形式或补造文案。',
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
      && ['STOREFRONT_IMAGE_BUDGET', 'STOREFRONT_COPY_LAYOUT', 'STOREFRONT_PRODUCT_REFERENCES', 'STOREFRONT_STUDIO_REQUIREMENTS', 'STOREFRONT_STRUCTURE'].includes(error.code) && error.reviewDraft) {
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
    const result = await askJson(run.folder, stage.name, campaignPrompt(profile, { review }), request, { images: [...visual.images,...productAttachments.map(i=>i.data)], jsonMode: false, ...(profile.studio ? { maxTokens:profile.studio.version>=2?40000:24000 } : {}), fetcher });
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
  const repairTargets = referenceRepairTargets(incompleteRevision, recognition, profile);
  if (!reviewed && repairTargets) {
    const base = 'reference-repair', repairSignature = signatureForDraft(incompleteRevision.creative);
    let repairFailure;
    const applyRepair = response => {
      try { return parse(applyReferenceRepair(incompleteRevision.creative, repairTargets, response), 'design'); }
      catch (error) { repairFailure = { error: error.message }; throw error; }
    };
    const priorRepair = stages(run.folder, base)[0];
    if (priorRepair) {
      try {
        const input = JSON.parse(fs.readFileSync(path.join(run.folder, priorRepair.name + '-input.json'), 'utf8'));
        if (input.repairSignature === repairSignature) reviewed = cachedStage(run.folder, base, applyRepair)?.value || null;
      } catch {}
    }
    if (!reviewed) {
      setStage(run, 'designing', `正在修复${repairTargets.length}张画面的商品选择与构图，保留已有整页`, save);
      const stage = nextStage(run.folder, base);
      run.state.planningRequestAttempts++; save(run.folder, run.state);
      const result = await askJson(run.folder, stage.name, referenceRepairPrompt, {
        repairSignature, concept: incompleteRevision.creative.concept, style: incompleteRevision.creative.style,
        businessScope, collection: incompleteRevision.creative.content.collection,
        evidence: evidenceFor(recognition, profile),
        productAttachments: productAttachments.map(({ data, ...item }, index) => ({ ...item, attachment: index + 1 })),
        visuals: repairTargets, ...(repairFailure ? { validationFeedback: repairFailure } : {}),
      }, { images: productAttachments.map(item => item.data), jsonMode: false,
        maxTokens: Math.min(24000, Math.max(3000, repairTargets.length * 1600)), fetcher });
      reviewed = applyRepair(result.value);
    }
  }
  const layoutRepair = !reviewed && layoutRepairContext(incompleteRevision, profile);
  if (layoutRepair) {
    const base = 'layout-repair';
    const repairSignature = createHash('sha256').update(JSON.stringify({
      version: layoutRepair.version, creativeSignature: signatureForDraft(incompleteRevision.creative),
    })).digest('hex');
    let repairFailure;
    const applyRepair = (response, currentAdditions, budgetOptions) => {
      let additions = response;
      try {
        if (budgetOptions?.length) additions = applyLayoutBudgetChoice(currentAdditions, budgetOptions, response);
        else if (currentAdditions) additions = reviseLayoutAdditions(currentAdditions, response);
        return parse(applyLayoutRepair(incompleteRevision.creative, layoutRepair, additions), 'design');
      }
      catch (error) {
        repairFailure = { error: error.message, ...(error.schemaIssues ? { schemaIssues: error.schemaIssues } : {}),
          ...(error.repairFeedback ? { ...error.repairFeedback } : {}),
          ...((Array.isArray(additions?.insertions) || currentAdditions) ? {
            previousInsertions: normalizeLayoutResponse({ insertions: additions?.insertions || currentAdditions }, layoutRepair).insertions,
          } : {}),
          ...(error.creativeDraft?.reviewContext?.requiredChanges ? { requiredChanges: error.creativeDraft.reviewContext.requiredChanges } : {}) };
        throw error;
      }
    };
    const priorRepair = stages(run.folder, base)[0];
    if (priorRepair) {
      try {
        const input = JSON.parse(fs.readFileSync(path.join(run.folder, priorRepair.name + '-input.json'), 'utf8'));
        const mergeFile = path.join(run.folder, priorRepair.name + '-merge.json');
        const merge = fs.existsSync(mergeFile) ? JSON.parse(fs.readFileSync(mergeFile, 'utf8')) : input;
        if (input.repairSignature === repairSignature && merge.repairSignature === repairSignature)
          reviewed = cachedStage(run.folder, base, value => applyRepair(value, merge.currentAdditions, merge.budgetOptions))?.value || null;
      } catch {}
    }
    if (!reviewed) {
      setStage(run, 'designing', `正在补充至少${layoutRepair.minimumAddedHeight}px的章节内容，保留已有页面`, save);
      const stage = nextStage(run.folder, base);
      run.state.planningRequestAttempts++; save(run.folder, run.state);
      const { componentOptions, existingModules, ...layout } = layoutRepair;
      const creative = incompleteRevision.creative, content = creative.content;
      const previousInsertions = repairFailure?.previousInsertions;
      const currentAdditions = previousInsertions?.length && previousInsertions.every(p =>
        Number.isInteger(p?.afterModuleIndex) && Array.isArray(p?.modules) && p.modules.length
        && p.modules.every(m => m && typeof m === 'object' && !Array.isArray(m))) ? previousInsertions : undefined;
      const validationFeedback = repairFailure && Object.fromEntries(Object.entries(repairFailure).filter(([key]) => key !== 'previousInsertions'));
      const budgetOptions = currentAdditions ? layoutBudgetOptions(layoutRepair, currentAdditions) : [];
      const input = {
        ...context, repairSignature, layout, componentOptions, existingModules,
        concept: creative.concept, style: creative.style, anchors: creative.anchors,
        narrative: content.narrative, reference: content.reference, pageDesign: content.pageDesign, collection: content.collection,
        ...(currentAdditions ? { currentAdditions } : {}),
        ...(budgetOptions.length ? { budgetOptions } : {}),
        ...(validationFeedback ? { validationFeedback } : {}),
      };
      // Save the complete merge context for exact replay, but send only the
      // content decision when dimensions and budgets already have valid choices.
      const budgetInput = budgetOptions.length ? {
        repairSignature, concept: creative.concept, narrative: content.narrative,
        existingChapters: existingModules.map(m => ({ chapter: m.chapter, message: m.message })),
        additions: currentAdditions.flatMap(p => p.modules.map(m => ({ chapter: m.chapter, message: m.message }))),
        options: budgetOptions,
      } : null;
      if (budgetInput) writeJson(run.folder, stage.name + '-merge.json', { repairSignature, currentAdditions, budgetOptions });
      const result = await askJson(run.folder, stage.name, budgetInput ? layoutBudgetPrompt : currentAdditions ? layoutRevisionPrompt : layoutRepairPrompt,
        budgetInput || input, { images: budgetInput ? [] : [...visual.images, ...productAttachments.map(i => i.data)], jsonMode: false,
          maxTokens: budgetInput ? 2000 : Math.min(24000, Math.max(6000, layoutRepair.remainingImages * 1800 + layoutRepair.remainingModules * 400)), fetcher });
      reviewed = applyRepair(result.value, currentAdditions, budgetOptions);
    }
  }
  reviewed ||= await call('design', {
    ...context, draftSignature, draft: reviewDraft.creative,
    ...(reviewDraft.reviewContext || {
      pageOrder: reviewDraft.skeleton.plan.modules.map(m => ({ type: m.type, purpose: m.purpose, assetIds: m.props.assetIds, ...(m.story ? { story: m.story } : {}), ...(m.narrative ? { narrative: m.narrative } : {}) })),
      currentSlots: reviewDraft.skeleton.tasks.map(t => ({ id: t.id, aspect: t.aspect, display: t.display, safeArea: t.safeArea, designIds: t.visualPlan.designIds })),
    }),
    reviewScope: profile.studio ? `${incompleteRevision ? 'draft是最新已保存的修订稿，已完成的导航、文案和引用修正应保留；当前仍未达标的项目以本次requiredChanges为准。' : ''}依据本次已保存的模块、风格、保真要求修订完整页面；按requiredChanges修复问题。若含layoutFeedback，必须在modules及visuals中实际补足缺少的纵向内容，不能只在revisionSummary声称已修好。${profile.studio.maxAssets}张以内，最多${profile.studio.maxBatches}批，内容丰富但不重复，不声称看过生成结果。` : incompleteRevision
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

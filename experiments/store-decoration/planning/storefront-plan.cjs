const { createHash } = require('crypto');
const { entries } = require('./catalog.cjs');
const { storefrontContentSchema, chapterSchema, normalizeStudioContent } = require('./storefront-contract.cjs');
const { campaignVisualSchema, campaignBackdropSchema } = require('./campaign-contract.cjs');
const { validatePlan, aspectRatios } = require('./plan.cjs');
const { contentBatches, evidenceFor } = require('./content-plan.cjs');
const { artworkGeometry, artworkBrief, artworkFitFeedback } = require('./slot-artwork.cjs');

function compileStorefront(brief, value, recognition, profile) {
  const studio=profile.studio, maxAssets=studio?.maxAssets || 12;
  const editorial=studio?.version>=2;
  value=normalizeStudioContent(value,profile,evidenceFor(recognition,profile));
  let parsed = storefrontContentSchema(campaignVisualSchema, campaignBackdropSchema,{studio:!!studio,studioVersion:studio?.version,allowEmptyProductReferences:editorial}).safeParse(value);
  if (!parsed.success) {
    // Explicit empty references can be reviewed without inventing products.
    // Missing/malformed fields still fail; empty arrays are reported below and
    // can never become an executable plan, including on the final-design path.
    const reviewable = storefrontContentSchema(campaignVisualSchema, campaignBackdropSchema, { allowEmptyProductReferences: true, studio:!!studio,studioVersion:studio?.version }).safeParse(value);
    if (!reviewable.success) throw Error('装修叙事方案不完整：' + parsed.error.issues.slice(0, 4).map(i => i.path.join('.')).join('、') + '。已保存响应，可从本阶段继续。');
    parsed = reviewable;
  }
  const content = parsed.data, evidence = new Map(evidenceFor(recognition, profile).map(item => [item.id, item]));
  if (editorial) {
    // Invalid slot counts cannot be compiled, but the substantive draft must
    // still reach the existing revision with all related delivery constraints.
    const structureIssues = [];
    content.modules.forEach((m, i) => {
      const entry = entries[m.type], count = m.visuals.length;
      if (count < entry.min || count > entry.max || m.type === 'showcase.three' && count % 3) structureIssues.push({
        path: `content.modules.${i}.visuals`, component: m.type, actualImages: count,
        minImages: entry.min, maxImages: entry.max,
        reason: `${m.type}需要${m.type === 'showcase.three' ? '3/6/9' : entry.min === entry.max ? entry.min : `${entry.min}至${entry.max}`}张独立图片，当前${count}张。每个visual对应一个独立槽位；不能把多个导航入口画在一张图里充当多张。由你拆分画面并分别填写商品选择、构图和名称，或改选符合内容的组件。`,
      });
      if (['showcase', 'navigation'].includes(entry.family)) m.visuals.forEach((v, j) => {
        if (!v.caption) structureIssues.push({ path: `content.modules.${i}.visuals.${j}.caption`, component: m.type, reason: '每个商品橱窗或导航入口须填写独立的原生名称caption。' });
      });
      m.visuals.forEach((v, j) => {
        if (!(v.copy.heading || v.copy.body)) return;
        const reason = entry.family === 'navigation' ? '圆形导航使用独立原生名称caption，图片copy不承载设计文案；请同步调整图文构图。'
          : entry.family === 'signboard' && v.copy.placement !== 'top' ? '招牌下方36%属于平台固定身份区；有设计文案时copy.placement必须为top，并同步调整picture的上部排字与留白。' : null;
        if (reason) structureIssues.push({ path: `content.modules.${i}.visuals.${j}.copy`, component: m.type, reason });
      });
    });
    if (structureIssues.length) {
      const measured = require('./studio-layout.cjs').measureStudioModules(content.modules);
      const actualImages = content.modules.reduce((sum, m) => sum + m.visuals.length, 0);
      const studioIssues = [];
      if (measured.height < studio.minPageHeight) studioIssues.push(`当前按原生组件计算高${Math.round(measured.height)}px，至少${studio.minPageHeight}px。增加有实际内容的纵向模块；横向多图不增加页面高度，不拉伸或堆空白。`);
      if (content.modules.length < studio.minModules) studioIssues.push(`当前${content.modules.length}个模块，需要${studio.minModules}至${studio.maxModules}个有实际内容的模块。`);
      for (const family of studio.options.modules) if (!content.modules.some(m => m.type.startsWith(family + '.'))) studioIssues.push(`缺少用户必含的${family}模块。`);
      if (actualImages > maxAssets) studioIssues.push(`当前${actualImages}张图片，最多${maxAssets}张。`);
      const error = Error('整页结构尚未完成：' + [...structureIssues.map(i => `${i.path}：${i.reason}`), ...studioIssues].join('；') + ' 已保存方案，可从未完成步骤继续。');
      error.code = 'STOREFRONT_STRUCTURE';
      error.reviewDraft = { content, requiredChanges: { code: error.code, structureIssues, studioIssues,
        actualImages, maxImages: maxAssets, measuredHeight: measured.height, minPageHeight: studio.minPageHeight,
        moduleCounts: measured.modules,
        instruction: '逐项修正真实槽位图数和名称，同时满足纵向长度、模块和图片预算，返回完整终稿。保留有依据的款式、文案和视觉设计；程序没有拆图、代选组件或填造内容。',
      } };
      throw error;
    }
  }
  const designs = new Map(), categories = new Set(), assets = [], modules = [], tasks = [], decisions = [], copyIssues = [], referenceIssues = [], studioIssues=[];
  let layoutFeedback;
  const focalModule=studio ? content.modules.find(m=>m.type.startsWith('carousel.') && (!editorial || m.type!=='carousel.small')) || content.modules.find(m=>m.type.startsWith('poster.')) || content.modules.find(m=>m.type.startsWith('showcase.')) || (editorial && content.modules.find(m=>m.type==='carousel.small')) : null;
  for (const item of content.collection) {
    if (designs.has(item.id)) throw Error('款式编号重复：' + item.id + '，已保留方案。');
    if (!recognition.categories.includes(item.category)) {
      // Mixed Chinese/Latin category labels sometimes gain typography spaces
      // (T恤 -> T 恤). Canonicalize only a unique whitespace-only match; do not
      // infer synonyms, split a category, or change any appearance/visual copy.
      const compact = item.category.replace(/\s+/gu, '');
      const matches = recognition.categories.filter(category => category.replace(/\s+/gu, '') === compact);
      if (matches.length !== 1) throw Error('款式 ' + item.id + ' 引用的品类“' + item.category + '”无法唯一对应已确认品类，已保留方案，未猜测类别。');
      item.category = matches[0];
    }
    designs.set(item.id, item);
    if(studio?.options.preserveProducts){
      const source=evidence.get(item.sourceEvidenceId);
      if(!source || source.category!==item.category || !source.imageIndex)studioIssues.push(`${item.id}必须准确引用同品类的一件原商品sourceEvidenceId，不能创作新款或猜测原图。`);
    }
  }
  const checkReference = ref => {
    if (!require('./visual-skill.cjs').generationReferenceIds(profile).includes(ref.id)) throw Error('方案引用了本任务之外的视觉案例，未自行替换。');
  };
  checkReference(content.reference);
  content.modules.forEach((item, index) => {
    const entry = entries[item.type], moduleId = `chapter-${index + 1}`, count = item.visuals.length;
    if(studio && entry.family==='navigation'){
      if(new Set(item.visuals.map(v=>v.caption)).size!==count)studioIssues.push(`第${index+1}模块导航名称重复，请用有依据的不同入口。`);
      if(!editorial&&new Set(item.visuals.map(v=>v.imageForm)).size!==1)studioIssues.push(`第${index+1}模块导航应使用同一图像形式。`);
    }
    if (count < entry.min || count > entry.max || (item.type === 'showcase.three' && count % 3)) throw Error(`第${index + 1}模块的图片数不符合 ${item.type} 真实规格，已保留方案。`);
    if (['showcase', 'navigation'].includes(entry.family) && item.visuals.some(v => !v.caption)) throw Error('橱窗或导航缺少原生名称，已保留方案。');
    const ids = item.visuals.map((visual, slotIndex) => {
      checkReference(visual.visualPlan.visualReference);
      // Resolve only explicit collection references for this image. Never swap
      // ID prefixes or infer a category from the subject/picture text.
      const evidenceIdForDesign = id => {
        const design = designs.get(id);
        if (!design || !visual.visualPlan.designIds.includes(id)) throw Error('品类资料引用中的款式 ' + id + ' 未定义或不属于本图，已保留方案。');
        if (editorial && studio.options.preserveProducts) {
          const source = evidence.get(design.sourceEvidenceId);
          if (!source || source.category !== design.category || !source.imageIndex) throw Error('款式 ' + id + ' 未明确绑定有效原商品，未猜测商品身份。');
          return source.id;
        }
        const matches = [...evidence.values()].filter(e => e.category === design.category);
        if (matches.length !== 1) throw Error('款式 ' + id + ' 无法唯一对应经营资料，未猜测或替换品类。');
        return matches[0].id;
      };
      // A signboard may omit redundant category IDs while explicitly selecting
      // known designs. Follow that exact design -> category -> evidence relation;
      // an empty design list still means no selected product and is never guessed.
      if (entry.family === 'signboard' && !visual.evidenceIds.length && visual.visualPlan.designIds.length) {
        visual.evidenceIds = [...new Set(visual.visualPlan.designIds.map(evidenceIdForDesign))];
      }
      if (visual.evidenceIds.some(id => id.startsWith('design-'))) {
        visual.evidenceIds = [...new Set(visual.evidenceIds.map(id => {
          if (!id.startsWith('design-')) return id;
          return evidenceIdForDesign(id);
        }))];
      }
      const mismatchedSignboard = entry.family === 'signboard' && !!visual.evidenceIds.length !== !!visual.visualPlan.designIds.length;
      const graphicBanner=editorial && item.type==='carousel.small' && ['graphic','texture'].includes(visual.visualPlan.treatment) && !visual.evidenceIds.length && !visual.visualPlan.designIds.length;
      const emptyProductReferences = entry.family !== 'signboard' && !graphicBanner && (!visual.evidenceIds.length || !visual.visualPlan.designIds.length);
      if (mismatchedSignboard || emptyProductReferences) referenceIssues.push({
        path: `content.modules.${index}.visuals.${slotIndex}`, component: item.type,
        evidenceIds: [...visual.evidenceIds], designIds: [...visual.visualPlan.designIds],
        reason: mismatchedSignboard
          ? '招牌两组商品引用不一致。由你依据画面修正：展示商品时两组均须对应实际商品；无商品背景时两组均为空。不猜填编号。'
          : `此${item.type}画面尚未明确入画商品。必须从collection选择实际出现的designIds，并引用对应经营资料evidenceIds；多商品群像也不能留空。同时调整subject/picture以对应所选商品的外观、数量和位置，不只补编号。${entry.family === 'navigation' ? '若是无依据的导航，由你重组模块，不添加虚构品类。' : ''}`,
      });
      for (const id of visual.evidenceIds) {
        if (!evidence.has(id)) throw Error('方案引用未知经营资料 ' + id + '，已保留响应。');
        categories.add(evidence.get(id).category);
      }
      for (const id of visual.visualPlan.designIds) if (!designs.has(id)) throw Error('画面引用未定义款式 ' + id + '，已保留方案。');
      if(studio?.options.preserveProducts){
        const chosen=[...new Set(visual.visualPlan.designIds.map(id=>designs.get(id).sourceEvidenceId))];
        if(chosen.some(id=>!visual.evidenceIds.includes(id))||visual.evidenceIds.some(id=>!chosen.includes(id)))studioIssues.push(`第${index+1}模块第${slotIndex+1}图的evidenceIds必须与designIds所选原商品一致，不能引用别的商品凑数。`);
      }
      const slot = entry.slots[slotIndex];
      // Choose the existing generation ratio nearest to the actual slot, never a new layout.
      const aspect = Object.keys(aspectRatios).reduce((best, ratio) => Math.abs(Math.log(aspectRatios[ratio] / slot.aspect)) < Math.abs(Math.log(aspectRatios[best] / slot.aspect)) ? ratio : best);
      const signboard = entry.family === 'signboard';
      const id = signboard ? 'identity-bg' : studio ? item===focalModule && slotIndex===0 ? 'overview' : `story-${assets.length+1}` : assets.some(a => a.id === 'overview') ? `story-${assets.length + 1}` : 'overview';
      const role = signboard || graphicBanner ? 'atmosphere' : entry.family === 'navigation' ? 'category' : entry.family === 'showcase' ? 'product' : id === 'overview' ? 'hero' : visual.visualPlan.camera === 'macro' ? 'detail' : 'scene';
      const hasCopy = !!(visual.copy.heading || visual.copy.body);
      const missingCopyPlacement = hasCopy && visual.copy.placement === 'none';
      let copyNeedsReview = missingCopyPlacement;
      if (entry.family === 'navigation' && hasCopy) throw Error('圆形导航图不能承载设计文案，请使用原生导航名称。已保留方案。');
      if (signboard && hasCopy && !missingCopyPlacement && visual.copy.placement !== 'top') throw Error('招牌下部是固定店铺信息区，设计文案需放在顶部，已保留方案。');
      if (missingCopyPlacement) copyIssues.push({
        path: `content.modules.${index}.visuals.${slotIndex}.copy.placement`, id, component: item.type,
        allowedPlacements: signboard ? ['top'] : ['left', 'right', 'top', 'bottom'],
        reason: '已有标题或正文，但placement为none。由画面设计选择排字位置，并同步修改picture留白。',
      });
      const alternate = visual.copy.tone === 'alternate', theme = content.pageDesign;
      const artwork = hasCopy ? { ...visual.copy, width: slot.width, height: slot.height,
        background: alternate ? theme.alternateBackground : theme.background,
        foreground: alternate ? theme.alternateForeground : theme.foreground, typography: theme.typography,
        ...(studio ? {version:editorial?3:2,surface:visual.copy.surface || (editorial?'none':'gradient')} : {}) } : null;
      if(studio && !editorial && hasCopy && slot.width<200 && (visual.copy.body || Array.from(visual.copy.heading).length>6))studioIssues.push(`第${index+1}模块第${slotIndex+1}小图只可用6字以内短标题、不能有正文。`);
      if (artwork && !missingCopyPlacement && !editorial) {
        try { artworkGeometry(artwork); }
        catch (error) {
          if (error.code !== 'ARTWORK_TEXT_OVERFLOW') throw error;
          copyNeedsReview = true;
          copyIssues.push({ path: `content.modules.${index}.visuals.${slotIndex}.copy`, id, component: item.type,
            allowedPlacements: signboard ? ['top'] : ['left', 'right', 'top', 'bottom'], reason: error.message });
        }
      }
      const copyBrief = copyNeedsReview ? '本图文案排版尚未满足交付条件，具体原因见copyIssues；须经画面设计修订，不能生图。'
        : artwork ? artworkBrief(artwork) : '本图无设计文字，按内容构图。';
      const layoutBrief = `章节：${item.chapter}。本模块讲清：${item.message}。衔接：${item.transition || '开场'}。真实组件${item.type}第${slotIndex + 1}槽，显示${slot.width}×${slot.height}。模块外固定白色，不依赖全页染色。${copyBrief}${signboard ? '本图是招牌背景，下方36%保留平静空间给平台头像、店名和数据；重要主体放上部，不绘制这些原生控件。' : ''}${role === 'category' ? '主体置于中央65%，适应圆形裁剪。' : ''}`;
      assets.push({ id, aspect, subject: visual.subject, composition: visual.visualPlan.picture.slice(0, 300),
        ...(studio ? {imageForm:visual.imageForm} : {}),
        ...(studio?.options.preserveProducts ? {productReferences:[...new Set(visual.visualPlan.designIds.map(id=>designs.get(id).sourceEvidenceId))].filter(id=>evidence.has(id)&&evidence.get(id).imageIndex).map(id=>({evidenceId:id,imageIndex:evidence.get(id).imageIndex,description:evidence.get(id).description}))} : {}),
        visualReference: visual.visualPlan.visualReference, layoutBrief, ...(artwork ? { artwork } : {}),
        direction: { role, camera: visual.visualPlan.camera, treatment: visual.visualPlan.treatment, background: brief.style.background.slice(0, 180), accents: brief.style.palette.join('、') } });
      tasks.push({ id, aspect, role, subject: visual.subject, intent: { purpose: item.message, reason: item.transition },
        display: { component: item.type, width: slot.width, height: slot.height }, safeArea: layoutBrief,
        visualPlan: visual.visualPlan, evidence: visual.evidenceIds.map(id => evidence.get(id)) });
      return id;
    });
    const narrative = chapterSchema.parse({ chapter: item.chapter, message: item.message, transition: item.transition });
    modules.push({ id: moduleId, type: item.type, purpose: item.message, narrative,
      props: { assetIds: ids, text: studio && entry.family==='text' ? item.text : '', labels: entry.family === 'navigation' ? item.visuals.map(v => v.caption) : [], titles: entry.family === 'showcase' ? item.visuals.map(v => v.caption) : [] } });
    decisions.push({ moduleId, why: item.transition || item.message, remove: '模型按叙事决定模块，程序不自动合并或改选组件。' });
  });
  if (!assets.length) throw Error('整页须有1至12张素材，尚未生图。');
  const missing = recognition.categories.filter(category => !categories.has(category));
  if (missing.length) throw Error('整页叙事尚未覆盖经营品类：' + missing.join('、') + '。已保存响应。');
  if(studio){
    if(!editorial && studio.style.id!=='auto' && brief.style.palette.filter(c=>studio.style.colors.some(p=>p.toLowerCase()===c.toLowerCase())).length<2)studioIssues.push('整店色板需至少采用所选预设的两个主色，避免忽略用户风格；仅用于背景、排字和图形，不改变商品本色。');
    if(studio.options.preserveProducts && new Set(content.collection.map(d=>d.sourceEvidenceId)).size!==content.collection.length)studioIssues.push('保真模式同一原商品只定义一个design编号，跨图复用它，不拆成多个新款。');
    const actual=new Set(modules.map(m=>m.type.split('.')[0]));
    for(const family of studio.options.modules)if(!actual.has(family))studioIssues.push(`缺少用户已勾选的${family}模块，不得省略。`);
    if(!editorial)for(const family of actual)if(!studio.options.modules.includes(family))studioIssues.push(`用户未勾选${family}，请在已选类型内组织内容。`);
    if(modules.length<studio.minModules)studioIssues.push(`当前只有${modules.length}个模块，需要${studio.minModules}至${studio.maxModules}个有不同内容的模块。`);
    if(new Set(modules.filter(m=>!m.type.startsWith('signboard.')).map(m=>m.narrative.chapter)).size<3)studioIssues.push('至少组织三个不同内容章节，不用重复标题和空白段延长。');
    if(!editorial&&new Set(assets.map(a=>a.imageForm)).size<2)studioIssues.push('至少使用两种适合任务的图像形式，区分导航、banner和商品浏览。');
    if(editorial){
      const measured=require('./studio-layout.cjs').measureStudioModules(modules);
      if(measured.height<studio.minPageHeight){
        layoutFeedback={width:measured.width,currentHeight:measured.height,minHeight:studio.minPageHeight,
          missingHeight:Math.ceil(studio.minPageHeight-measured.height),remainingModules:studio.maxModules-modules.length,
          remainingImages:maxAssets-assets.length,modules:measured.modules,
          instruction:'整页仍不够长。必须实际增加或重组有内容的纵向模块及对应画面，并返回完整方案；只修改标题、说明、横向图数或revisionSummary不能补足高度。沿用已有主题与款式，不靠空白、拉伸或重复凑长。'};
        studioIssues.push(`按原生组件计算整页高${Math.round(measured.height)}px，少于${studio.minPageHeight}px，还差${layoutFeedback.missingHeight}px。请增加有实际内容的纵向模块；剩余预算${layoutFeedback.remainingModules}个模块、${layoutFeedback.remainingImages}张图片，不靠横向图数、空白或拉伸凑长。`);
      }
    }
    for(let i=1;i<modules.length;i++)if(modules[i].type.startsWith('text.')&&modules[i-1].type.startsWith('text.'))studioIssues.push('不要连续添加原生文字模块凑长度。');
  }
  if (assets.length > maxAssets || copyIssues.length || referenceIssues.length || studioIssues.length) {
    const overBudget = assets.length > maxAssets;
    const error = Error(overBudget
      ? `整页实际安排${assets.length}张素材，须为1至${maxAssets}张（各模块：${content.modules.map(m => `${m.type}=${m.visuals.length}`).join('、')}）。请调整组件或图数，保留招牌与品类覆盖；尚未生图。`
      : referenceIssues.length ? `画面商品引用尚未完成：${referenceIssues.map(issue => `${issue.path}：${issue.reason}`).join('；')}`
      : studioIssues.length ? studioIssues.join('；') : `图片文案排版尚未完成：${copyIssues.map(issue => `${issue.path}：${issue.reason}`).join('；')}`);
    // This is review input only, never a generation-ready plan. A complete
    // draft with these design issues can reach the existing review; the final stays strict.
    error.code = overBudget ? 'STOREFRONT_IMAGE_BUDGET' : referenceIssues.length ? 'STOREFRONT_PRODUCT_REFERENCES' : studioIssues.length ? 'STOREFRONT_STUDIO_REQUIREMENTS' : 'STOREFRONT_COPY_LAYOUT';
    error.reviewDraft = {
      content,
      pageOrder: modules.map(m => ({ type: m.type, purpose: m.purpose, assetIds: m.props.assetIds, narrative: m.narrative })),
      currentSlots: tasks.map(t => ({ id: t.id, aspect: t.aspect, display: t.display, safeArea: t.safeArea, designIds: t.visualPlan.designIds })),
      requiredChanges: {
        code: error.code, actualImages: assets.length, maxImages: maxAssets, reduceByAtLeast: Math.max(0, assets.length - maxAssets),
        ...(studioIssues.length ? {studioIssues} : {}),
        ...(layoutFeedback ? {layoutFeedback} : {}),
        moduleCounts: modules.map(m => ({ type: m.type, chapter: m.narrative.chapter, images: m.props.assetIds.length })),
        ...(referenceIssues.length ? { referenceIssues } : {}),
        ...(copyIssues.length ? { copyIssues: copyIssues.map(issue => ({
          ...issue, fit: artworkFitFeedback(assets.find(asset => asset.id === issue.id).artwork, issue.allowedPlacements),
        })) } : {}),
        instruction: [
          ...studioIssues,
          referenceIssues.length ? '按referenceIssues修正商品引用与关联画面。无商品导航不能靠填假编号通过；由你修改相关画面或重组组件。显示商品时两组引用须对应；不含商品的招牌背景'+(editorial?'、纯图形或抽象纹理短banner':'')+'可两组为空。程序没有更改原引用或代选模块。' : '',
          overBudget ? `先调整模块组合与各模块图数，使实际图片总数不超过${maxAssets}，再返回完整终稿。保留用户已选模块、品类覆盖、核心叙事和视觉亮点。` : '',
          copyIssues.length ? '按reason与fit逐项修订copyIssues。fit.currentCopyFitsAt是当前全文能放下的位置；若为空，换位置也不能解决，必须由你精简文案或改选更大组件。fit.headingOnlyFitsAt只说明保留原标题、不带正文时可用的位置，供设计取舍，不是程序已删正文。小图可保留短标题，将有必要的说明融入本章大图文案；不要原样复制放不下的正文。同步修改picture，排字与留白必须同侧，主体在另一侧。返回完整终稿，不能仅写修订说明。' : '',
        ].filter(Boolean).join('\n'),
      },
    };
    throw error;
  }
  const plan = { version: 1, delivery: 'platform-slots-v1', ...(studio ? {studio} : {}), shop: brief.shop, style: brief.style,
    pageDesign: content.pageDesign, summary: content.narrative.slice(0, 300),
    artDirection: { concept: brief.theme, narrative: content.narrative, anchors: ['共同摄影基准、图片内统一图文语言与白色平台背景'], focalAssetId: 'overview' },
    modules, assets, batches: studio ? require('./studio-batches.cjs').studioBatches(assets,aspectRatios,studio.maxBatches) : contentBatches(assets) };
  const validated = validatePlan(plan);
  return { ...validated, tasks, content, signature: createHash('sha256').update(JSON.stringify({ plan: validated.plan, content })).digest('hex'),
    recommendation: { version: 4, method: 'ai-narrative-platform-slots', name: '可上传的章节叙事装修', reason: content.reason,
      lengthReason: `${validated.plan.modules.length}个原生模块（含必备招牌），${assets.length}张独立成品图片。`, tradeoff: '招牌必备且首位，模型选择非全屏招牌样式和正文叙事；程序按真实槽位合字、裁剪和组装。', decisions, brief } };
}
module.exports = { compileStorefront };

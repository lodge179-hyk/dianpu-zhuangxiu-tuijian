const { z } = require('zod');
const { entries } = require('./catalog.cjs');
const { referenceSchema } = require('./page-direction.cjs');
const { pageDesignSchema } = require('./narrative-contract.cjs');
const { copySchema } = require('./slot-artwork.cjs');
const { usesDigitalCampaign } = require('./digital-campaign.cjs');
const { usesCategoryCampaign } = require('./category-campaign.cjs');

// Native captions/navigation remain platform fields; editorial text belongs to images.
// All native signboards except fullscreen are available to the designer.
const storefrontTypes = Object.keys(entries).filter(type => /^(poster|carousel|showcase|navigation)\./.test(type) || (type.startsWith('signboard.') && type !== 'signboard.fullscreen'));
const chapterSchema = z.object({
  chapter: z.string().trim().min(1).max(40),
  message: z.string().trim().min(1).max(120),
  transition: z.string().trim().max(180).default(''),
}).strict();
// tone selects an existing palette, not a writing mood. The original prompt
// omitted its enum, so saved responses contain "dramatic", "poetic" or "".
// Use the declared base palette for an unspecified selection; do not infer colors
// from mood words. Keep the persisted artwork schema strict.
const modelCopySchema = z.preprocess(value => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.tone !== 'string') return value;
  const tone = value.tone.trim();
  return { ...value, tone: ['base', 'alternate'].includes(tone) ? tone : 'base' };
}, copySchema);
function storefrontContentSchema(visualSchema, backdropSchema, { allowEmptyProductReferences = false } = {}) {
  const moduleSchema = (types, schema, minimumReferences) => chapterSchema.extend({
    type: z.enum(types),
    visuals: z.array(z.object({
      // Model responses sometimes put a collection ID here. The compiler resolves
      // it through the declared category; persisted evidence remains product-*.
      evidenceIds: z.array(z.string().regex(/^(product|design)-[1-9]\d*$/)).min(minimumReferences).max(6),
      subject: z.string().trim().min(1).max(180), caption: z.string().trim().max(32).default(''),
      copy: modelCopySchema.default({ heading: '', body: '', placement: 'none', tone: 'base' }),
      visualPlan: schema,
    })).max(9),
  });
  return z.object({
    narrative: z.string().trim().min(1).max(400), reason: z.string().trim().min(1).max(300),
    reference: referenceSchema, pageDesign: pageDesignSchema,
    collection: z.array(z.object({ id: z.string().regex(/^design-[1-9]\d*$/), category: z.string().trim().min(1).max(20), appearance: z.string().trim().min(1).max(240) })).min(1).max(12),
    modules: z.array(z.discriminatedUnion('type', [
      moduleSchema(storefrontTypes.filter(type => type.startsWith('signboard.')), backdropSchema, 0),
      moduleSchema(storefrontTypes.filter(type => !type.startsWith('signboard.')), allowEmptyProductReferences ? backdropSchema : visualSchema, allowEmptyProductReferences ? 0 : 1),
    ])).min(3).max(10),
  });
}
function storefrontPrompt(profile, { review = false } = {}) {
  const digital = usesDigitalCampaign(profile);
  const category = usesCategoryCampaign(profile);
  const components = storefrontTypes.map(type => {
    const e = entries[type];
    const description = e.family === 'signboard' ? '必备店铺身份，三种招牌中选一种，唯一且首位；默认/经典可设计背景，极简使用平台底色。' : e.description;
    return `${type}：${description} 图片数${e.min}..${e.max}${type === 'showcase.three' ? '（只能3/6/9）' : ''}；槽位按上传顺序=${e.slots.map(s => `${s.index}:${s.width}×${s.height}`).join('，') || '无'}。`;
  }).join('\n');
  return [
    review ? '依据真实案例、经营资料和draft完成一次完整修订，返回终稿。可以重组章节、模块、款式和图文，但必须使用下列真实装修组件。只审稿，不声称看过尚未生成的图片。若输入有requiredChanges，方案尚未满足交付条件：按instruction逐项修订。reduceByAtLeast>0时，按moduleCounts调整实际结构，至少减少对应张数，使总图数不超过maxImages。若有copyIssues，先看每项fit：currentCopyFitsAt为空说明当前全文在所有允许位置都放不下，必须精简文案或换更大组件，不能只把none改成right；headingOnlyFitsAt提供原标题不带正文时的可用位置，由你决定文字取舍和章节承接。同步修改picture留白。保留核心叙事、店铺招牌与品类覆盖，返回完整终稿；不能只写修订说明或保留已指出的冲突。' : '你是店铺的编辑设计师与艺术指导。先决定用户应理解什么，再用真实装修组件组织有叙事、有亮点、视觉一致的店铺。',
    ...profile.rules,
    '【交付边界】最终交付是能上传到微购原组件的独立PNG，不是自由排版的网页截图。店铺底色、模块之间及原生控件周围始终是白色；不能要求整页染色、自定义模块高度、左右图文区域或额外HTML标题。设计标题和短文由程序合入每个图片槽位PNG，生成预览与下载使用同一张图片。商品名称/导航标签用平台原生字段；除此之外不依赖图外文字。',
    `【叙事分工】围绕一个主张组织章节，chapter相同表示同一章。message回答本模块讲清什么，transition说明为何接在前面。${category ? profile.narrativeExample : digital ? '例如海报提出便携或桌面使用的主题，操作场景解释产品与人的关系，紧接橱窗给出相关选择；可参考editorialReferences中的叙事观察，不照搬案例的功能宣称。' : '例如主题海报提出佩戴关系，紧接橱窗给出相关但不同的款式；组合海报可解释整体与细节。'}由你决定模块数量、类型、顺序、主次与图数，不按图片数由程序自动选模块，也不把所有模块当成平铺照片。3至10模块、1至12张图、最多两批；不凑满预算。`,
    '【支持的真实组件】\n' + components,
    '按内容选择正文组件：carousel的小/中/大图是3:1、4:3、3:4；poster组合提供平台原生主次结构；showcase保留真实商品标题与购物按钮。招牌必须是modules第一项且全页只有一个，由你根据整店设计从signboard.default（默认，背景483×258）、signboard.classic（经典，背景483×224）、signboard.minimal（极简，无背景图）选择；不是只用极简，也不是三种同时出现。禁止signboard.fullscreen全屏轮播招牌。默认/经典的背景图计入12张与两批总预算，极简不占生图预算。招牌建立店铺身份，正文仍有自己的主视觉，后续叙事顺序由你决定。导航仅在确有4或5个不同入口时使用，不能凑分类。原生文字模块不承载设计标题，章节引导可用带字横幅；无需每章都有文字过渡。',
    '【招牌背景设计】默认/经典各返回1个visual，按真实槽位比例独立构图，延续全套摄影基准、光色与材质，不复用正文照片。头像、店名和平台数据由原生控件显示，不在背景中再画一份。下方约36%是原生信息区，保持平静，商品与人物重点放在上部；如需简短设计文案，copy.placement只用top，否则文案为空并填none，不与下方控件重叠。极简的visuals=[]。',
    '招牌背景如仅为光影、色彩或材质而没有商品，evidenceIds与visualPlan.designIds都明确返回[]，不要为了填编号加入商品。若招牌展示商品，两组引用都必须填写实际品类和款式。此例外只适用于招牌背景，其他商品画面的两组引用仍各至少1项。无商品背景仍须完整填写picture、difference、机位、表现方式和视觉参考。',
    '导航图也须展示有依据的商品款式，两组引用均不得为空。只有3个入口时不要为凑navigation.four添加NEW、推荐或抽象占位图；可不使用导航，或由你重组适合内容的组件，程序不会自动添加品类、猜填编号或删除模块。',
    review ? '若requiredChanges含referenceIssues，逐项修正空引用或招牌两组引用不一致的问题：画面展示商品时填写其已定义款式及对应经营资料；无商品招牌两组均为空。正文与导航不能用空引用绕过商品要求，不得仅填编号却保留不对应的画面。由你同步调整picture、subject、引用及相关模块，返回完整终稿。' : '',
    '【单张成品设计】每个visual可带copy={heading,body,placement,tone}，heading最多24字、body最多80字；均可为空。tone仅允许base或alternate，表示图片内排字使用pageDesign的基础或备用配色，不是文案语气；无文字时也填base，不填空字符串或dramatic/poetic等情绪词。placement为none/left/right/top/bottom：left/right在槽位内约44%区域排字，top/bottom在图片内不超过48%高度排字，其余保留摄影主体。有字必须选位置，没字选none。宽幅、窄槽与小图应精简：3:1横幅优先短标题、不放长段落；宽度不足200的槽位最多短标题，不放正文；导航图无设计文字，以免被圆形裁剪。不要每格都贴字，主张放在海报上，橱窗安静承接。',
    `picture必须同步设计排字留白：${category ? profile.subjectFocus : digital ? '产品关键轮廓、操作部件与手部接触位置' : '人体/饰品核心'}在排字区域之外，仍有大胆尺度、姿态与光色反差。模型不画字，程序准确合字；程序不会把放不下的字移到图外。pageDesign仅控制图片内统一的文字与底色气质，不控制白色店铺背景。利用白色间隙组织呼吸，不把每个图片都变为素白底。`,
    '输出前逐张检查copy：placement=none时heading与body必须同时为""；只要保留任何标题或正文，就必须选left/right/top/bottom并同步picture留白。placement表示文字位置，不是商品位置：right对应右侧留白、商品在左侧，left相反；top/bottom同理。组合海报每个槽位也遵守此规则，不用none表示“文字稍后再排”。',
    '输出前汇总所有modules[].visuals.length，总和必须为1至12；招牌背景、导航每一格、橱窗每一格及组合海报每一格都各计1张，不按模块数计预算。超过12张时由你调整组件与叙事安排，保留必备招牌、品类覆盖和重点表达，程序不会自动删图。若输入带validationFeedback，依据具体错误修正并返回完整方案，不重复上次无效结构。',
    `【丰富且一致】${category ? profile.usageDirection : digital ? '按产品实际形态安排使用关系画面，可用原创成年人物操作、手部或产品与空间的关系，不要求全部佩戴，不把其他数码改成手机或耳机。' : '至少一张原创成年人物参与佩戴。'}先创作经营特征内的不同款式，再按主题安排；必要同款对照遵守collection，不靠反复拍同款凑图。全套共用content.reference和style；明暗、景别、人物与静物有变化，保持同一拍摄企划。未知材料、工艺、价格、功效、销量、品牌和服务不可编造为事实。`,
    review ? '逐模块检查：海报主张与后续橱窗是否有关联，款式是否重复填长度，人物与细节是否提供新信息；是否仍依赖图外文字/全页底色/自由尺寸才成立。检查各槽位的文案长度和留白位置，直接修改picture与copy使其一致。保留上一版有表现力的主题与光影，不用回到全素来换取可落地。' : '',
    '【实际JSON】顶层={concept,reason,style,anchors,content,revisionSummary?}。concept为1至100字；reason为1至300字；style={palette,background,lighting,photography}，palette为2至4个#RRGGBB，其他各1至200字；anchors为1至3条具体跨图联系。只返回填完的JSON，不返回Schema或Markdown。',
    `content={narrative,reason,reference,pageDesign,collection,modules}。narrative为1至400字阅读路径，reason为1至300字。reference={id,borrow,avoid}，id从${JSON.stringify(profile.visualSkill.referenceIds)}选一张全套摄影基准，borrow/avoid各1至120字；所附整页案例用于章节关系，摄影案例用于画面。`,
    'pageDesign={version:1,background,foreground,alternateBackground,alternateForeground,accent,typography}，颜色均为#RRGGBB；base和alternate为同一套图片内设计的两对底色/字色，typography=sans或editorial，全页共用。collection为1至12项{id,category,appearance}，id用唯一design-1等，category用经营资料原分类名，appearance用1至240字写清示意外观。',
    'modules每项={type,chapter,message,transition,visuals}：type必须逐字使用上述组件名，不返回layout/format或自定义尺寸；chapter为1至40字，message为1至120字，transition为0至180字。visuals按组件图片上传顺序列出，数量遵守组件；signboard.minimal的visuals=[]。',
    `每个visual={evidenceIds,subject,caption,copy,visualPlan}，evidenceIds引用本图品类product-*资料；subject为1至180字；caption是平台原生商品标题或导航标签（商品橱窗/导航必填，其他可空）。copy用前述结构。visualPlan={picture,difference,designIds,camera,treatment,visualReference}，picture为20至600字最终完整摄影描述，difference为1至160字新增信息与视觉联系；designIds引用collection；camera为wide/eye-level/top-down/macro；treatment为environment/human-use/still-life/texture/graphic；visualReference={id,borrow,avoid}，id从${JSON.stringify(profile.visualSkill.referenceIds)}选，borrow/avoid各1至120字。局部参考补构图，不改变全套风格。`,
    '编号分工：evidenceIds只填输入evidence中的product-*；visualPlan.designIds只填你在collection定义的design-*。两者数字不要求相同，按collection.category对应经营品类，不能把design-*直接复制到evidenceIds。',
    'collection.category是关联经营资料的字段，直接复制对应evidence.category原文，不改名、不拆分类、不为中英文排版额外插入空格。面向用户的自然名称可写在caption里。',
    '实际图片覆盖所有已确认品类，完整返回全部模块。程序只落实固定尺寸、编号与图片排字，不替你改写主题、编造款式或自动合并模块。',
  ].filter(Boolean).join('\n\n');
}
module.exports = { storefrontTypes, chapterSchema, storefrontContentSchema, storefrontPrompt };

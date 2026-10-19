const { z } = require('zod');
const { entries } = require('./catalog.cjs');
const { referenceSchema } = require('./page-direction.cjs');
const { pageDesignSchema } = require('./narrative-contract.cjs');
const { copySchema } = require('./slot-artwork.cjs');

// Native captions/navigation remain platform fields; editorial text belongs to images.
// Standalone text and decorated signboards are not needed for the image deliverable.
const storefrontTypes = Object.keys(entries).filter(type => /^(poster|carousel|showcase|navigation)\./.test(type) || type === 'signboard.minimal');
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
function storefrontContentSchema(visualSchema) {
  return z.object({
    narrative: z.string().trim().min(1).max(400), reason: z.string().trim().min(1).max(300),
    reference: referenceSchema, pageDesign: pageDesignSchema,
    collection: z.array(z.object({ id: z.string().regex(/^design-[1-9]\d*$/), category: z.string().trim().min(1).max(20), appearance: z.string().trim().min(1).max(240) })).min(1).max(12),
    modules: z.array(chapterSchema.extend({
      type: z.enum(storefrontTypes),
      visuals: z.array(z.object({
        evidenceIds: z.array(z.string().regex(/^product-[1-9]\d*$/)).min(1).max(6),
        subject: z.string().trim().min(1).max(180), caption: z.string().trim().max(32).default(''),
        copy: modelCopySchema.default({ heading: '', body: '', placement: 'none', tone: 'base' }),
        visualPlan: visualSchema,
      })).max(9),
    })).min(3).max(10),
  });
}
function storefrontPrompt(profile, { review = false } = {}) {
  const components = storefrontTypes.map(type => {
    const e = entries[type];
    return `${type}：${e.description} 图片数${e.min}..${e.max}${type === 'showcase.three' ? '（只能3/6/9）' : ''}；槽位按上传顺序=${e.slots.map(s => `${s.index}:${s.width}×${s.height}`).join('，') || '无'}。`;
  }).join('\n');
  return [
    review ? '依据真实案例、经营资料和draft完成一次完整修订，返回终稿。可以重组章节、模块、款式和图文，但必须使用下列真实装修组件。只审稿，不声称看过尚未生成的图片。' : '你是店铺的编辑设计师与艺术指导。先决定用户应理解什么，再用真实装修组件组织有叙事、有亮点、视觉一致的店铺。',
    ...profile.rules,
    '【交付边界】最终交付是能上传到微购原组件的独立PNG，不是自由排版的网页截图。店铺底色、模块之间及原生控件周围始终是白色；不能要求整页染色、自定义模块高度、左右图文区域或额外HTML标题。设计标题和短文由程序合入每个图片槽位PNG，生成预览与下载使用同一张图片。商品名称/导航标签用平台原生字段；除此之外不依赖图外文字。',
    '【叙事分工】围绕一个主张组织章节，chapter相同表示同一章。message回答本模块讲清什么，transition说明为何接在前面。例如主题海报提出佩戴关系，紧接橱窗给出相关但不同的款式；组合海报可解释整体与细节。由你决定模块数量、类型、顺序、主次与图数，不按图片数由程序自动选模块，也不把所有模块当成平铺照片。3至10模块、1至12张图、最多两批；不凑满预算。',
    '【支持的真实组件】\n' + components,
    '按内容选择组件：carousel的小/中/大图是3:1、4:3、3:4；poster组合提供平台原生主次结构；showcase保留真实商品标题与购物按钮。signboard.minimal可选，仅可出现在开头且只有一个。导航仅在确有4或5个不同入口时使用，不能凑分类。原生文字模块不承载设计标题，章节引导可用带字横幅；无需每章都有文字过渡。',
    '【单张成品设计】每个visual可带copy={heading,body,placement,tone}，heading最多24字、body最多80字；均可为空。tone仅允许base或alternate，表示图片内排字使用pageDesign的基础或备用配色，不是文案语气；无文字时也填base，不填空字符串或dramatic/poetic等情绪词。placement为none/left/right/top/bottom：left/right在槽位内约44%区域排字，top/bottom在图片内不超过48%高度排字，其余保留摄影主体。有字必须选位置，没字选none。宽幅、窄槽与小图应精简：3:1横幅优先短标题、不放长段落；宽度不足200的槽位最多短标题，不放正文；导航图无设计文字，以免被圆形裁剪。不要每格都贴字，主张放在海报上，橱窗安静承接。',
    'picture必须同步设计排字留白：人体/饰品核心在排字区域之外，仍有大胆尺度、姿态与光色反差。模型不画字，程序准确合字；程序不会把放不下的字移到图外。pageDesign仅控制图片内统一的文字与底色气质，不控制白色店铺背景。利用白色间隙组织呼吸，不把每个图片都变为素白底。',
    '【丰富且一致】至少一张原创成年人物参与佩戴。先创作经营特征内的不同款式，再按主题安排；必要同款对照遵守collection，不靠反复拍同款凑图。全套共用content.reference和style；明暗、景别、人物与静物有变化，保持同一拍摄企划。未知材料、工艺、价格、功效、销量、品牌和服务不可编造为事实。',
    review ? '逐模块检查：海报主张与后续橱窗是否有关联，款式是否重复填长度，人物与细节是否提供新信息；是否仍依赖图外文字/全页底色/自由尺寸才成立。检查各槽位的文案长度和留白位置，直接修改picture与copy使其一致。保留上一版有表现力的主题与光影，不用回到全素来换取可落地。' : '',
    '【实际JSON】顶层={concept,reason,style,anchors,content,revisionSummary?}。concept为1至100字；reason为1至300字；style={palette,background,lighting,photography}，palette为2至4个#RRGGBB，其他各1至200字；anchors为1至3条具体跨图联系。只返回填完的JSON，不返回Schema或Markdown。',
    `content={narrative,reason,reference,pageDesign,collection,modules}。narrative为1至400字阅读路径，reason为1至300字。reference={id,borrow,avoid}，id从${JSON.stringify(profile.visualSkill.referenceIds)}选一张全套摄影基准，borrow/avoid各1至120字；所附整页案例用于章节关系，摄影案例用于画面。`,
    'pageDesign={version:1,background,foreground,alternateBackground,alternateForeground,accent,typography}，颜色均为#RRGGBB；base和alternate为同一套图片内设计的两对底色/字色，typography=sans或editorial，全页共用。collection为1至12项{id,category,appearance}，id用唯一design-1等，category用经营资料原分类名，appearance用1至240字写清示意外观。',
    'modules每项={type,chapter,message,transition,visuals}：type必须逐字使用上述组件名，不返回layout/format或自定义尺寸；chapter为1至40字，message为1至120字，transition为0至180字。visuals按组件图片上传顺序列出，数量遵守组件；signboard.minimal的visuals=[]。',
    `每个visual={evidenceIds,subject,caption,copy,visualPlan}，evidenceIds引用本图品类product-*资料；subject为1至180字；caption是平台原生商品标题或导航标签（商品橱窗/导航必填，其他可空）。copy用前述结构。visualPlan={picture,difference,designIds,camera,treatment,visualReference}，picture为20至600字最终完整摄影描述，difference为1至160字新增信息与视觉联系；designIds引用collection；camera为wide/eye-level/top-down/macro；treatment为environment/human-use/still-life/texture/graphic；visualReference={id,borrow,avoid}，id从${JSON.stringify(profile.visualSkill.referenceIds)}选，borrow/avoid各1至120字。局部参考补构图，不改变全套风格。`,
    '实际图片覆盖所有已确认品类，完整返回全部模块。程序只落实固定尺寸、编号与图片排字，不替你改写主题、编造款式或自动合并模块。',
  ].filter(Boolean).join('\n\n');
}
module.exports = { storefrontTypes, chapterSchema, storefrontContentSchema, storefrontPrompt };

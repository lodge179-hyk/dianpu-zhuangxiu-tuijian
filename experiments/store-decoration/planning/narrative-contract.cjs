const { z } = require('zod');
const { referenceSchema } = require('./page-direction.cjs');
const { usesDigitalCampaign } = require('./digital-campaign.cjs');
const { usesCategoryCampaign } = require('./category-campaign.cjs');

function usesNarrativePage(profile) {
  return (profile?.id === 'jewelry' && profile.version >= 20 && ['narrative-v1', 'platform-slots-v1'].includes(profile.pageComposition)) || usesDigitalCampaign(profile) || usesCategoryCampaign(profile);
}
const hex = z.string().regex(/^#[\da-fA-F]{6}$/);
const pageDesignSchema = z.object({
  version: z.literal(1),
  background: hex, foreground: hex, alternateBackground: hex, alternateForeground: hex, accent: hex,
  typography: z.enum(['sans', 'editorial']),
}).strict();
const storySchema = z.object({
  layout: z.enum(['poster', 'editorial', 'pair', 'collection', 'statement']),
  chapter: z.string().trim().min(1).max(40),
  message: z.string().trim().min(1).max(120),
  transition: z.string().trim().max(180).default(''),
  heading: z.string().trim().max(24).default(''),
  body: z.string().trim().max(100).default(''),
  tone: z.enum(['base', 'alternate']),
  textPlacement: z.enum(['above', 'below', 'on-image-left', 'on-image-right']),
}).strict();

function narrativeContentSchema(visualSchema) {
  return z.object({
    narrative: z.string().trim().min(1).max(400),
    reason: z.string().trim().min(1).max(300),
    reference: referenceSchema,
    pageDesign: pageDesignSchema,
    collection: z.array(z.object({
      id: z.string().regex(/^design-[1-9]\d*$/), category: z.string().trim().min(1).max(20), appearance: z.string().trim().min(1).max(240),
    })).min(1).max(12),
    modules: z.array(storySchema.extend({
      format: z.enum(['wide', 'landscape', 'square', 'portrait']),
      visuals: z.array(z.object({
        evidenceIds: z.array(z.string().regex(/^product-[1-9]\d*$/)).min(1).max(6),
        subject: z.string().trim().min(1).max(180),
        caption: z.string().trim().max(32).default(''),
        visualPlan: visualSchema,
      })).max(3),
    })).min(3).max(10),
  });
}

function narrativePrompt(profile, { review = false } = {}) {
  if (profile.pageComposition === 'platform-slots-v1') return require('./storefront-contract.cjs').storefrontPrompt(profile, { review });
  return [
    review
      ? '你是整页叙事与艺术指导，依据所附真实案例、经营资料和 draft，完成一次完整修订。先读实际浏览顺序，再检查画面。可以增删、移动或重组模块，返回完整终稿，不请求下一轮。'
      : '你是店铺的编辑设计师与艺术指导。先决定读者应理解什么、顺序是什么，再选模块和创作图像。交付有叙事的完整店铺，不是把不同商品照片填满格子。',
    ...profile.rules,
    '【模块的编辑分工】先确定一个经营范围内的主题主张，再展开有意义的章节。每章回答一个具体问题，例如怎样佩戴、什么造型关系吸引人、有哪些不同款式可选；不要只写“高级感/奢华感/展现细节”。海报可以提出观点，随后的图文或橱窗用实际可见内容展开同一观点，共享 chapter。不是每张都要新主题；也不是每章都重复同一商品。浏览到下一段应获得新信息，transition 写明为什么接在前面。',
    '借鉴品牌官网“主题提出→画面解释→相关选择”的内容组织方法，不复制固定顺序或小米文案。章节数量、模块类型、顺序、图数和比例全部由你按内容决定，没有固定首图加方图清单。控制在3至10个模块、合计最多12张图和两批内；通常5至8个有明确作用的模块足够，不凑数。开场可以是一张有主张的海报，也可先用一句简洁的文字引入。',
    '【可用表达工具】poster：1图的完整广告海报，可选宽幅/横幅/正方/竖幅；editorial：1图配短标题及解释，图文共同讲清一个具体特点；pair：2张方图共同回答同一个问题，可为佩戴与静物/整体与局部；collection：1至3张方图，给同章相关且不同的款式选择，每张配具体外观名称；statement：0图的短句过渡，仅有明确承上启下用途才使用。模块类型不是必填清单，不要求每种都出现。poster 与 collection 可以同属一章，不能让每个模块各说各话。',
    '人物佩戴、可见造型细节、新款选择按叙事需要安排；至少一张原创成年人物参与佩戴，不能始终用无人静物。不同款式只受经营类型和代表性特点限制，同款对照沿用 collection 的外观。不能把3款商品反复拍摄当作丰富选品，也不为凑数增加无信息的图片。未知材料、真实工艺、价格、功效、品牌、销量和服务承诺不得写为事实；可写可见轮廓、色彩、比例、佩戴搭配及原创主题文案。',
    '【图文是一张设计】标题是用户最终看到的内容，不是内部“方案思路”。heading 用短而具体的主题句；body 可用一句解释连接产品与观点，避免空泛广告套话。poster 可以用有张力的大字，字的位置、商品占比和留白同时设计；文字由排版程序准确绘制，picture 内不要请求模型画字。短文案是可选表达工具，不给每张图片都贴标题。collection 的 caption 描述款式差异，不以品类名称加“示意”作为每件的重复标题。',
    '【一致性】content.reference 是全套共享的摄影基准，每批均会附原像素。style 确定光质、白平衡、材质关系和调色；pageDesign 确定整页统一的背景、文字、强调色和字体气质。允许章节用同一色彩体系的明暗面形成高潮与停顿，不将一致性写成全页同暗底、同台面、同景别。全页至少有醒目的主张与支撑画面，配套橱窗安静且清楚。相邻模块的背景、图文和内容应连续。',
    review ? '【本轮审稿】仅评审计划与案例，不声称看过成图。按 modules 顺序检查：每章是否有可理解的主张和解释，海报后面的橱窗是否确实延续该章；是否只是写了 narrative 但画面仍各自拍；是否重复同款/同观点填长度；图文是否互补；是否又退回全暗、全素或一串等大方图。直接重组有问题的模块并同步修正 picture、款式、参考和文字。保持共享视觉基准，不用放弃一致性换取丰富。' : '',
    '【返回实际JSON】只输出填完的对象，不返回Schema或Markdown。顶层：concept（1至100字）、reason（1至300字）、style、anchors（1至3条具体跨图联系）、content；revisionSummary 可选。style={palette,background,lighting,photography}，palette为2至4个#RRGGBB色，其余各1至200字，分别写色彩/环境关系、光质/白平衡、统一摄影质感。',
    `content={narrative,reason,reference,pageDesign,collection,modules}。reference={id,borrow,avoid}，id从${JSON.stringify(profile.visualSkill.referenceIds)}选一张作为全套基准，borrow/avoid各1至120字。narrative（1至400字）按真实章节写阅读路径，reason（1至300字）写选择理由。所附pageReferences用于观察章节关系，单图参考用于摄影；不能混用。`,
    'pageDesign={version:1,background,foreground,alternateBackground,alternateForeground,accent,typography}，五种颜色均为#RRGGBB，base与alternate分别是一对可读背景/文字色；从全套style发展，accent少量强调。typography选sans（现代清楚）或editorial（有衬线的编辑感）；全页共用，不给每章另换字体。',
    'collection为1至12项{id,category,appearance}，id用唯一design-1等，category使用经营资料原分类名，appearance用1至240字明确外观。这里只是示意款式，不证明真实材质或属性。',
    'modules按实际顺序返回，每项={layout,chapter,message,transition,heading,body,tone,textPlacement,format,visuals}。layout用上述五种名称；chapter同章同名（1至40字）；message是读者本段应理解的一件事（1至120字），transition写与上段关系（0至180字）；heading为0至24字、body为0至100字。tone选base/alternate。textPlacement选above/below，poster还可选on-image-left/on-image-right；覆盖在图片上时仅heading+短body，不遮挡主体。format选wide=3:1、landscape=4:3、square=1:1、portrait=3:4，仅poster/editorial使用；其余填square。statement的visuals=[]且至少heading/body一项非空。不要把首图另写成heroVisualPlan或sections。',
    `每个visual={evidenceIds,subject,caption,visualPlan}：evidenceIds引用本图实际品类的product-*资料编号，subject为1至180字主体，caption为0至32字短名称（collection每张必填）。visualPlan={picture,difference,designIds,camera,treatment,visualReference}，picture为20至600字的最终完整生图描述，通常100至180字即可，直接描述商品外观、内容作用、人物/空间/构图、光色，不反复抄全局style；difference为1至160字的新增信息与视觉联系；designIds引用collection；camera选wide/eye-level/top-down/macro；treatment选environment/human-use/still-life/texture/graphic；visualReference={id,borrow,avoid}，id从${JSON.stringify(profile.visualSkill.referenceIds)}选，borrow/avoid各1至120字，局部参考只补姿态/机位/构图，不替换全套摄影语言。`,
    'poster图文覆盖时，在picture中明确对应左/右约42%的平静可读区域，商品与人物主要信息放在另一侧，文字由程序后加；其他照片按实际比例独立构图，不把图片画成页面或文字海报。全页图像实际覆盖所有已确认品类。只返回完整结果，不省略后面的模块和visualPlan。',
  ].filter(Boolean).join('\n\n');
}
module.exports = { usesNarrativePage, pageDesignSchema, storySchema, narrativeContentSchema, narrativePrompt };

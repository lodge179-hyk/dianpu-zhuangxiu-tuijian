const { z } = require('zod');

// A saved studio snapshot is the contract for this task, including on resume.
const families = [
  { id: 'signboard', name: '店铺招牌', description: '店名与身份，固定置顶', required: true },
  { id: 'navigation', name: '分类导航', description: '让顾客快速找到感兴趣的内容' },
  { id: 'carousel', name: '轮播与横幅', description: '主视觉 banner、系列主题与章节引导' },
  { id: 'poster', name: '主题海报', description: '搭配、使用场景和细节，多图有主次' },
  { id: 'showcase', name: '商品橱窗', description: '清楚浏览商品，方便后续绑定在售款' },
  { id: 'text', name: '文字说明', description: '简短章节标题和有依据的介绍' },
];
const preset = (id, name, colors, description, direction) => ({ id, name, colors, description, direction });
const styles = {
  general: [
    preset('clean', '清爽品牌', ['#F5F4EF','#263E38','#BDCBBA'], '浅底、清晰轮廓、自然色彩', '大面积浅底；主体本色优先，导航用干净商品或简化图形，banner以尺度和留白建立焦点。'),
    preset('editorial', '杂志叙事', ['#EEE9E1','#242321','#A35C43'], '人物与静物交替，温暖而克制', '编辑式构图，生活场景与安静浏览交替，短标题与照片共同构图。'),
    preset('playful', '轻快色彩', ['#FFF7E9','#FF7359','#4C59AF'], '明亮色块、图形与商品拼贴', '清晰几何色块，商品主体拼贴，少量手绘点缀；导航简化成同一图形家族。'),
  ],
  jewelry: [
    preset('luxury', '高端奢华', ['#181B1C','#D4B77C','#F5EFE5'], '深浅交替，定向高光与精致细节', '深色只用于重点banner；暖白浏览区、细致高光、原创人物佩戴，避免全页黑底或夸大商品价值。'),
    preset('soft-gold', '淡雅黑金', ['#F6F2E9','#292B2B','#B99C60'], '米白为主，黑色文字与浅金点缀', '米白负空间、细线图形、克制浅金点缀；导航清晰轻盈，不用厚重黑色圆底；商品本色不随配色改变。'),
    preset('gallery', '现代艺廊', ['#E8ECE9','#394B48','#BA7659'], '雕塑式构图、柔和色面、艺术感', '用轮廓、非对称尺度和雕塑式空间表达珠宝，辅助图清楚展示真实可见结构。'),
  ],
  digital: [
    preset('precision', '极简科技', ['#F1F3F5','#1D2935','#557EA7'], '冷白空间、准确结构、少量蓝色', '产品结构清晰，浅底轮廓导航，主视觉用空间与反射建立焦点，不添加虚构功能或参数。'),
    preset('worklife', '温暖桌面', ['#EFE8DD','#5C5345','#9DAF98'], '自然光、生活使用关系、柔和材质', '自然桌面与真实使用关系，细节和干净商品图交替，避免每张重复桌面。'),
    preset('dynamic', '先锋动感', ['#22262D','#D7EA8A','#F3F4ED'], '动势构图、醒目点色、明暗对比', '重点banner可大胆透视和对角构图，产品浏览转为浅底；不把动感包装成性能证明。'),
  ],
  apparel: [
    preset('urban', '都市杂志', ['#EEECE6','#303A3B','#8D9A84'], '穿搭叙事、建筑线条、自然留白', '原创模特穿搭、完整衣服轮廓、可见衣料细节交替；导航展开衣服，不以折叠堆放遮住版型。'),
    preset('natural', '自然松弛', ['#F5F0E6','#83775E','#ABB59D'], '柔和日光、轻盈布景、低饱和', '柔软日光和舒展姿态，浅底商品图配少量生活场景，不虚构面料成分。'),
    preset('street', '街头色彩', ['#F2EBDD','#262B3B','#E7744A'], '活力穿搭、平面拼贴、大胆色块', '穿搭和商品拼贴共享配色；导航用简化图形或展开单品，避免给每格堆城市背景。'),
  ],
  footwear: [
    preset('daily', '城市轻行', ['#F1F0EA','#334748','#AEBA9C'], '清楚鞋型、自然步态、轻盈空间', '侧面鞋型作为导航，场景展示自然上脚与尺度，banner用动势而非大段性能文案。'),
    preset('sport', '运动能量', ['#EDF0E9','#202A30','#D2EB70'], '对角构图、明快点色、运动气息', '产品确实适合时表现运动关系；不把皮鞋变成跑鞋，不虚构缓震透气参数。'),
    preset('classic', '经典质感', ['#F3EBDF','#4A352B','#A98464'], '暖色光影、完整轮廓、细节层次', '温暖克制的轮廓摄影，鞋面细节与上脚图形成变化，不把所有商品都改成皮质。'),
  ],
  fragrance: [
    preset('botanical', '植物诗意', ['#F2F1E7','#4E6250','#C7D2B2'], '柔和绿意、瓶身光影、安静留白', '植物只作视觉氛围，不代表成分或香调；瓶身保持清楚，导航独立主体，banner适度用阴影。'),
    preset('salon', '法式沙龙', ['#EDE3D5','#543C35','#B39170'], '温暖室内、玻璃反射、细腻叙事', '玻璃与温暖空间的关系，产品组合和安静近景交替，避免臆造品牌故事与配方。'),
    preset('pure', '纯净留白', ['#F6F5F0','#677779','#BFCED0'], '通透浅底、柔光、极简排字', '用通透亮面、轻阴影与瓶身本色营造视觉，不用大片不透明文字板切开照片。'),
  ],
  bags: [
    preset('commute', '都市通勤', ['#F0EDE7','#353D42','#A59682'], '携带关系、结构轮廓、简洁空间', '自然携带、完整包型、连接细节分工；导航用独立商品轮廓，不以人物遮住包体。'),
    preset('vacation', '轻旅假日', ['#F6ECDD','#6F8C8C','#CEA373'], '明亮日光、舒展场景、柔和色彩', '明亮轻快场景与浅底单品交替，使用情境基于实际包型，不编造容量与功能。'),
    preset('atelier', '质感工坊', ['#ECE4D8','#4A3E38','#A48262'], '温暖近景、细节与安静陈列', '可见纹理、提手连接与整体轮廓，细节只表示观察，不虚构手工工艺、皮革材质或产地。'),
  ],
};
const modeNames = { general:'通用', jewelry:'珠宝', digital:'数码', apparel:'服装', footwear:'鞋履', fragrance:'香氛', bags:'箱包' };
const optionsSchema = z.object({
  modules: z.array(z.enum(families.map(f=>f.id))).min(2).max(6),
  styleId: z.string().max(30).default('auto'),
  preserveProducts: z.boolean().default(false),
  shopName: z.string().trim().max(30).default(''),
}).strict();
const studioSchema = z.object({ version:z.literal(1), mode:z.enum(Object.keys(modeNames)), options:optionsSchema,
  minModules:z.number().int().min(6).max(12), maxModules:z.literal(16), maxAssets:z.literal(24), maxBatches:z.literal(6),
  style: z.object({ id:z.string(),name:z.string(),colors:z.array(z.string()),description:z.string(),direction:z.string() }).strict(),
}).strict();
function createStudio(mode, input = {}) {
  if (!styles[mode]) throw Error('请选择有效的店铺品类。');
  const parsed=optionsSchema.safeParse({ modules:families.map(f=>f.id), ...input });
  if (!parsed.success) throw Error('创作选项无效，请检查模块、风格和商品保真设置。');
  const options=parsed.data;
  if (new Set(options.modules).size!==options.modules.length || !options.modules.includes('signboard')) throw Error('店铺招牌必备，模块不能重复。');
  if (!options.modules.some(m=>['carousel','poster','showcase'].includes(m))) throw Error('请至少选择轮播与横幅、主题海报或商品橱窗中的一项。');
  const style=options.styleId==='auto' ? preset('auto','AI 推荐',[], '根据商品选择合适的方向', '依据商品本色与实际经营内容选择设计方向，保留浅底浏览区、明确banner和轻盈导航。') : styles[mode].find(s=>s.id===options.styleId);
  if (!style) throw Error('此风格不属于当前品类，请重新选择。');
  return studioSchema.parse({version:1,mode,options,style,minModules:8,maxModules:16,maxAssets:24,maxBatches:6});
}
function publicStudio() { return {version:1,families,modes:Object.entries(modeNames).map(([id,name])=>({id,name,styles:styles[id]})),defaults:{modules:families.map(f=>f.id),styleId:'auto',preserveProducts:false,shopName:''},maxAssets:24,maxBatches:6}; }
module.exports={ families,styles,optionsSchema,studioSchema,createStudio,publicStudio };

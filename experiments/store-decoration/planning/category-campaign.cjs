// Category policy and references only. All four modes use the existing campaign
// recognition, revision, native-slot, image generation and export implementation.
const definitions = {
  apparel: {
    version: 1, label: '服装',
    traits: '廓形、长短与松量、领口袖型、可见织纹、垂坠或挺括、色彩搭配与穿着情境',
    narrativeExample: '用整体穿搭提出主题，以生活场景解释穿着关系，再用廓形或衣料局部补充信息，相关单品橱窗承接选择；不是连续重复同一模特全身照。',
    usageDirection: '安排与经营服装相符的穿着或搭配画面，人物动作应让衣服的轮廓和层次更清楚。童装等不适合成人穿着的商品可用挂拍、平铺或空间陈列，不强塞成人模特；人物不是经营商品。',
    subjectFocus: '服装领口、袖口、下摆、搭配层次及人物自然关节',
    physical: '衣领、袖口、纽扣、接缝与下摆连续，衣服顺着人体或承托产生自然褶皱；面料保留织纹和厚薄层次，不变成塑料或液体。人物不遮住要解释的版型；同款跨图的领型、长度、图案和结构一致。',
    bounds: '不能从外观推断纤维成分、保暖、防水、抗菌、尺码适配或生产工艺；可以描述可见轮廓、层次与搭配意境。不要把商务装统一改成休闲装，或把轻薄款统一升级成厚重外套。',
    references: ['apparel-urban-v1', 'apparel-studio-v1', 'apparel-silhouette-v1', 'apparel-drape-v1', 'apparel-collection-v1'],
    editorialReferences: [
      { source: 'https://www.uniqlo.com/us/en/special-feature/lifewear-magazine/26fw/the-city-classics', observed: '按城市和生活情境组织章节，人物穿搭与相关单品信息交替。', apply: '学习同一主题下的场景、景别与穿搭变化，不复制人物、城市、品牌、季节或功能宣称。' },
      { source: 'https://www.uniqlo.com/us/en/special-feature/lifewear-magazine/26fw/unique-clothing', observed: '先整体穿着，再以不同服装轮廓及局部结构展开。', apply: '借整体到局部的解释顺序；不能继承羽绒成分、实验数据、认证或生产过程。' },
    ],
  },
  footwear: {
    version: 6, label: '鞋履',
    traits: '鞋头与鞋口轮廓、鞋帮高低、鞋底厚薄、系带或闭合方式、可见表面与穿着场合',
    narrativeExample: '用一张有姿态或色彩张力的主视觉提出主题，上脚关系交代穿着尺度，鞋身局部解释外观，成对或不同款式浏览承接选择；运动、通勤或礼服语境由商品决定。',
    usageDirection: '安排自然上脚、步态或人与鞋的尺度关系，鞋与脚对应，落脚和地面接触可信。没有运动属性的鞋不强套奔跑或竞技画面；同一页仍需有清楚的鞋形浏览。',
    subjectFocus: '鞋头、鞋口、鞋底边界、闭合部件及上脚接触位置',
    physical: '左右鞋构造相配但不是两只同侧鞋，鞋底与鞋面连续，鞋带孔和扣件合理；人体脚踝、脚趾方向与鞋口匹配，不穿模。只表现可见外底和表面，不制作未知气垫、碳板或爆炸剖面。',
    bounds: '不推断缓震、回弹、防滑、防水、真皮、重量或竞技性能；不把跑鞋当作全类模板，按经营特征保留正装鞋、靴、凉鞋等本来的形态与场合。款式变化来自轮廓、部件和配色，不仅换鞋标。',
    references: ['footwear-wearing-v2', 'footwear-color-v2', 'footwear-perspective-v2', 'footwear-product-v2', 'footwear-pair-v1'],
    editorialReferences: [
      { source: 'https://about.nike.com/en/newsroom/releases/nike-international-running-pack-official-images', observed: '同一系列结合上脚群像、色彩陈列、人物近景与独立商品图。', apply: '借主题统一下的主体尺度和展示角色变化，不复制商标、鞋型、运动员身份或性能。' },
    ],
  },
  fragrance: {
    version: 1, label: '香氛',
    traits: '实际商品形态、瓶身或容器比例、瓶盖和喷头、可见液体或蜡体、标签区域、表面与色彩',
    narrativeExample: '先以商品与光影建立一种生活意境，再用梳妆台、空间陈列或使用动作解释关系，瓶身或容器近景补充外观，相关香氛选择收束。意境不是未经证实的香调说明。',
    usageDirection: '按实际商品安排一种有信息的生活关系：香水的握瓶或梳妆空间、香薰的室内位置、蜡烛的陈列等，由模型取舍；不要求每类都喷在人体上，也不强制人物。',
    subjectFocus: '瓶身、喷头、瓶盖、容器口与液面，以及实际使用或摆放关系',
    physical: '玻璃状表面的透光、液面、折射与高光应连贯，瓶盖、喷头和容器口对应；蜡体和灯芯、扩香容器和杆件仅在商品实际形态需要时出现。摆放有承托，不把液体画成发光体。',
    bounds: '照片不能证明香调、配方、浓度、留香时长、精油成分、疗愈或除菌功效。花果木石可以是摄影意象，不能被写成产品含有的成分；未知香味用光色、时间与空间意境表达。不能把所有香氛改成香水瓶，香水、蜡烛、扩香和其他形态依经营资料处理。',
    references: ['fragrance-interior-v1', 'fragrance-product-v1', 'fragrance-home-v1', 'fragrance-art-v1'],
    editorialReferences: [
      { source: 'https://diptyqueparis.com/en-eu/pages/fragrances', observed: '整体香氛世界引入后，按商品形态与系列组织选择，并穿插单品和生活关系。', apply: '借意境、形态与选择的章节分工，不复制香调、品牌图案或故事文案。' },
      { source: 'https://diptyqueparis.com/en-eu/pages/candle-home-all', observed: '家居香氛通过不同容器尺度和空间陈列建立系列关系。', apply: '按真实经营形态选择空间场景；不把家居香氛与人体香水混用。' },
    ],
  },
  bags: {
    version: 1, label: '箱包',
    traits: '箱包轮廓与软硬、提手和肩带、闭合方式、外部口袋或轮件、表面纹理、配色与携带场合',
    narrativeExample: '主视觉提出出行或穿搭主题，携带画面说明人与箱包的比例关系，轮廓或部件近景补充外观，相关款式浏览承接选择；不把整页变成同一包的换角度目录。',
    usageDirection: '按商品形态安排手提、肩背、背负或推行关系，连接位置、受力和重心可信；手包、双肩包与旅行箱不共用一种姿势。不展示未经资料确认的容量或兼容设备。',
    subjectFocus: '包体轮廓、提手肩带连接点、闭合部件与携带接触位置',
    physical: '肩带、提手与包体连接连续，搭扣、拉链、轮件的位置和数量在同款各图一致；软包随承托自然弯折，硬箱保留体块，不把皮面、织物和金属反光混成一种质感。没有依据不展开内部隔层。',
    bounds: '不推断真皮、容量、承重、防水、防盗、航空登机尺寸或工艺等级。参考品牌的标识、专属纹样与独有五金造型不继承；不要把普通帆布包全部变成贵重皮包，或把旅行箱替换成手袋。',
    references: ['bags-worn-v1', 'bags-graphic-v1', 'bags-shape-v1', 'bags-street-v1'],
    editorialReferences: [
      { source: 'https://www.longchamp.com/us/en/collection/collections.html', observed: '系列主题图与相应商品选择成组出现，携带场景和图形静物交替。', apply: '学习一章一主题、海报与橱窗承接及色彩呼应，不复制商标、人物、包型或季节主题。' },
    ],
  },
};

const commonRules = [
  '先从经营特征提出一个具体主题，再决定各章要让用户理解什么。主题海报吸引注意，生活关系解释使用，可见局部增加信息，橱窗承接相关选择。具体模块、顺序和数量由你决定，不必凑齐这些表达，也不按素材数量机械填图。',
  '从实际附图选择content.reference作为整套摄影基准，在style和anchors中明确明暗面积、白平衡、光向与软硬、表面层次和颜色分工。其他参考只补局部构图，不另带一套调色；一致性来自同一摄影企划，不是把所有图做成同一纯色背景。',
  '主视觉要有明确的尺度、姿态、形状关系或局部色彩反差，后续画面有新信息与疏密变化；允许有表现力的布景和安静浏览交替。不要把高级感等同于所有图素白、灰色台座、小主体或一律暗底。环境要解释或衬托商品，不能盖过商品。',
  'collection是经营范围内本次创作的款式目录，不是上传SKU清单。同类示意款可以变化轮廓、细部和配色，不锁死上传数量或独特母题；不同款式用不同designId。同款跨图保持结构和色彩，必要的整体/使用/局部对应，不靠同款反复拍摄凑整页。',
  '参考图片用于摄影和叙事，不是经营品类或商品原样复制依据。以businessScope保留经营方向；参考人物、服饰、道具不自动变成本店商品。人物应原创且自然，禁止照搬案例人物身份、品牌标记、文字、专属图案或包装装潢。',
  '文案讲清本章主题、可见外观或普通生活意境，不编造品牌、价格、库存、认证、真实材质、技术参数或服务承诺。设计字由既有合字流程写入PNG，按真实槽位安排长短与留白；小格不塞段落，不依赖图外文字或整页染色。',
];

function usesCategoryCampaign(profile) {
  const definition = Object.hasOwn(definitions, profile?.id) ? definitions[profile.id] : null;
  return !!definition && profile.version >= definition.version
    && profile.creativeWorkflow === 'store-campaign-v1' && profile.pageComposition === 'platform-slots-v1';
}

function categoryCampaignProfile(mode) {
  const d = Object.hasOwn(definitions, mode) ? definitions[mode] : null;
  if (!d) return null;
  return {
    id: mode, version: d.version, name: `${d.label} · 叙事创作`,
    visualMethod: 'product-visual-v1', pageDirection: 'product-page-v1',
    creativeWorkflow: 'store-campaign-v1', pageComposition: 'platform-slots-v1',
    basis: '共用珠宝与数码的经营识别、整页创作、一次修订和原生组件图文交付流程；官方摄影素材实际进入规划及火山生图，不设品类白名单。生成效果待用户验收。',
    rules: [...commonRules, d.narrativeExample, d.usageDirection, d.physical, d.bounds],
    stages: {
      recognition: [
        `用户选择${d.label}模式后直接使用，不做适用性筛选或案例品类白名单。依据实际截图识别经营类别，不把参考案例、模特、背景和搭配道具当成本店商品。`,
        `每个groups返回name、products、businessTraits，分类名只在name定义一次。businessTraits概括${d.traits}；某件商品的独特图案或母题不是整类必需。原商品观察保留在products，description和imageIndex照常填写。`,
        'businessScope={summary,freedom,avoid}只概括经营方向，不重复categories；freedom允许经营特征内同类型示意款变化，avoid说明不可改换的经营形态。不能仅保留大类名称而丢掉代表性经营特点，也不要求后续逐一复刻原SKU。',
        d.bounds + '无法确认的内容放uncertainties，不从图片推断品牌或价格。',
      ].join('\n'),
      style: '依据实际摄影案例建立整套主题、光色与表面语言，保留主视觉亮点和后续变化。',
      content: '先确定各章表达，再由模型选择真实组件、款式和画面，不由程序选择模块。',
      design: '一次修订叙事衔接、参考运用、款式变化、物理关系、图文容量与整套一致性。',
    },
    narrativeExample: d.narrativeExample, usageDirection: d.usageDirection, subjectFocus: d.subjectFocus,
    referenceIds: [...d.references], editorialReferences: d.editorialReferences,
    generationInstructions: {
      intro: `生成一张可裁剪的${d.label}店铺广告摄影素材总图。所有格属于同一视觉企划，每格是独立完整照片。${d.narrativeExample}不拼贴案例，不绘制网页，不把参考商品加入本店未经营品类。`,
      physical: `${d.usageDirection}${d.physical}人物为原创成年人，不复制案例人物身份。`,
      bounds: `按每格比例和排字安全区构图，${d.subjectFocus}保留清楚边界。${d.bounds}本店商品为示意设计，不绘制文字、编号、品牌、水印或界面。`,
    },
  };
}

module.exports = { usesCategoryCampaign, categoryCampaignProfile };

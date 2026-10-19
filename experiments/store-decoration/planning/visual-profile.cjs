const { productVisualStages } = require('./visual-method.cjs');
const { skillSnapshot, integrationContract, skillStageInstructions, seriesContentInstructions, generationReferenceInstructions } = require('./visual-skill.cjs');
const { usesPageDirection, pageDirectionStages } = require('./page-direction.cjs');
const { campaignProfile, usesJewelryCampaign } = require('./campaign-contract.cjs');

// Saved tasks keep their visual rules; legacy jewelry tasks also skip the retired mode gate.
const jewelryRecognitionPolicy = '用户已经选择珠宝模式，直接采用该模式，不进行适用性、品类白名单或案例覆盖判断，不需要输出 modeAssessment。独立识别实际经营商品及可见特点，不把其他商品改识别为珠宝；佩戴背景或道具不算经营商品。保留原有商品信息充足性判断，sufficient 只依据截图是否清晰、信息是否足够，不依据是否符合珠宝模式。商品描述仍使用原有 description 和 imageIndex 字段，不新增字段。';
const generalProfile = {
  id: 'general', version: 4, name: '通用自动', visualMethod: 'product-visual-v1',
  basis: '采用共用视觉规划方法，依据实际商品决定主题和画面，不预设行业或布景。读取固定版本skill原文及visualSkill指定的用户案例图片，只迁移视觉语言；上传图用于理解商品方向，不要求复刻原SKU。搜索链接仅提供标题与网址，未读取网页正文。',
  rules: [
    '依据实际商品类别、可见特点及不确定信息确定创作边界，允许同类型示意，不把商品整体换成另一种经营方向。不同品类按各自形态和表面表现，不套用珠宝、数码或鞋履的专有部件与布景。',
    '只组合已确认经营商品；不编造品牌、真实材质、价格、认证或功能，不画未知内部结构。共享色彩关系与质感，具体环境、取景和光位服务各图用途。商品仍是焦点，画面不绘制文字、标识、参数或界面。',
  ],
  stages: {
    recognition: '沿用通用商品识别口径，依据截图提取实际经营品类、可见特点与图片编号，无法确认的内容保留在 uncertainties。不预设行业，不因缺少案例而拦截，不新增字段或适用性判断。',
    style: productVisualStages.style,
    content: productVisualStages.content,
    design: productVisualStages.design,
  },
};
const jewelryProfile = {
  id: 'jewelry', version: 17, name: '珠宝静物', visualMethod: 'product-visual-v1', pageDirection: 'jewelry-page-v1',
  basis: '完整识别资料进入后续设计，由AI判断实际经营方向并在范围内创作新款式，不要求复刻原SKU。现有规划调用读取固定版本skill原文，风格阶段实际接收visualSkill指定的用户案例图片，提取主体吸引力与视觉语言，不替换商品方向。下列references含历史分析记录，实际附图以visualReferences为准；不声称已验证生成效果。',
  references: [
    { file: 'huaban-6542776564.webp', takeaway: '静物承托、定向布光和接触阴影；不照搬酒红配色、金色材质或过大的道具。' },
    { file: 'huaban-6683619470.webp', takeaway: '明亮柔光、简洁环境和单品展示；不照搬人物、镜框及页面文字。' },
    { file: 'huaban-7191822506.webp', takeaway: '克制配色和商品重点；大字排版不是图片生成规则，首轮不扩展人物佩戴。' },
    { url: 'https://www.cartier.com/en-us/high-jewelry/latest-collections/en-equilibre/', takeaway: '项链的弧线、几何结构与辅助线形成构图关系，低对比背景衬托商品轮廓；不照搬牵引线、配色或商品。' },
    { url: 'https://www.vancleefarpels.com/gb/en/collections/jewelry/flora/frivole.html', takeaway: '花形珠宝与花朵、绿色环境建立主题联系，斜线与疏密形成节奏；学习由商品特征推导场景，不把所有珠宝放进花园。' },
    { url: 'https://www.chaumet.com/fr-fr', takeaway: '蓝紫背景上的梨形宝石戒指通过主体尺度、清楚轮廓和连续金属反光形成重点；静物冲击力不依赖复杂道具。' },
    { url: 'https://www.harrywinston.com/en/high-jewelry', takeaway: '浅底钻石项链通过弧线、切面明暗及投影保持结构；局部取景用于展示细节，不把整体展示都裁成局部。' },
    { url: 'https://www.piaget.com/us-en', takeaway: '单件戒指借助留白、背景渐变和方向明确的投影突出主体；不把商品都缩小或统一成同一背景。' },
    { url: 'https://github.com/oldred-byte/ec-visual-skill/blob/main/references/visual-dna.md', takeaway: '区分全套继承的色彩、反差和表面质感，与按用途变化的场景、承托、机位和构图；共享视觉语言不等于复制同一布景。' },
    { url: 'https://github.com/oldred-byte/ec-visual-skill/blob/main/references/message-picture-patterns.md', takeaway: '先明确本图要让人看懂什么，再选择具体画面。只借鉴适合静物的形状关系、完整外观、组合与可见细节表达，不引入未经证实的卖点、人物或内部结构。' },
  ],
  rules: [
    '根据完整识别资料区分店铺的代表性经营特征与某件商品特有的造型。由你判断应保留的装饰程度、表面表现和整体风格，在该范围内主动设计一组有款式差异的示意商品；装饰母题、轮廓、镶嵌排列和配色搭配可以变化，不把原图的特定动物、叶片或螺旋造型变成必选清单。不能只保留项链、手镯、戒指等大类名就忽略经营方向，也不能为拉开差异把商品整体换成另一种经营类型。不预设珠宝一律镶嵌或一律素金属。',
    '识别描述是视觉参考，不是真实材质、价值、品牌定位或功效的证明。结合 uncertainties 区分可见外观与推测，observations 中没有证据的定位或价值判断不能升级为事实。商品引用用于说明创作依据与允许品类，不是锁定原SKU；不增加未确认品类，不宣称品牌、天然材质、认证、等级、价格或功效。',
    '整套只选一个具体视觉主题，让商品的弧线、体块、切面或组合关系成为记忆点，不能只写“高级、奢华”或更换台座。主视觉只有一个主要焦点，少量配角服务构图，不为覆盖全部品类而把商品等大排队。不要把悬浮、透明支架、几何台座当作默认创意。',
    '全套继承协调的色彩关系、白平衡与反差、清楚可信的表面质感。内容阶段统一规划各图的环境、构图、明暗、疏密和参考用途，画面阶段按实际槽位落实光影细节，不另选一套场景。主视觉用形状与空间关系建立记忆点，辅助图让轮廓、组合或局部特征更易看懂。色板协调商品，不把所有背景染成同一种颜色，不默认黑金、深蓝或丝绒。',
    '每张图先有明确的可见信息，再选择表现：主题静物用形状呼应或空间关系吸引注意，完整外观让轮廓清楚，组合展示交代件数与疏密关系，局部近摄展示有依据的表面或连接特点。这些是按商品取舍的方法，不是必须凑齐的模板。相邻图片新增的内容应在去掉标题后仍可辨认；仅换品类名、微小角度或同一布景上的商品不算新的表达。',
    '自由设计的商品仍需具备可辨识的品类形态、自然的连接与承托关系。金属状表面用连续亮暗反射表现曲面，有色石状表面保留切面与基色，避免塑料质感、发光体及高光淹没轮廓；不要把所有颜色拼入每件商品。',
    '以静物摄影为主，不扩展模特、身体局部、佩戴或动态抓拍。不强制同款在整页反复出现，也不强制安排微距；明确呈现同款整体与细节时保持设计描述一致，不把不同款式冒充同一款的细节。',
    '依据实际展示比例与大小明确主体位于哪里、占画面宽或高的约几成、留白在哪一侧、靠什么接触面或重心成立；占比是本图的构图选择，不套全页固定数值。双列小图突出清楚轮廓和少量信息。留白服务焦点，不靠额外空白图拉长页面，不以极浅景深模糊主要商品。',
    '商品图不绘制品牌、价格、广告文字、界面或水印。仅导航图保留中央65%安全区，仅店招氛围背景下部35%留白；其他图片按各自比例与用途构图。设计不改变素材数量或程序给定的尺寸与展示规格。',
  ],
  stages: {
    recognition: [
      jewelryRecognitionPolicy,
      '分类名称继续使用项链、戒指、手镯等经营大类；在现有 description 中如实记录每件商品可见的造型、装饰与表面表现等有辨识力的特点，供后续AI理解商品类型，不只重复大类名称。保留 imageIndex 来源，不把金色写成已证实的黄金、闪亮石状外观写成已认证钻石或据此判断商品价值；看不清的内容记入 uncertainties。不增加字段、准入判断或原SKU复刻要求。',
    ].join('\n'),
    style: [
      pageDirectionStages.style,
      '沿用现有JSON字段，先综合 products 的描述与来源、observations 和 uncertainties 判断实际经营商品类型，再确定一个适合它们的视觉主题，不增加候选或生成阶段。不同商品各自的特点不能被强行统一成一种款式，单件特点也不能无依据推广给全部商品。案例只借鉴相容的形状关系、光影和疏密，不能用案例或主题替换商品方向。',
    ].join('\n'),
    content: [
      pageDirectionStages.content,
      'heroEvidenceIds 和正文 evidenceIds 引用真实 product-* 资料作为品类及经营特征依据，同一资料可支持多个不同示意款式；来源商品无须逐件入画。品类必须与本图实际展示内容对应，主视觉与正文合计覆盖全部已确认品类。允许改变具体造型，仍须延续实际经营方向，不把镶嵌装饰类整体换成素金属类或将素款升级为重装饰款，不借设计证明真实材质、工艺或品质。',
    ].join('\n'),
    design: [
      pageDirectionStages.design,
      '本阶段提供完整识别文字、逐图计划和案例，不附原商品截图；tasks.evidence 只核对经营类型及代表性特点，相同编号不要求同一原款。沿用内容阶段已设计的款式，不把识别推测或示意外观当作真实材质、工艺、品质或功能证明。camera 与景别一致，静物用 still-life，确有依据的局部按需用 texture。不输出 display 等输入字段。',
    ].join('\n'),
  },
};

const digitalProfile = {
  id: 'digital', version: 6, name: '数码产品', visualMethod: 'product-visual-v1',
  basis: '复用跨品类视觉规划方法，数码规则补充外形、部件、表面与屏幕约束。现有规划调用读取固定版本skill原文，风格阶段实际接收visualSkill指定的用户案例图片。保留原识别资料及原图传递路径，案例不限定可生成品类，也不替换经营商品；实际附图以visualReferences为准，效果待用户验收。',
  references: [
    { file: '57058bc63d1773c43da196a03841505a.jpg', takeaway: '侧向光、不同高度的陈列及前后景建立空间；不固定拱门、米色台座或多台手机组合。' },
    { file: '608a6ad25f4faba5ffa2bae8e48e8ddf.jpg', takeaway: '商品组合有主次，协调色调与反射；只组合输入已有的经营商品，不照搬手机、手表和耳机套装。' },
    { file: '6275b7b25f44e50172e1256c2b15a3d5.jpg', takeaway: '主题色贯穿整套，整体与细节承担不同展示任务；不照搬联名、参数、内部结构、人物或系统界面。' },
    { file: '91cccf27030c06605c97792eb6b2c7ca.jpg', takeaway: '主体充足，侧光区分纹理表面、金属边框与光滑部件；暗部保留细节，不复制价格、品牌或促销。' },
    { file: 'ad16a457feb2bda718d8c6e503446cfc.jpg', takeaway: '明亮背景、斜向组合和受控悬浮形成轻快广告构图；装饰不遮挡商品，不把悬浮强加给每张图。' },
    { url: 'https://github.com/oldred-byte/ec-visual-skill/blob/main/references/visual-dna.md', takeaway: '共享色彩关系、反差与表面质感；具体环境、承托和光位按每张图的展示任务决定，不统一成同一个科技展台。' },
    { url: 'https://github.com/oldred-byte/ec-visual-skill/blob/main/references/message-picture-patterns.md', takeaway: '先确定图片要让人看懂的外观信息，再选择主题构图、完整外观、组合或可见细节；不把未经证实的性能、内部结构或功能效果当作卖点画出来。' },
  ],
  rules: [
    '以实际识别的商品为主体，突出完整轮廓、主要结构及可见细节。规则适用于广泛数码产品，也可按用户选择应用于其他实际商品；手机、电脑、平板、耳机、音箱、键盘鼠标、相机、存储设备、智能穿戴与配件只是举例，不是白名单。没有专项案例的商品照常使用这些产品视觉原则，不强行换成案例中的手机。',
    '保留输入中可辨认的商品类别、颜色与主要外形，允许同类型示意，不承诺复刻原 SKU。每张图只组合已有经营商品；不根据参考案例添加手机、手表或耳机。涉及同一件示意商品的不同视角时，逐张提示词重复保留其主要外观特征、可见部件布局与配色，不混入其他商品的部件。',
    '按可见表面分别表现反射与纹理：金属状边缘有连续克制的高光，光滑玻璃状表面有清楚的反射层次，哑光及纹理表面保留细节。不把整个商品画成发光体，不把不同表面统一成塑料；未知材料只描述可见外观。',
    '为每张图确定主光方向及必要的轮廓光，使深色商品与背景分离，明亮表面不过曝，细节不被光效覆盖。背景与配色协调商品本身，不默认科技蓝、紫色霓虹或黑色背景，不改变商品颜色来迎合案例。',
    '按画面用途选择落地静物、稳定承托或受控悬浮陈列，并在提示词中给出一个明确方案。落地时接触阴影与摆放自然，悬浮时透视、商品间距和光影关系协调；部件连接完整，主体不互相穿插，不以爆炸拆解图代替外观展示。背景道具和装饰不能抢占主体或遮挡关键部件。',
    '全套共享协调的色彩关系、白平衡、反差与表面质感；具体背景、接触面、光位、软硬和机位按本图用途决定，不将同一台座、霓虹或悬浮阵列当作统一风格。首图用商品形状与空间关系建立主题，正文交代整体、组合或可见细节。相同商品可以再次出现，但需提供新的可见信息，不靠微小角度或换底色凑图。只展示可见结构，不编造芯片、内部散热、性能效果、接口功能、测量数据或认证。',
    '按程序给定的比例重新安排数量、朝向、主次与留白，横幅不直接照搬竖版海报构图，不把商品缩得难以辨认。主要结构清楚，细节图交代所拍部位与商品关系，避免用极浅景深模糊需要展示的部件。',
    '商品图不绘制品牌、型号文字、价格、广告语、参数表、界面控件或水印；屏幕可用简洁抽象色彩或反射表现，不虚构应用界面。文字继续由程序排版，店招氛围背景单独遵守原有留白规定，不强行加入商品。',
  ],
  stages: {
    recognition: '用户已经选择数码模式，直接采用该模式，不进行适用性、品类白名单或案例覆盖判断，不需要输出 modeAssessment。独立识别实际截图中的经营商品及可见特点，不因为缺少案例、不是手机或属于其他类别而要求切换模式，不将实际商品改识别成数码。保留原有商品信息充足性判断，sufficient 只依据截图是否清晰、信息是否足够，不依据是否符合数码模式。商品描述仍使用原有 description 和 imageIndex 字段，不新增字段。',
    style: [
      productVisualStages.style,
      '数码商品从实际轮廓、比例、部件排列与可见表面寻找主题依据；同属数码不代表可以混入未经营的商品，不将型号、参数、性能或品牌推测当作视觉主题。未被案例覆盖的商品照常设计，不默认科技蓝、霓虹、黑底或金属台座。',
    ].join('\n'),
    content: [
      productVisualStages.content,
      '沿用数码原有商品证据引用和正文品类覆盖，不新增 heroEvidenceIds。按可见轮廓、部件布局、颜色组合或有依据的外观局部安排信息；不编造接口、内部结构或功能，不把屏幕内容、性能图表及参数刻度文字当作展示任务，不强制微距。同款整体和局部保留主要形态与配色。',
    ].join('\n'),
    design: [
      productVisualStages.design,
      '结合商品截图、recognition 和任务描述保留实际类别、主要外形、颜色及可见部件布局，允许同类型示意，不要求复刻原SKU。新构图只能改变拍摄表现，不能添加接口、内部结构或功能效果；同款整体与局部保留相同外观。玻璃状、金属状和哑光表面分别控制反射与纹理，屏幕只用抽象色彩或反射。静物用 still-life，可见局部用 texture；未被案例覆盖的商品按自身结构设计。',
    ].join('\n'),
  },
};

const footwearProfile = {
  id: 'footwear', version: 5, name: '鞋履静物', visualMethod: 'product-visual-v1',
  basis: '复用共用视觉规划方法及固定版本skill原文，风格阶段实际接收visualSkill指定的用户案例图片。保留鞋型、成对关系、表面规则、静物及原图输入；案例不限定鞋型或可使用品类，实际附图以visualReferences为准，不声称已验证生成效果。',
  imageRules: '鞋类主体保留每格描述的鞋型、颜色和可见结构；成对鞋一左一右、同款同色，内外侧按实际结构呈现，不用两只同侧鞋冒充一双。不混合不同款的鞋头、鞋跟或鞋底，不编造被遮住的纹路或内部结构；鞋与承托接触自然。其他商品按自身结构呈现，不添加鞋类部件。',
  references: [
    { file: 'huaban-4053236247.webp', takeaway: '中性背景衬托不同鞋型，单鞋与成对陈列呈现鞋头、鞋跟和整体线条；提取静物段落的留白与表面表现，不照搬模特、创始人故事、品牌及促销。' },
    { file: 'huaban-5139905853.webp', takeaway: '大比例斜向主鞋与简洁背景形成重点，侧面展示鞋底与鞋面层次；不固定运动鞋、黄蓝配色或悬浮，不复制功能宣称、品牌与网页控件。' },
    { file: 'huaban-5839725565.webp', takeaway: '浅背景分离深色靴子的轮廓，连续高光交代靴筒曲面，侧面呈现鞋底和鞋跟连接；只借鉴商品表现，不加入人物腿部、价格或平台 UI。' },
    { file: 'huaban-6720594868.webp', takeaway: '成对错位、俯视和侧视让鞋口、鞋头与侧面各有展示任务，稳定承托使鞋型清楚；不复制商标、参数，也不把所有鞋都改成运动鞋。' },
    { file: 'huaban-7111121049.webp', takeaway: '暖色空间中的单品与成组静物分别表现光滑表面、织纹和编织感，多种鞋型保持各自特点；借鉴整套色调与展示节奏，不照搬优惠、价格、材质宣称和长页长度。' },
  ],
  rules: [
    '以实际识别的商品为主体，鞋履突出鞋型轮廓和可见结构。运动鞋、皮鞋、浅口鞋、高跟鞋、靴子、凉鞋、拖鞋及童鞋只是举例，不是白名单；未被案例覆盖的鞋类照常设计，不统一改成运动鞋。用户选择该模式时也不拦截其他商品，鞋部位规则只用于鞋类，其他商品按自身结构表达。',
    '保留输入中可辨认的类别、颜色、鞋头形状、鞋底厚度、鞋跟高度与鞋帮轮廓，允许同类型示意，不承诺原 SKU 一致。不为迎合参考图添加未确认的鞋型或配色。涉及同一款示意鞋的不同画面时，在各自提示词中重复保留主要外观特征，不混入其他款的鞋头、鞋跟或鞋底。',
    '按画面用途明确单鞋、成对或少量成组陈列。成对时一左一右、款式与配色一致，内外侧按各自结构呈现，不以两只同侧鞋冒充一双，不把内侧细节机械复制到外侧。鞋面与鞋底、鞋跟连接完整，鞋口与带扣结构合理，鞋带不穿透鞋体；不凭空增加鞋跟、鞋带或不属于该鞋型的部件。',
    '按可见表面表现不同质感：光滑表面有连续克制的高光，绒面状表面有柔和明暗，网布及编织状表面保留纹理，鞋底的层次与鞋面区分。不把所有鞋做成同一种发亮塑料。未知材料只描述外观，不虚构真皮、羊皮、缓震、透气、防水、增高效果或认证，不画内部结构和功能剖面。',
    '给每张商品图确定主光方向及必要的补光，使深色鞋与背景分离、浅色鞋保留边缘，鞋头、鞋口和鞋跟不过曝或埋入暗部。背景与商品颜色协调，可明亮清爽、温暖柔和或深色克制，不固定米色台座、运动蓝色或促销黄色，不改变鞋色来迁就风格。',
    '以静物为主，按需要选择平放、稳定倚靠或简洁承托，接触阴影、重心及鞋间距离自然。确有构图需要时可受控悬浮，须明确透视与光影关系，鞋体不穿插、不扭曲；每张提示词只给一个确定摆放方案。道具用于衬托轮廓，不能遮挡关键结构；首轮不引入模特、腿脚、上脚或运动抓拍。',
    '全套共享协调的色彩关系、反差与表面质感，背景、承托和光位按各图用途选择。以整体轮廓、成对关系、单品或同类组合、可见表面细节区分信息，不反复换角度拍同一台座凑长度。细节图交代所拍部位与鞋的关系，只展示输入支持的可见特征，不推测被遮住的鞋底花纹或内部工艺，也不把另一款鞋的细节拼到本款上。',
    '按程序给定的比例重排朝向、主次与留白，鞋头、鞋跟和靴筒留足裁切安全区，横幅不能直接照搬竖版构图。主体足够清楚，长靴和高跟鞋保留真实比例；主要结构保持清晰，不用极浅景深模糊需要展示的部位。商品图不绘制品牌标识、价格、功能文字、广告语、网页控件或水印；文字由程序排版，店招氛围背景继续遵守原有留白规定。',
  ],
  stages: {
    recognition: '用户已经选择鞋履模式，直接采用该模式，不进行适用性、鞋型白名单或案例覆盖判断，不需要输出 modeAssessment。独立识别实际经营商品及可见特点，不把其他商品改识别成鞋，不把搭配的服装、人物或道具当成经营品类。保留原有商品信息充足性判断，sufficient 不以是否属于鞋类或是否有案例为依据。商品描述仍使用原有 description 和 imageIndex 字段，不新增字段。',
    style: [productVisualStages.style, '依据实际鞋型轮廓、颜色、鞋底层次和可见表面确定主题，不把所有鞋统一成运动广告。光滑、绒面状或织纹外观各自保留特点，不以材料、舒适度或性能推测作为事实。'].join('\n'),
    content: [productVisualStages.content, '沿用原商品引用与正文品类覆盖，不增加字段。主体可为单鞋、成对或同类组合，同款连续展示保留鞋型与配色。只在有依据时选择局部，不编造鞋底花纹、内部工艺或功能，不安排模特、腿脚、上脚或性能示意。'].join('\n'),
    design: [productVisualStages.design, '依据商品截图与识别资料落实鞋型、数量、颜色和可见结构；成对时明确左右脚、朝向与接触关系，鞋头、鞋跟和靴筒留足边距。同款整体与局部使用一致描述，保留各类表面质感，不拼接其他款的细节。静物使用 still-life、可见局部使用 texture，不加入人体或上脚，不把设计外观当作材料或性能证明。'].join('\n'),
  },
};

function createVisualProfile(mode = 'general') {
  const profile = mode === 'general' ? generalProfile : mode === 'jewelry' ? campaignProfile : mode === 'digital' ? digitalProfile : mode === 'footwear' ? footwearProfile : null;
  if (!profile) throw Error('装修模式无效，请选择通用自动、珠宝、数码或鞋履。');
  const saved = JSON.parse(JSON.stringify(profile));
  saved.visualSkill = skillSnapshot(mode);
  if (usesJewelryCampaign(saved)) {
    saved.visualSkill.referenceIds = ['jewelry-portrait-v1', 'jewelry-wearing-v1', 'piaget-possession-v2', 'piaget-rose-v2', 'jewelry-editorial-v1'];
    saved.visualSkill.pageReferenceIds = ['jewelry-fashion-page-v1', 'jewelry-page-rhythm-v1'];
    saved.visualSkill.backgroundGuidance = 'campaign-reference-v1';
  } else if (usesPageDirection(saved)) {
    for (const stage of ['style', 'content', 'design']) saved.stages[stage] += '\n' + integrationContract;
    saved.visualSkill.referenceIds = ['piaget-possession-v2', 'piaget-rose-v2', 'jewelry-editorial-v1'];
    saved.visualSkill.pageReferenceIds = ['jewelry-page-rhythm-v1'];
    saved.visualSkill.backgroundGuidance = 'planned-reference-v1';
    saved.basis += '整页案例和单图案例同时进入内容规划，逐图创意与参考用途在此确定；程序按规划映射已有组件，画面设计负责落实，不自动合并相邻单图。';
  } else {
    for (const stage of ['style', 'content', 'design']) saved.stages[stage] += '\n' + (usesJewelrySeries(saved) && stage === 'content' ? seriesContentInstructions : skillStageInstructions[stage]);
    saved.stages.design += '\n' + generationReferenceInstructions;
  }
  saved.basis += '本版本使用有来源记录的精选案例，画面设计AI选择各图参考及借鉴边界；所选案例图片直接进入火山生图请求。';
  return saved;
}

function visualProfileFor(state) {
  // Legacy general tasks have no profile; keep their original planning and generation path.
  if (!state.generationMode || (state.generationMode === 'general' && !state.visualProfile)) return null;
  const profile = state.visualProfile;
  if (!['general', 'jewelry', 'digital', 'footwear'].includes(state.generationMode) || profile?.id !== state.generationMode || !Number.isInteger(profile.version) || profile.version < 1
    || !Array.isArray(profile.rules) || !profile.rules.length || profile.rules.some(rule => typeof rule !== 'string' || !rule)
    || ['recognition', 'style', 'content', 'design'].some(stage => typeof profile.stages?.[stage] !== 'string' || !profile.stages[stage])) {
    throw Error(`本任务缺少已保存的${state.generationMode === 'general' ? '通用' : state.generationMode === 'footwear' ? '鞋履' : state.generationMode === 'digital' ? '数码' : '珠宝'}规则，已停止；请新建任务，不会替换旧任务规则。`);
  }
  return profile;
}

function profileInstructions(profile, stage) {
  if (!profile) return '';
  const rules = stage === 'recognition' ? '' : '\n' + profile.rules.join('\n');
  // Retire the gate for resumed jewelry tasks too, without replacing saved visual directions.
  if (stage === 'recognition' && profile.id === 'jewelry') return '\n\n【珠宝模式：商品识别规则】\n' + (profile.version >= 4 ? profile.stages.recognition : jewelryRecognitionPolicy);
  // Apply the coverage contract fix to resumed v8 tasks without replacing their visual direction.
  const coverageContract = stage === 'content' && usesProductContext(profile)
    ? (usesJewelryVariants(profile)
      ? '\n【品类覆盖与创作依据】主视觉与正文合计覆盖全部已确认品类。heroEvidenceIds 与正文 evidenceIds 引用本图所示品类及代表性经营特征的来源资料，不要求来源商品的具体款式入画；同一编号可支持多个不同示意款式。不得借用画面中未展示品类的编号凑覆盖。已在首图展示的品类不必在正文重复，导航和店招不计入覆盖。保持原素材预算，不自动添加图片。'
      : '\n【品类覆盖口径修正】主视觉与正文合计覆盖全部已确认品类；本条替代旧规则中的“正文覆盖全部品类”。heroEvidenceIds 必须引用主视觉实际展示的商品资料，正文仍用 evidenceIds。已在首图展示的品类不必在正文重复；导航和店招不计入覆盖，不能填写未出现在画面中的商品编号凑覆盖。只在原有素材预算内安排，不自动添加图片。')
    : '';
  return `\n\n【${profile.id === 'general' ? '通用' : profile.id === 'footwear' ? '鞋履' : profile.id === 'digital' ? '数码' : '珠宝'}模式：本任务保存的设计规则】\n` + profile.stages[stage] + rules + coverageContract;
}

function profileContext(profile) {
  return profile ? { visualProfile: profile } : {};
}

function usesCategoryReference(profile) {
  // v8 retains the v5+ layout and text-only design path, with richer product context.
  return profile?.id === 'jewelry' && profile.version >= 5;
}

function usesProductContext(profile) {
  return profile?.id === 'jewelry' && profile.version >= 8;
}

function usesJewelryVariants(profile) {
  // New planning semantics must not rewrite evidence instructions in saved tasks.
  return profile?.id === 'jewelry' && profile.version >= 15;
}

function usesJewelrySeries(profile) {
  return profile?.id === 'jewelry' && profile.version >= 16;
}

function usesProductVisualMethod(profile) {
  return profile?.visualMethod === 'product-visual-v1';
}

function usesProductPageLayout(profile) {
  // Layout reuse must not change the product-evidence or original-image input path.
  return usesCategoryReference(profile) || usesProductVisualMethod(profile);
}

module.exports = { createVisualProfile, visualProfileFor, profileInstructions, profileContext, usesCategoryReference, usesProductContext, usesJewelryVariants, usesJewelrySeries, usesProductVisualMethod, usesProductPageLayout };

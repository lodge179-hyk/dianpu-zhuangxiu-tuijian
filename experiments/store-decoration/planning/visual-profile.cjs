// A task stores this complete profile so later resumes keep its original rules.
const jewelryProfile = {
  id: 'jewelry', version: 1, name: '珠宝静物',
  basis: '依据用户提供案例的人工视觉分析提炼。当前模型未直接读取案例图片，不声称复现案例或已验证生图效果。',
  references: [
    { file: 'huaban-6542776564.webp', takeaway: '静物承托、定向布光和接触阴影；不照搬酒红配色、金色材质或过大的道具。' },
    { file: 'huaban-6683619470.webp', takeaway: '明亮柔光、简洁环境和单品展示；不照搬人物、镜框及页面文字。' },
    { file: 'huaban-7191822506.webp', takeaway: '克制配色和商品重点；大字排版不是图片生成规则，首轮不扩展人物佩戴。' },
  ],
  rules: [
    '以静物商业摄影突出商品。商品的主石、轮廓和关键结构是视觉重点；道具、纹理和背景不能抢占注意力。',
    '保留输入中可辨认的商品类别、颜色与主要外形。允许同类型示意商品，不承诺原 SKU 一致；不为参考风格把银色改成金色，不虚构天然材质、认证、等级或价格。',
    '为每张商品图确定一个主光方向和有层次的局部反射。默认不使用装饰星芒、光晕、发光粒子、运动模糊或梦幻悬浮来表达高级感；高光不能淹没商品边界。',
    '按可见表面分别表现金属的反射层次、珍珠状表面的柔和光泽、有色主石的明暗和色彩，不把所有部位画成发光体或塑料。未知材料只描述外观。',
    '明确平放、倚靠、垂挂等稳定的摆放及承托关系，链条垂落、接触阴影和成对耳饰关系自然。首轮以静物为主，不引入模特、身体局部、佩戴或动态抓拍。',
    '主要商品结构和本图要展示的细节保持清晰；允许背景柔化，不同时要求多个部位清晰与极浅景深。微距展示可见外形，不编造内部结构、天然纹理或隐藏工艺。',
    '整套共享色调、光线质感和协调的背景体系，允许按用途改变背景明暗、景别和组合；不强制所有图片使用同一台座、渐变或全部色板颜色。',
    '主体适配程序给定的比例与裁切安全区。商品图不绘制品牌、价格、广告文字、界面或水印；店招氛围背景单独遵守原有留白规定，不强行加入商品。',
  ],
  stages: {
    recognition: '用户选择的是珠宝设计模式，不是商品事实。独立识别截图，不把服装、鞋包或数码改识别为珠宝；佩戴背景或道具不算经营商品。额外返回 modeAssessment：match 为 matched/mismatched/uncertain，reason 简要说明；只有经营商品都属于可辨认珠宝首饰才 matched，含明确其他经营品类则 mismatched，无法判断则 uncertain。保留原 sufficient 判断。',
    style: '为已识别商品选择一条静物摄影方向，明确背景体系、主光和表面表现。可以明亮柔和，也可以深色有层次；不固定酒红金饰、不依赖星芒和运动特效。用户案例规则约束视觉选择，搜索标题仅提供主题线索；不能声称已读取这些网页图片。选择与商品自身颜色协调的背景，不改商品颜色来迎合风格。',
    content: '保留原有组件选择逻辑、全部品类覆盖和素材预算。内容用途围绕整体静物、单品或成组展示、可见细节展开，每张正文图保持真实商品证据引用。不安排佩戴、动态抓拍或纯背景正文，不以静物为由重复同一摆拍来凑长度。',
    design: '把规则落实到每张最终 prompt，明确具体主体、摆放方式、景别与角度、主光方向、表面高光、背景和清晰范围。每张给出一个确定方案，不写“拉丝或抛光”“悬浮或佩戴”等互斥备选。camera 与实际景别一致；商品静物的 treatment 使用 still-life，细节需要时可用 texture，店招氛围图可用 environment。artDirection 与共享 style 必须一致，不重新引入已排除的特效；不同图通过用途与构图变化保持联系。',
  },
};

function createVisualProfile(mode = 'general') {
  if (mode === 'general') return null;
  if (mode !== 'jewelry') throw Error('装修模式无效，请选择通用自动或珠宝。');
  return JSON.parse(JSON.stringify(jewelryProfile));
}

function visualProfileFor(state) {
  if (!state.generationMode || state.generationMode === 'general') return null;
  const profile = state.visualProfile;
  if (state.generationMode !== 'jewelry' || profile?.id !== 'jewelry' || !Number.isInteger(profile.version) || profile.version < 1
    || !Array.isArray(profile.rules) || !profile.rules.length || profile.rules.some(rule => typeof rule !== 'string' || !rule)
    || ['recognition', 'style', 'content', 'design'].some(stage => typeof profile.stages?.[stage] !== 'string' || !profile.stages[stage])) {
    throw Error('本任务缺少已保存的珠宝规则，已停止；请新建任务，不会替换旧任务规则。');
  }
  return profile;
}

function profileInstructions(profile, stage) {
  if (!profile) return '';
  const rules = stage === 'recognition' ? '' : '\n' + profile.rules.join('\n');
  return '\n\n【珠宝模式：本任务保存的设计规则】\n' + profile.stages[stage] + rules;
}

function profileContext(profile) {
  return profile ? { visualProfile: profile } : {};
}

function readModeAssessment(value) {
  const result = value?.modeAssessment;
  if (!['matched', 'mismatched', 'uncertain'].includes(result?.match) || typeof result.reason !== 'string' || !result.reason.trim()) {
    throw Error('珠宝模式的商品适用性识别不完整，已保存响应，没有继续规划或生图。');
  }
  return { match: result.match, reason: result.reason.trim().slice(0, 180) };
}

module.exports = { createVisualProfile, visualProfileFor, profileInstructions, profileContext, readModeAssessment };

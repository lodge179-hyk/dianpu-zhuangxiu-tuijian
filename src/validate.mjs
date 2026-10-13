/**
 * 计划校验：在产生任何生图费用之前，确认 AI 的计划能被固定模块真正执行。
 *
 * 校验依据全部来自组件库的真实实现（容量、槽位数、内容字段），不是我们自己另立一套规则。
 * 任何一项不通过就直接报错中止——不带着错误计划去生图。
 */
import { MODULE_BY_TYPE } from './catalog.mjs';

const SOURCES = new Set(['product-photo', 'generated-scene', 'generated-nav-icon', 'generated-poster']);

/**
 * @param {object} plan normalizePlan 的输出
 * @returns {{ok:boolean, errors:string[], warnings:string[], slotCount:number, generatedSlotCount:number, slots:Array}}
 */
export function validatePlan(plan) {
  const errors = [];
  const warnings = [];
  const slotAssignments = new Map(); // slotId -> { moduleId, moduleType, slotIndex, source, subject, ratio }

  if (!plan || !Array.isArray(plan.modules) || !plan.modules.length) {
    return { ok: false, errors: ['计划里没有任何模块。'], warnings, slotCount: 0, generatedSlotCount: 0, slots: [] };
  }

  const seenModuleIds = new Set();
  for (const [index, module_] of plan.modules.entries()) {
    const where = `第 ${index + 1} 个模块 ${module_.id}`;
    const spec = MODULE_BY_TYPE.get(module_.type);
    if (!spec) {
      errors.push(`${where}：模块 type「${module_.type}」不在可选目录里。`);
      continue;
    }
    if (seenModuleIds.has(module_.id)) errors.push(`${where}：模块 id 重复，必须唯一。`);
    seenModuleIds.add(module_.id);
    if (!module_.reason) warnings.push(`${where}：没有给出选择理由。`);

    // 招牌位置
    if (spec.group === '店铺招牌' && index !== 0) errors.push(`${where}：店铺招牌必须在页面第一位。`);
    if (index === 0 && spec.group !== '店铺招牌') warnings.push(`${where}：页面第一位的不是店铺招牌，微购页面通常以招牌开场。`);

    // 图片槽位与分配
    const slotIds = collectSlotIds(module_, spec);
    const expected = expectedSlotCount(module_, spec);
    if (slotIds.length !== expected) {
      errors.push(`${where}（${spec.name}）：需要 ${expected} 张图，计划里给了 ${slotIds.length} 张。`);
      continue;
    }
    for (const [slotIndex, slotId] of slotIds.entries()) {
      if (!slotId) { errors.push(`${where}：第 ${slotIndex + 1} 个图片位是空的。`); continue; }
      if (slotAssignments.has(slotId)) { errors.push(`图片编号 ${slotId} 被用了两次。`); continue; }
      const declared = module_.images.find(i => i.slotId === slotId);
      if (!declared) { errors.push(`${where}：图片 ${slotId} 没有在 images 里声明来源。`); continue; }
      if (!SOURCES.has(declared.source)) {
        errors.push(`${where}：图片 ${slotId} 的来源「${declared.source}」不是四种允许来源之一。`);
        continue;
      }
      if (!declared.subject) warnings.push(`${where}：图片 ${slotId} 没有写画面内容。`);
      const slot = spec.slots[slotIndex];
      if (declared.aspect && !aspectMatches(declared.aspect, slot.ratio)) {
        warnings.push(`${where}：图片 ${slotId} 声明比例 ${declared.aspect}，槽位实际比例约 ${slot.ratio.toFixed(3)}。`);
      }
      slotAssignments.set(slotId, {
        slotId, moduleId: module_.id, moduleType: module_.type, slotIndex: slotIndex + 1,
        role: slot.role, slotWidth: slot.width, slotHeight: slot.height, slotRatio: slot.ratio,
        source: declared.source, subject: declared.subject,
      });
    }

    // 商品橱窗：商品信息完整性（组件库要求 商品数 === 实际使用的槽位数）
    if (spec.group === '商品橱窗') {
      const items = Array.isArray(module_.content?.items) ? module_.content.items : [];
      if (items.length < spec.capacity.min || items.length > spec.capacity.max) {
        errors.push(`${where}：商品数 ${items.length} 超出该模块容量 ${spec.capacity.min}~${spec.capacity.max}。`);
      }
      if (spec.type === 'showcase.three' && items.length % 3 !== 0) {
        errors.push(`${where}：三列橱窗的商品数必须是 3 的倍数，当前 ${items.length} 件。`);
      }
      for (const [i, item] of items.entries()) {
        if (!item?.title) errors.push(`${where}：第 ${i + 1} 件商品缺少名称。`);
        if (item?.price !== undefined && item.price !== '' && !/^[\d.,]+$/.test(String(item.price))) {
          errors.push(`${where}：第 ${i + 1} 件商品价格「${item.price}」不是纯数字；没有可靠价格就不要填。`);
        }
      }
    }

    // 招牌：不放自定义背景的极简招牌
    if (spec.type === 'signboard.minimal' && module_.content?.background) {
      errors.push(`${where}：极简招牌不接受自定义背景图（组件库会直接拒绝），请改用其他招牌或去掉 background。`);
    }
    if (spec.group === '店铺招牌' && spec.type !== 'signboard.minimal') {
      const bg = module_.content?.background;
      if (typeof bg !== 'string' || !bg) errors.push(`${where}：招牌缺少背景图槽位。`);
      const shop = module_.content?.shop;
      if (!shop || typeof shop !== 'object') errors.push(`${where}：招牌缺少 shop 信息。`);
      else {
        for (const key of ['name', 'avatar', 'newCount', 'totalCount']) {
          if (shop[key] === undefined) errors.push(`${where}：招牌 shop 缺少 ${key}。`);
        }
      }
    }
  }

  // 生图计划与槽位一一对应
  const generatedSlots = [...slotAssignments.values()].filter(s => s.source !== 'product-photo');
  const planSlotIds = new Set();
  for (const [i, image] of (plan.design?.imagePlan?.images || []).entries()) {
    if (!image.slots?.length) errors.push(`生图计划第 ${i + 1} 张（${image.id}）没有任何格子。`);
    for (const slot of image.slots || []) {
      if (!slotAssignments.has(slot.slotId)) {
        errors.push(`生图计划里的 ${slot.slotId} 不在任何模块的图片位上。`);
        continue;
      }
      if (planSlotIds.has(slot.slotId)) errors.push(`生图计划里的 ${slot.slotId} 重复出现。`);
      planSlotIds.add(slot.slotId);
      if (slotAssignments.get(slot.slotId).source === 'product-photo') {
        errors.push(`${slot.slotId} 标的是真实商品照片（product-photo），不应放进生图计划。`);
      }
    }
  }
  for (const slot of generatedSlots) {
    if (!planSlotIds.has(slot.slotId)) errors.push(`图片 ${slot.slotId} 需要生成，但没有出现在生图计划里。`);
  }

  const productSlots = [...slotAssignments.values()].filter(s => s.source === 'product-photo');
  const generated = plan.design?.imagePlan?.images?.length || 0;
  if (generated > 2) warnings.push(`计划里安排了 ${generated} 次生图，调用次数偏多；本轮目标是尽量少的调用。`);
  if (!productSlots.length) warnings.push('没有任何图片使用真实商品照片，全部依赖生成图；商品还原度会打折。');

  return {
    ok: errors.length === 0,
    errors: errors.slice(0, 12),
    warnings: warnings.slice(0, 12),
    slotCount: slotAssignments.size,
    generatedSlotCount: generatedSlots.length,
    productSlotCount: productSlots.length,
    sheets: generated,
    slots: [...slotAssignments.values()],
  };
}

/**
 * 该模块本次实际需要几张图。
 * 大部分模块槽位数固定；三列橱窗允许只放前 N 件（N 为 3 的倍数，最多 9），
 * 此时实际使用槽位数等于商品数，剩余槽位不渲染。
 */
export function expectedSlotCount(module_, spec) {
  if (spec.type === 'showcase.three') {
    const items = Array.isArray(module_?.content?.items) ? module_.content.items : [];
    return items.length;
  }
  return spec.slotCount;
}

/** 从模块 content 里按固定模块的槽位顺序取出 slotId 列表。 */
function collectSlotIds(module_, spec) {
  const content = module_.content || {};
  if (spec.group === '商品橱窗') {
    const items = Array.isArray(content.items) ? content.items : [];
    return items.map(item => (typeof item?.image === 'string' ? item.image : ''));
  }
  if (spec.group === '公告与文本') return [];
  if (spec.group === '店铺招牌') {
    const ids = [];
    if (spec.type !== 'signboard.minimal') ids.push(typeof content.background === 'string' ? content.background : '');
    ids.push(typeof content.shop?.avatar === 'string' ? content.shop.avatar : '');
    return ids;
  }
  return Array.isArray(content.images) ? content.images.map(i => (typeof i === 'string' ? i : i?.src || '')) : [];
}

function aspectMatches(declared, slotRatio) {
  const m = String(declared).match(/^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/);
  if (!m) return true;
  const ratio = Number(m[1]) / Number(m[2]);
  return Math.abs(ratio - slotRatio) / slotRatio < 0.12;
}

/** 三列橱窗允许只放一行：把槽位数按实际商品数收紧，避免误判。 */
export function expectedSlotIds(module_, spec) {
  return collectSlotIds(module_, spec);
}

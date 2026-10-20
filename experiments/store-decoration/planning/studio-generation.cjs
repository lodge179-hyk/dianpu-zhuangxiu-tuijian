function studioBatchPrompt(plan,batch,lookup,weights,total) {
 const fidelity=plan.studio.options.preserveProducts,editorial=plan.studio.version>=2;
 return [
  '生成一张可裁剪的店铺装修素材总图。每格是独立完整设计画面，不是网页，不画平台控件。逐格遵守指定的摄影、图标、插画或平面拼贴形式，不把所有格子都处理成摄影场景。',
  `整体主题：${plan.artDirection.concept}。统一联系：${plan.artDirection.anchors.join('；')}。用户风格：${plan.studio.style.name}，${plan.studio.style.direction}。设计色板：${plan.style.palette.join('、')}，只用于背景、图形和排字，不改变商品本色。背景色彩：${plan.style.background}；光线：${plan.style.lighting}；照片质感：${plan.style.photography}。`,
  '整体风格统一不等于所有图同一背景和强度。导航简化、商品浏览清楚、主banner形成焦点、细节提供信息。照片与图形可以共存；图标不继承摄影参考的台面、人物、纹理和阴影。图形/背景配色不能改变商品本色。',
  fidelity ? '商品保真已开启：用户原图是商品身份依据，逐格仅展示指定原商品。保留形状、配色、可见纹样、包装、连接结构和比例，不用案例商品替换，不混合多款，不设计新款。不臆造看不到的部位；允许改变构图与环境。原商品标识保持原样，不改成其他品牌；除本格明确的设计文案外不增加文字。' : '商品是已确认经营范围内的创意示意，按collection指定款式；不复制视觉案例的品牌、商品、人物身份，不编造真实在售、材料或功能。',
  `严格${batch.rows.flat().length}个矩形格、${batch.rows.length}行，各行格数${batch.rows.map(r=>r.length).join('/')}；总图宽高比约1:${total.toFixed(2)}。`,
  ...batch.rows.map((row,i)=>`第${i+1}行占有效高度约${Math.round(weights[i]/total*100)}%：\n`+row.map((id,j)=>{
    const a=lookup.get(id), designs=(a.designIds||[]).map(ref=>plan.campaign.collection.find(d=>d.id===ref));
    return `第${j+1}格（编号不入画），比例${a.aspect}；任务=${a.direction.role}；图像形式=${a.imageForm}：${a.prompt}\n${a.layoutBrief||''}\n入画款式：${designs.map(d=>d.id+' '+d.appearance+(d.sourceEvidenceId?'，原商品'+d.sourceEvidenceId:'')).join('；')||(editorial?'无商品的图形或招牌设计':'无商品招牌背景')}。${fidelity?'对应原图证据：'+(a.productReferences||[]).map(p=>p.evidenceId+'，上传第'+p.imageIndex+'张，'+p.description).join('；'):''}`;
  }).join('\n')),
  '每格外围和所有行列间使用纯洋红#FF00FF直线分隔带，宽约总图1至2%，禁止渐变，不能让阴影或物体跨格。画面内禁止使用分隔色。每格背景不透明。',
  editorial?'图文一体：每格layoutBrief中的标题和说明是唯一允许绘制的设计文案，逐字准确、中文笔画完整；没有文案的格子不加字。先组织商品、文字与背景的主次关系，保持字与商品轮廓分离及清楚对比；不默认白底文字板，不把正文压在商品上，程序不会追加文字或遮罩。纯图形短banner可以只有标题和克制图形；不要画假按钮、价格和平台控件。导航保留清楚轮廓，人物原创，接触与尺度自然。':'主体与文字留白共同构图；保留指定的安静空间但不画文字和假按钮。文字之后准确写入同一张PNG。导航关键轮廓在中央65%，同组角度、尺度、笔触一致，不把家具或完整场景缩进导航。人物原创，使用接触与尺度自然，商品为画面重点。',
 ].join('\n\n');
}
module.exports={studioBatchPrompt};

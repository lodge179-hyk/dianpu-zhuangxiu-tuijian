import fs from 'node:fs/promises';
const root='output/wego-external-capture-20260915';
const files=(await fs.readdir(root+'/formats')).filter(n=>n.endsWith('.json')&&!n.includes('排序')&&n!=='模块目录.json');
const rows=[];
for(const file of files){
 const d=JSON.parse(await fs.readFile(root+'/formats/'+file,'utf8'));const nodes=[];function walk(e){nodes.push(e);e.children?.forEach(walk)}walk(d.tree);
 const active=nodes.find(e=>typeof e.class==='string'&&e.class.includes('template_display_item')&&e.class.includes('swiper-slide-active'));
 const activeNodes=[];function flat(e){activeNodes.push(e);e.children?.forEach(flat)}if(active)flat(active);
 const title=nodes.find(e=>e.class==='template_name')?.text||'';
 const asset=activeNodes.find(e=>e.tag==='IMG')?.src;
 rows.push({format:file.slice(0,-5),pageTitle:d.title,displayLabel:title,sourceUrl:d.url,illustrationUrl:asset,illustrationRect:active?.rect,evidence:{json:'formats/'+file,screenshot:'formats/'+file.replace('.json','.png')},note:'矩形是PC编辑页示意图尺寸，不是店铺前台模块尺寸。'});
}
await fs.writeFile(root+'/format-index.json',JSON.stringify(rows,null,2));
const md=`# 微购相册装修格式采集（2026-09-15）

## 结论

- 原始参考22种：均已逐项切换并保存编辑页DOM、计算样式及截图。
- 额外采集3种：招牌全屏轮播、视频横版、全部商品列表式。合计25种独立编辑格式。
- 模块目录另列出全部商品标签式，但本账号当前列表式编辑页没有可切换的标签式入口，未完整采集。
- 通过独立Chrome与本机CDP采集；未点击编辑页完成及装修主页保存。最后刷新主页，放弃临时预览选择。

## 数据含义与限制

上传建议来自平台文字；顶部轮播是平台预制格式示意图，不能用其像素矩形推断小程序前台实际尺寸。本次完整的是格式目录和编辑配置界面，不代表已测出所有格式的前台边距、字号、图片裁切和组件高度。真实前台规则仍须通过预览页或小程序实测核对。

URL中的templateId可能保持进入编辑页时的值，切换后应以displayLabel和当前示意图资源为证据，不能仅凭URL识别样式。部分capture文本包含隐藏权限节点，应结合display和截图判断可见性。

## 格式索引

| 格式 | 平台显示/建议尺寸 | 编辑页截图 | DOM与尺寸 |
|---|---|---|---|
${rows.map(r=>`| ${r.format} | ${r.displayLabel|| (r.format==='视频-横版'?'视频最大20MB':'无尺寸文字')} | [截图](${r.evidence.screenshot}) | [JSON](${r.evidence.json}) |`).join('\n')}

## 文件

- format-index.json：25种格式结构化索引、官方示意图链接、当前页面标签及证据路径。
- formats/：逐格式截图与DOM。文件名含“排序”的为额外排序选项采集，未计入格式数量；模块目录为目录证据。
- export/decoration-config.json：装修接口响应，解析嵌套componentContent。
- export/captured-styles.css 与 external-*.css：页面实际加载的样式。
- export/endpoints.json、manifest.json：接口和采集来源。
- 上一级response-*.json、page-*.json：原始响应与页面快照。

规格要点：导航建议168×168；海报与橱窗建议1080×1080；轮播小/中/大分别1080×360、1080×810、1080×1440；招牌默认1080×720、经典1080×576、全屏轮播1080×2340；文本编辑器显示200字计数。
`;
await fs.writeFile(root+'/README.md',md);console.log(JSON.stringify(rows.map(r=>({format:r.format,label:r.displayLabel,asset:r.illustrationUrl})),null,2));

"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronRight, Copy, Download, ImagePlus, LoaderCircle, Sparkles, X } from "lucide-react";
import "./style.css";

type Stage = "input" | "generating" | "results";
type FlowVerdict = "clear" | "issue";
type UploadedImage = { name: string; url: string };

const plans = [
  { id: "atmosphere", name: "氛围先行", order: ["大轮播", "五项导航", "双列商品", "三图海报"], note: "先建立系列氛围，再逐步进入选款。" },
  { id: "quick", name: "快速选款", order: ["五项导航", "中轮播", "横滑商品", "组合海报"], note: "分类入口前置，适合目标明确的顾客。" },
  { id: "product", name: "商品强曝光", order: ["短轮播", "三列商品", "五项导航", "单列主推", "单海报"], note: "更快看到商品，缩短决策路径。" },
];
const checks = [
  ["upload", "上传商品图", "是否知道该传什么、还差什么"],
  ["brief", "填写装修需求", "是否容易表达主推商品与经营目标"],
  ["waiting", "等待生成", "是否清楚当前正在做什么"],
  ["compare", "比较三套方案", "是否能快速看懂方案差异"],
  ["export", "选择与导出", "是否知道最终会得到哪些文件和配置"],
];

export default function WorkflowPage() {
  const [stage, setStage] = useState<Stage>("input");
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [brief, setBrief] = useState("夏季女装上新，主推白色和低饱和粉色四扣罗纹短袖。希望顾客先感受到清透、轻盈的氛围，再快速选颜色和查看搭配。");
  const [progress, setProgress] = useState(0);
  const [selected, setSelected] = useState("atmosphere");
  const [scores, setScores] = useState<Record<string, FlowVerdict>>({});
  const [copyStatus, setCopyStatus] = useState("复制流程结论");
  const timers = useRef<number[]>([]);

  useEffect(() => () => { timers.current.forEach(window.clearTimeout); }, []);
  const completed = Object.keys(scores).length;
  const clearCount = useMemo(() => checks.filter(([id]) => scores[id] === "clear").length, [scores]);
  const ready = images.length > 0 && brief.trim().length >= 12;
  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter(file => file.type.startsWith("image/")).slice(0, 9 - images.length);
    setImages(old => [...old, ...files.map(file => ({ name: file.name, url: URL.createObjectURL(file) }))]);
    event.target.value = "";
  };
  const removeImage = (index: number) => setImages(old => { URL.revokeObjectURL(old[index].url); return old.filter((_, itemIndex) => itemIndex !== index); });
  const generate = () => {
    if (!ready) return;
    setStage("generating"); setProgress(0);
    [18, 42, 68, 88, 100].forEach((value,index) => timers.current.push(window.setTimeout(() => {
      setProgress(value);
      if (value === 100) timers.current.push(window.setTimeout(() => setStage("results"), 450));
    }, 650 * (index + 1))));
  };
  const exportPlan = () => {
    const plan = plans.find(item => item.id === selected)!;
    const payload = { version: 1, generatedAt: new Date().toISOString(), brief, inputImages: images.map(image => image.name), selectedPlan: plan, assets: { carousel: "1080x360", posters: "720x1200", navigation: "360x360" }, constraints: ["微购原生模块", "无额外标题或跳转", "无点赞收藏", "海报满铺", "图片间1px白线"] };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `店铺装修-${plan.name}.json`; anchor.click(); URL.revokeObjectURL(url);
  };
  const setScore = (id: string, value: FlowVerdict) => setScores(old => ({ ...old, [id]: value }));
  const conclusion = completed < 5 ? `还需评价 ${5 - completed} 项` : clearCount === 5 ? "通过：产品流程清晰，可以进入 MVP 定义" : `需要优化：${5 - clearCount} 个流程节点有问题`;
  const copyResults = async () => {
    const text = ["产品流程验证", ...checks.map(([id,name]) => `${name}：${scores[id] === "clear" ? "清楚" : scores[id] === "issue" ? "有问题" : "未评"}`), `选择方案：${plans.find(plan=>plan.id===selected)?.name}`, `结论：${conclusion}`].join("\n");
    try { await navigator.clipboard.writeText(text); setCopyStatus("已复制"); window.setTimeout(()=>setCopyStatus("复制流程结论"),1800); } catch { setCopyStatus("复制失败"); }
  };

  return <main className="workflow-page">
    <header className="workflow-header"><a href="/full-page"><ArrowLeft size={17}/>返回完整首页验证</a><div><span>第四阶段</span><h1>从商品图到装修方案</h1><p>这是一条可操作的产品流程原型。本轮模拟生成等待，不重复调用生图模型，只判断每一步是否自然、信息是否足够。</p></div><aside><small>当前步骤</small><strong>{stage === "input" ? "01 输入" : stage === "generating" ? "02 生成" : "03 选择"}</strong></aside></header>
    <nav className="workflow-steps"><div className={stage !== "input" ? "done" : "active"}><b>01</b><span>商品与需求</span></div><ChevronRight/><div className={stage === "generating" ? "active" : stage === "results" ? "done" : ""}><b>02</b><span>生成装修</span></div><ChevronRight/><div className={stage === "results" ? "active" : ""}><b>03</b><span>比较与导出</span></div></nav>
    {stage === "input" && <section className="workflow-input"><div className="upload-panel"><div className="panel-heading"><span>01 / 商品素材</span><h2>上传能看清商品的图片</h2><p>建议 3–9 张同款多角度图。首图用于识别商品，其他图片帮助保持版型、颜色和细节。</p></div><label className="upload-drop"><ImagePlus size={28}/><strong>选择商品图片</strong><span>JPG、PNG 或 WebP · 最多 9 张</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={upload}/></label><div className="upload-grid">{images.map((image,index)=><figure key={`${image.name}-${index}`}><img src={image.url} alt={image.name}/><button onClick={()=>removeImage(index)} aria-label={`移除 ${image.name}`}><X size={13}/></button><figcaption>{image.name}</figcaption></figure>)}</div><small className="input-count">已选择 {images.length}/9 张</small></div><div className="brief-panel"><div className="panel-heading"><span>02 / 装修目标</span><h2>告诉我你想怎么卖</h2><p>不需要写设计术语，只要说清主推什么、想让顾客先看到什么，以及希望顾客做什么。</p></div><textarea value={brief} onChange={event=>setBrief(event.target.value)} aria-label="装修需求"/><div className="brief-hints"><span>可以包含</span><i>主推商品</i><i>目标顾客</i><i>销售场景</i><i>浏览顺序</i></div><button className="generate-button" disabled={!ready} onClick={generate}><Sparkles size={16}/>生成三套装修方案</button><small>{!images.length ? "请先上传至少 1 张商品图" : brief.trim().length < 12 ? "再多描述一点经营目标" : "预计生成 3 套可在微购复刻的方案"}</small></div></section>}
    {stage === "generating" && <section className="generating-panel"><div className="generating-orbit"><LoaderCircle size={38}/><span>{progress}%</span></div><h2>{progress < 25 ? "正在识别商品特征" : progress < 55 ? "正在规划微购模块" : progress < 80 ? "正在生成同风格素材" : "正在合成三套完整首页"}</h2><p>你可以离开这个页面，完成后方案会保留在这里。</p><div className="progress-track"><i style={{width:`${progress}%`}}/></div><ol><li className={progress>=18?"done":""}>分析 {images.length} 张商品图</li><li className={progress>=42?"done":""}>生成三套受限布局</li><li className={progress>=68?"done":""}>制作轮播、海报与导航图</li><li className={progress>=88?"done":""}>检查商品身份和模块约束</li><li className={progress>=100?"done":""}>准备比较结果</li></ol></section>}
    {stage === "results" && <><section className="workflow-results"><header><div><span>生成完成</span><h2>选择最适合这次经营目标的方案</h2><p>三套方案使用同一批商品和视觉素材，差异只在顾客浏览路径。</p></div><button onClick={()=>setStage("input")}>修改输入</button></header><div className="result-grid">{plans.map((plan,index)=><button className={selected===plan.id?"selected":""} key={plan.id} onClick={()=>setSelected(plan.id)}><div className="result-preview"><img src="/validation/full-page/carousel.jpg" alt="方案主视觉"/><div>{plan.order.map((module,moduleIndex)=><span key={module}>{String(moduleIndex+1).padStart(2,"0")} {module}</span>)}</div></div><div className="result-copy"><span>方案 0{index+1}</span><h3>{plan.name}</h3><p>{plan.note}</p><i>{selected===plan.id?<><Check size={13}/>已选择</>:"选择这套"}</i></div></button>)}</div><div className="export-bar"><div><strong>{plans.find(plan=>plan.id===selected)?.name}</strong><span>将导出模块顺序、素材规格和微购搭建约束</span></div><button onClick={exportPlan}><Download size={16}/>导出装修清单</button></div></section><section className="flow-review"><header><span>流程验收</span><h2>刚才这五步是否清楚？</h2></header><div>{checks.map(([id,name,description],index)=><article key={id}><b>{String(index+1).padStart(2,"0")}</b><span><strong>{name}</strong><small>{description}</small></span><div><button className={scores[id]==="clear"?"clear":""} onClick={()=>setScore(id,"clear")}><Check size={12}/>清楚</button><button className={scores[id]==="issue"?"issue":""} onClick={()=>setScore(id,"issue")}>有问题</button></div></article>)}</div><footer className={completed===5?"complete":""}><p><strong>{conclusion}</strong><br/>{clearCount}/5 个节点清楚</p><button onClick={copyResults}><Copy size={14}/>{copyStatus}</button></footer></section></>}
  </main>;
}

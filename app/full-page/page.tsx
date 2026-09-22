"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Copy, Image as ImageIcon, Layers3 } from "lucide-react";
import "./style.css";

type ModuleType = "carousel" | "navigation" | "showcase" | "poster";
type Module = { type: ModuleType; variant: string };
type Plan = { id: string; title: string; eyebrow: string; rationale: string; modules: Module[] };
type Verdict = "adopt" | "adjust" | "reject";

const plans: Plan[] = [
  { id: "auto-1", title: "氛围先行", eyebrow: "轮播 → 导航 → 商品 → 海报", rationale: "先建立系列感，再顺着选色、看商品、浏览主题海报，路径最接近日常逛店。", modules: [{type:"carousel",variant:"large"},{type:"navigation",variant:"five"},{type:"showcase",variant:"double"},{type:"poster",variant:"triple"}] },
  { id: "auto-2", title: "快速选款", eyebrow: "导航 → 轮播 → 商品 → 海报", rationale: "把五个入口放在最前面，适合目标明确的老客，随后用场景和横滑商品延长浏览。", modules: [{type:"navigation",variant:"five"},{type:"carousel",variant:"medium"},{type:"showcase",variant:"slider"},{type:"poster",variant:"combo"}] },
  { id: "auto-3", title: "商品强曝光", eyebrow: "轮播 → 商品 → 导航 → 商品 → 海报", rationale: "用较短头图快速进入商品，主推款出现两次，转化路径短，但更考验重复感控制。", modules: [{type:"carousel",variant:"small"},{type:"showcase",variant:"triple"},{type:"navigation",variant:"five"},{type:"showcase",variant:"single"},{type:"poster",variant:"single"}] },
];
const navLabels = ["白色款", "粉色款", "面料细节", "双色陈列", "整套搭配"];
const productNames = ["白色四扣罗纹短袖", "低饱和粉罗纹短袖", "清透夏日搭配", "罗纹面料细节", "白色轻盈套装"];
const verdictLabels: Record<Verdict, string> = { adopt: "愿意采用", adjust: "调整后采用", reject: "不采用" };

function Carousel({ variant }: { variant: string }) { return <section className={`fp-carousel ${variant}`}><img src="/validation/full-page/carousel.jpg" alt="清透罗纹系列轮播图"/><div>● ○ ○</div></section>; }
function Navigation() { return <section className="fp-navigation">{navLabels.map((label, index) => <div key={label}><img src={`/validation/full-page/nav-${index + 1}.jpg`} alt={label}/><span>{label}</span></div>)}</section>; }
function Showcase({ variant, offset = 0 }: { variant: string; offset?: number }) {
  const count = variant === "single" ? 1 : variant === "double" ? 4 : variant === "triple" ? 3 : 5;
  return <section className={`fp-showcase ${variant}`}>{Array.from({ length: count }, (_, index) => { const asset = (index + offset) % 5; return <article key={index}><img src={`/validation/full-page/nav-${asset + 1}.jpg`} alt={productNames[asset]}/><strong>{productNames[asset]}</strong><span>¥{[129,129,169,109,199][asset]}</span></article>; })}</section>;
}
function Posters({ variant }: { variant: string }) {
  if (variant === "single") return <section className="fp-posters single"><img src="/validation/full-page/poster-3.jpg" alt="粉色罗纹上衣系列海报"/></section>;
  if (variant === "combo") return <section className="fp-posters combo"><img src="/validation/full-page/poster-1.jpg" alt="白色罗纹上衣主海报"/><div><img src="/validation/full-page/poster-2.jpg" alt="罗纹面料细节海报"/><img src="/validation/full-page/poster-3.jpg" alt="粉色罗纹上衣海报"/></div></section>;
  return <section className="fp-posters triple">{[1,2,3].map(index => <img key={index} src={`/validation/full-page/poster-${index}.jpg`} alt={`系列海报 ${index}`}/>)}</section>;
}
function StorePage({ plan }: { plan: Plan }) {
  let showcaseIndex = 0;
  return <div className="fp-phone"><div className="fp-phonebar"><span>9:41</span><span>◉ ◒ ▰</span></div><div className="fp-shop"><i>境</i><div><strong>织境日常研究所</strong><small>清透日常 · 本周新色</small></div><button>＋ 订阅</button></div>{plan.modules.map((module,index) => { if(module.type==="carousel") return <Carousel key={index} variant={module.variant}/>; if(module.type==="navigation") return <Navigation key={index}/>; if(module.type==="showcase"){const current=showcaseIndex++;return <Showcase key={index} variant={module.variant} offset={current*2}/>;} return <Posters key={index} variant={module.variant}/>; })}<footer>— 已经到底了 —</footer></div>;
}

export default function FullPageValidation() {
  const [verdicts,setVerdicts] = useState<Record<string,Verdict>>({});
  const [copyStatus,setCopyStatus] = useState("复制结论");
  useEffect(()=>{try{const saved=localStorage.getItem("full-page-verdicts-v1");if(saved)setVerdicts(JSON.parse(saved));}catch{}},[]);
  const adopted=useMemo(()=>plans.filter(plan=>verdicts[plan.id]&&verdicts[plan.id]!=="reject").length,[verdicts]);
  const completed=Object.keys(verdicts).length;
  const setVerdict=(id:string,verdict:Verdict)=>setVerdicts(old=>{const next={...old,[id]:verdict};localStorage.setItem("full-page-verdicts-v1",JSON.stringify(next));return next;});
  const conclusion=completed<3?`还需判断 ${3-completed} 套`:adopted>0?`通过：${adopted} 套具有采用价值`:"未通过：三套完整首页均无采用价值";
  const copyResults=async()=>{const text=["完整首页合成验证",...plans.map(plan=>`${plan.title}：${verdicts[plan.id]?verdictLabels[verdicts[plan.id]]:"未评"}`),`结论：${conclusion}`].join("\n");try{await navigator.clipboard.writeText(text);setCopyStatus("已复制");window.setTimeout(()=>setCopyStatus("复制结论"),1800);}catch{setCopyStatus("复制失败");}};
  return <main className="full-page-validation"><header className="fp-header"><a href="/consistency"><ArrowLeft size={17}/>返回一致性验证</a><div><span>第三阶段 C</span><h1>完整首页合成</h1><p>三套结构来自受限自动规划，使用同一批已通过的视觉素材。请从真实顾客浏览角度判断，而不是比较单张图片。</p></div><aside><Layers3 size={19}/><div><small>完整方案</small><strong>3 套</strong></div></aside></header><section className="fp-notes"><div><ImageIcon size={16}/><p><strong>本轮只判断整页</strong><br/>重点观察首屏是否抓人、上下节奏是否顺、素材是否重复过度，以及你是否愿意选一套继续做产品流程。</p></div><div><strong>资源控制</strong><span>9 张装修图片 · 浏览器复用缓存 · 已压缩为展示规格</span></div></section><section className="fp-plan-grid">{plans.map((plan,index)=><article className="fp-plan" key={plan.id}><header><span>0{index+1}</span><div><h2>{plan.title}</h2><p>{plan.eyebrow}</p></div></header><p className="fp-rationale">{plan.rationale}</p><StorePage plan={plan}/><div className="fp-verdict"><span>这套首页值得采用吗？</span><div>{(["adopt","adjust","reject"] as Verdict[]).map(verdict=><button key={verdict} className={verdicts[plan.id]===verdict?verdict:""} onClick={()=>setVerdict(plan.id,verdict)}>{verdict==="adopt"&&<Check size={12}/>} {verdictLabels[verdict]}</button>)}</div></div></article>)}</section><footer className={`fp-summary ${completed===3?"complete":""}`}><p><strong>{conclusion}</strong><br/>通过线：至少一套被判定为“愿意采用”或“调整后采用”。</p><button onClick={copyResults}><Copy size={14}/>{copyStatus}</button></footer></main>;
}

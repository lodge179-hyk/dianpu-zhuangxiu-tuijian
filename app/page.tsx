"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Download, Eye, Grid3X3, LayoutTemplate, Sparkles } from "lucide-react";

type ModuleType = "carousel" | "navigation" | "showcase" | "poster";
type StoreModule = { type: ModuleType; variant: string; assets: number[]; title?: string };
type StorePagePlan = { id: string; title: string; eyebrow: string; rationale: string; modules: StoreModule[] };

const images = ["/store-assets/denim-jacket.png", "/store-assets/item-1.png", "/store-assets/item-2.png", "/store-assets/item-3.png", "/store-assets/item-4.png", "/store-assets/item-5.png", "/store-assets/item-6.png", "/store-assets/item-7.png", "/store-assets/item-8.png"];
const plans: StorePagePlan[] = [
  { id: "focus", title: "主推商品型", eyebrow: "先建立记忆点", rationale: "用大幅主视觉快速说明本期主题，紧接分类入口和双列主推款，适合有明确新品或爆款的店铺。", modules: [
    { type: "carousel", variant: "large", assets: [0], title: "牛仔焕新" }, { type: "navigation", variant: "five", assets: [1,2,3,4,5], title: "热门分类" }, { type: "showcase", variant: "double", assets: [0,6], title: "本周主推" }, { type: "poster", variant: "single", assets: [0], title: "秋日牛仔企划" }, { type: "showcase", variant: "triple", assets: [3,7,8], title: "更多搭配" },
  ]},
  { id: "category", title: "分类导购型", eyebrow: "让顾客快速找到", rationale: "先把商品按用途分组，再穿插横向陈列和主题海报，适合商品数量较多、顾客目标明确的店铺。", modules: [
    { type: "navigation", variant: "five", assets: [1,2,3,4,5,6,7,8], title: "选你所爱" }, { type: "carousel", variant: "small", assets: [0], title: "换季衣橱计划" }, { type: "showcase", variant: "triple", assets: [1,2,3], title: "上装专区" }, { type: "poster", variant: "triple", assets: [4,5,6], title: "一周穿搭灵感" }, { type: "showcase", variant: "double", assets: [7,8], title: "配饰专区" },
  ]},
  { id: "browse", title: "丰富陈列型", eyebrow: "延长浏览路径", rationale: "用多种密度交替制造节奏，先展示丰富度，再用大图缓冲，适合希望顾客持续下滑探索的店铺。", modules: [
    { type: "carousel", variant: "medium", assets: [0], title: "秋季上新" }, { type: "showcase", variant: "triple", assets: [1,2,3], title: "今日上新" }, { type: "poster", variant: "combo", assets: [0,4,5], title: "编辑精选" }, { type: "navigation", variant: "four", assets: [1,2,3,4,5,6,7,8], title: "继续逛逛" }, { type: "showcase", variant: "slider", assets: [5,6,7], title: "人气推荐" },
  ]},
];
const labels: Record<ModuleType, string> = { carousel: "轮播图", navigation: "导航", showcase: "商品橱窗", poster: "海报" };

function Img({ index }: { index: number }) { return <img src={images[index % images.length]} alt="商品素材" className="asset-image" />; }
function ModuleHeader({ module, inspect }: { module: StoreModule; inspect: boolean }) { return <div className="module-heading"><span>{module.title}</span><span>全部 ›</span>{inspect && <b>{labels[module.type]} · {module.variant}</b>}</div>; }

function StoreModuleView({ module, inspect }: { module: StoreModule; inspect: boolean }) {
  if (module.type === "carousel") return <section className={`store-module inspect-${inspect}`}><div className={`hero hero-${module.variant}`}><Img index={module.assets[0]} /><div className="hero-copy"><small>NEW COLLECTION</small><strong>{module.title}</strong><span>探索本季质感单品</span></div><div className="dots">● ○ ○</div></div>{inspect && <div className="module-tag">轮播图 · {module.variant}</div>}</section>;
  if (module.type === "navigation") { const cols = module.variant === "four" ? 4 : 5; return <section className={`store-module pad inspect-${inspect}`}><ModuleHeader module={module} inspect={inspect}/><div className="nav-grid" style={{gridTemplateColumns:`repeat(${cols},1fr)`}}>{module.assets.map((a,i)=><div className="nav-item" key={i}><div><Img index={a}/></div><span>{["外套","套装","牛仔","上衣","裤装","新品","配饰","热卖"][i]}</span></div>)}</div></section>; }
  if (module.type === "showcase") return <section className={`store-module pad inspect-${inspect}`}><ModuleHeader module={module} inspect={inspect}/><div className={`product-grid ${module.variant === "slider" ? "slider" : ""}`} style={module.variant !== "slider" ? {gridTemplateColumns:`repeat(${module.variant === "double" ? 2 : module.variant === "triple" ? 3 : 1},1fr)`} : undefined}>{module.assets.map((a,i)=><article className="product-card" key={i}><div className="product-image"><Img index={a}/><button aria-label="收藏">♡</button></div><h3>{["复古水洗牛仔套装","轻盈通勤夹克","简约日常上装","质感秋冬搭配"][i%4]}</h3><p>¥{[199,239,169,299][i%4]}</p></article>)}</div></section>;
  return <section className={`store-module pad inspect-${inspect}`}><ModuleHeader module={module} inspect={inspect}/><div className={`poster-grid poster-${module.variant}`}>{module.assets.map((a,i)=><div key={i}><Img index={a}/>{i===0&&<span>{module.title}</span>}</div>)}</div></section>;
}

export default function Home() {
  const [active, setActive] = useState("focus"), [inspect, setInspect] = useState(false), [verdict, setVerdict] = useState<string>();
  const plan = useMemo(() => plans.find(p=>p.id===active)!, [active]);
  return <main className="workspace">
    <header className="topbar"><div className="brand"><span><LayoutTemplate size={18}/></span><div><strong>布局验证台</strong><small>微购首页方案 · 第一轮</small></div></div><div className="status"><i/>使用现有素材 · 人工布局</div><button className="secondary" onClick={()=>window.print()}><Download size={16}/>导出当前方案</button></header>
    <div className="shell">
      <aside className="left-panel"><div className="section-kicker">01 / 选择路线</div><h1>同一批商品，<br/>三种首页节奏</h1><p className="intro">先验证布局是否有选择价值，不评价视觉风格。</p><div className="plan-list">{plans.map((p,i)=><button key={p.id} className={active===p.id?"active":""} onClick={()=>{setActive(p.id);setVerdict(undefined)}}><span>0{i+1}</span><div><strong>{p.title}</strong><small>{p.eyebrow}</small></div><ChevronDown size={16}/></button>)}</div><div className="asset-summary"><div><Grid3X3 size={17}/><strong>本轮素材</strong></div><p>9 张服装商品图<br/>4 类微购模块 · 5 个首页区块</p></div></aside>
      <section className="canvas-area"><div className="canvas-toolbar"><div><span>手机端完整首页</span><b>{plan.title}</b></div><button className={inspect?"on":""} onClick={()=>setInspect(v=>!v)}><Eye size={16}/>{inspect?"隐藏模块":"查看模块"}</button></div><div className="phone-wrap"><div className="phone"><div className="phone-bar"><span>9:41</span><span>◉ ◒ ▰</span></div><div className="shop-strip"><div className="avatar">境</div><div><strong>织境日常研究所</strong><small>秋日衣橱 · 每周上新</small></div><button>＋ 订阅</button></div>{plan.modules.map((m,i)=><StoreModuleView key={`${active}-${i}`} module={m} inspect={inspect}/>)}<footer className="store-footer">— 已经到底了 —</footer></div></div></section>
      <aside className="right-panel"><div className="section-kicker">02 / 判断方案</div><h2>{plan.title}</h2><p className="rationale">{plan.rationale}</p><div className="structure"><span>页面结构</span>{plan.modules.map((m,i)=><div key={i}><b>{String(i+1).padStart(2,"0")}</b><i/><span>{labels[m.type]}</span><small>{m.title}</small></div>)}</div><div className="judge"><span>这套布局值得继续吗？</span><div><button className={verdict==="yes"?"chosen":""} onClick={()=>setVerdict("yes")}><Check size={16}/>愿意照着搭</button><button className={verdict==="no"?"chosen no":""} onClick={()=>setVerdict("no")}>结构没价值</button></div>{verdict&&<p>{verdict==="yes"?"已记录：这套结构具有采用价值。":"已记录：需要重新调整模块逻辑。"}</p>}</div><div className="boundary"><Sparkles size={17}/><p><strong>本轮只看布局</strong><br/>图片质感、字体和圆角不纳入判断。</p></div></aside>
    </div>
  </main>;
}

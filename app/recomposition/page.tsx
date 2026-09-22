"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import "./style.css";
import "./combo3-fix.css";

type Verdict="adopt"|"adjust"|"reject";
type Plan={id:string;name:string;sign:"default"|"classic"|"minimal";path:string;reason:string;modules:Array<{type:string;variant?:string}>};
const plans:Plan[]=[
 {id:"story",name:"氛围叙事型",sign:"default",path:"招牌 → 大轮播 → 单行公告 → 五宫格导航 → 双列商品 → 三图组合1 → 文字链接",reason:"7 个正文模块。用公告承接首屏氛围，再把顾客带到商品与主题搭配。",modules:[{type:"carousel",variant:"large"},{type:"single"},{type:"nav",variant:"five"},{type:"products",variant:"double"},{type:"poster",variant:"combo1"},{type:"link"},{type:"poster",variant:"single"}]},
 {id:"shop",name:"快速选购型",sign:"classic",path:"招牌 → 四宫格导航 → 中轮播 → 三列商品 → 多行文本 → 横滑商品 → 三图组合2",reason:"6 个正文模块。入口和商品前置，用多行文本解释面料与系列差异。",modules:[{type:"nav",variant:"four"},{type:"carousel",variant:"medium"},{type:"products",variant:"triple"},{type:"multi"},{type:"products",variant:"slider"},{type:"poster",variant:"combo2"}]},
 {id:"product",name:"商品聚焦型",sign:"minimal",path:"招牌 → 小轮播 → 单列商品 → 文字链接 → 双列海报 → 双列商品 → 三图组合3 → 单行公告",reason:"7 个正文模块。弱化招牌，把主推商品重复曝光，并用文字链接缩短购买路径。",modules:[{type:"carousel",variant:"small"},{type:"products",variant:"single"},{type:"link"},{type:"poster",variant:"double"},{type:"products",variant:"double"},{type:"poster",variant:"combo3"},{type:"single"}]},
];
const names=["白色四扣罗纹短袖","低饱和粉罗纹短袖","清透夏日搭配","罗纹面料细节","白色轻盈套装"];
function Sign({variant}:{variant:Plan["sign"]}){return <><div className={`rc-sign ${variant}`}><div className="rc-bar">9:41 <span>搜索　•••</span></div>{variant!=="minimal"&&<img src="/validation/full-page/carousel.jpg" alt="店铺招牌"/>}<div className="rc-id"><i>境</i><div><b>织境日常研究所</b><small>清透日常 · 本周新色</small></div></div></div></>}
function Carousel({variant}:{variant?:string}){return <div className={`rc-carousel ${variant}`}><img src="/validation/full-page/carousel.jpg" alt="系列轮播"/><span>● ○ ○</span></div>}
function Nav({variant}:{variant?:string}){const count=variant==="four"?4:5;return <div className={`rc-nav ${variant}`}>{Array.from({length:count},(_,i)=><div key={i}><img src={`/validation/full-page/nav-${i+1}.jpg`} alt={names[i]}/><small>{["白色款","粉色款","面料细节","整套搭配","本周新品"][i]}</small></div>)}</div>}
function Products({variant}:{variant?:string}){const count=variant==="single"?1:variant==="triple"?3:variant==="slider"?4:4;return <div className={`rc-products ${variant}`}>{Array.from({length:count},(_,i)=><div key={i}><img src={`/validation/full-page/nav-${i%5+1}.jpg`} alt={names[i%5]}/><b>{names[i%5]}</b><span>¥{[129,139,169,109][i]}</span></div>)}</div>}
function Poster({variant}:{variant?:string}){
 const slots=variant==="combo1"
  ?[{src:"/validation/full-page/poster-1.jpg",alt:"竖版人物主视觉"},{src:"/validation/full-page/nav-3.jpg",alt:"方形搭配细节"},{src:"/validation/full-page/nav-4.jpg",alt:"方形面料细节"}]
  :variant==="combo2"
  ?[{src:"/validation/full-page/nav-3.jpg",alt:"方形搭配细节"},{src:"/validation/full-page/nav-4.jpg",alt:"方形面料细节"},{src:"/validation/full-page/poster-3.jpg",alt:"竖版人物主视觉"}]
  :variant==="combo3"
  ?[{src:"/validation/full-page/carousel.jpg",alt:"横版系列场景"},{src:"/validation/full-page/nav-1.jpg",alt:"方形白色款细节"},{src:"/validation/full-page/nav-2.jpg",alt:"方形粉色款细节"}]
  :[{src:"/validation/full-page/poster-1.jpg",alt:"系列海报1"},{src:"/validation/full-page/poster-2.jpg",alt:"系列海报2"},{src:"/validation/full-page/poster-3.jpg",alt:"系列海报3"}];
 return <div className={`rc-poster ${variant}`}>{slots.map((slot,i)=><img key={`${slot.src}-${i}`} src={slot.src} alt={slot.alt}/>)}</div>
}
function TextModule({type}:{type:string}){if(type==="multi")return <div className="rc-text multi"><b>轻盈罗纹系列</b><p>柔软贴肤的细密罗纹，白色与低饱和粉色适合通勤和日常搭配。</p></div>;if(type==="link")return <div className="rc-text link"><span>查看本周新品搭配</span><b>›</b></div>;return <div className="rc-text single">🔊 清透夏装上新，本周下单享新品优惠</div>}
function Module({m}:{m:Plan["modules"][number]}){if(m.type==="carousel")return <Carousel variant={m.variant}/>;if(m.type==="nav")return <Nav variant={m.variant}/>;if(m.type==="products")return <Products variant={m.variant}/>;if(m.type==="poster")return <Poster variant={m.variant}/>;return <TextModule type={m.type}/>}
export default function Recomposition(){const [scores,setScores]=useState<Record<string,Verdict>>({story:"adopt",shop:"adopt"});const [copy,setCopy]=useState("复制第三关结论");useEffect(()=>setScores({story:"adopt",shop:"adopt"}),[]);const done=Object.keys(scores).length;const usable=Object.values(scores).filter(v=>v!=="reject").length;const passed=done===3&&usable>=2;const conclusion=done<3?"还需复验商品聚焦型":passed?`通过：${usable} 套完整首页具有采用价值`:"需要修正：完整格式加入后整页采用价值不足";const coverage=useMemo(()=>"前两套结论已锁定 · 仅复验商品聚焦型的三图组合3",[]);async function copyResult(){const text=["完整格式首页重新合成验证",...plans.map(p=>`${p.name}：${scores[p.id]==="adopt"?"愿意采用":scores[p.id]==="adjust"?"调整后采用":scores[p.id]==="reject"?"不采用":"未评"}`),`完成度：${done}/3`,`结论：${conclusion}`].join("\n");try{await navigator.clipboard.writeText(text);setCopy("已复制");setTimeout(()=>setCopy("复制第三关结论"),1500)}catch{setCopy("复制失败")}}
return <main className="rc-page"><header className="rc-head"><a href="/visual-modules">← 返回第二关</a><div><span>第三关 · 组合3局部复验</span><h1>商品聚焦型首页</h1><p>氛围叙事型和快速选购型已锁定为愿意采用。本页只复验修正后的三图组合3。</p></div><aside><small>总进度</small><b>{done}/3</b></aside></header><div className="rc-coverage">{coverage}　·　上方横图占半高，下方两张图保持正方形</div><section className="rc-grid rc-single-plan">{plans.filter(p=>p.id==="product").map((p)=><article className="rc-plan" key={p.id}><header><span>03</span><div><h2>{p.name}</h2><p>{p.path}</p></div></header><div className="rc-reason">{p.reason}</div><div className="rc-phone"><Sign variant={p.sign}/>{p.modules.map((m,i)=><Module key={i} m={m}/>)}<footer>— 已经到底了 —</footer></div><div className="rc-actions"><span>修正组合3后，这套完整首页值得采用吗？</span><div>{(["adopt","adjust","reject"] as Verdict[]).map(v=><button key={v} className={scores[p.id]===v?v:""} onClick={()=>setScores(s=>({...s,[p.id]:v}))}>{v==="adopt"&&<Check size={13}/>} {v==="adopt"?"愿意采用":v==="adjust"?"调整后采用":"不采用"}</button>)}</div></div></article>)}</section><footer className={`rc-summary ${passed?"pass":""}`}><div><b>{conclusion}</b><span>前两套结果已保留，只需重新评价商品聚焦型。</span></div><button onClick={copyResult}><Copy size={15}/>{copy}</button></footer></main>}

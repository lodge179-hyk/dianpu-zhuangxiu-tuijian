"use client";

import { Check, Copy, ExternalLink, PencilLine } from "lucide-react";
import { useMemo, useState } from "react";
import "./style.css";

type Binary = "yes" | "no";
type PosterVerdict = "direct" | "adjust" | "reject";

const signVariants = [
  { id:"default", name:"默认", note:"背景承载氛围，店铺信息压在下方渐变区域" },
  { id:"classic", name:"经典", note:"背景与白色店铺信息卡分层，信息识别更稳定" },
  { id:"minimal", name:"极简", note:"不生成招牌背景，只保留微购原生店铺信息" },
];
const posterVariants = [
  { id:"double", name:"双列" },
  { id:"slider", name:"多图滑动" },
  { id:"combo1", name:"三图组合1" },
  { id:"combo2", name:"三图组合2" },
  { id:"combo3", name:"三图组合3" },
];
const posterAssets=[1,2,3].map(index=>`/validation/full-page/poster-${index}.jpg`);

function NativeTools(){return <div className="vm-tools"><span>10:00</span><i>搜索</i><b>•••　◉</b></div>}
function Identity(){return <div className="vm-identity"><em>境</em><span><strong>织境日常研究所</strong><small>上新 72｜人气 2880</small></span></div>}
function Sign({variant}:{variant:string}){return <div className={`vm-sign ${variant}`}><NativeTools/>{variant!=="minimal"&&<img src="/validation/full-page/carousel.jpg" alt="清透夏装招牌背景"/>}<Identity/></div>}
function Posters({variant}:{variant:string}){return <div className={`vm-posters ${variant}`}>{[0,1,2].map((n,index)=><img key={index} src={posterAssets[n]} alt={`系列海报${index+1}`}/>)}</div>}

export default function VisualModulesPage(){
  const [signScores,setSignScores]=useState<Record<string,Binary>>({});
  const [textScores,setTextScores]=useState<Record<string,Binary>>({});
  const [posterScores,setPosterScores]=useState<Record<string,PosterVerdict>>({});
  const [single,setSingle]=useState("清透夏装上新，本周下单享新品优惠");
  const [multi,setMulti]=useState("夏日轻盈系列现已上新。主推白色与低饱和粉色四扣罗纹短袖，适合通勤与日常搭配。");
  const [linkText,setLinkText]=useState("查看本周新品搭配");
  const [targetType,setTargetType]=useState("商品");
  const [targetValue,setTargetValue]=useState("四扣罗纹短袖");
  const [copyLabel,setCopyLabel]=useState("复制第二关结论");
  const signDone=Object.keys(signScores).length,textDone=Object.keys(textScores).length,posterDone=Object.keys(posterScores).length;
  const completed=signDone+textDone+posterDone;
  const signUsable=Object.values(signScores).filter(v=>v==="yes").length;
  const textClear=Object.values(textScores).filter(v=>v==="yes").length;
  const posterUsable=Object.values(posterScores).filter(v=>v==="direct"||v==="adjust").length;
  const linkReady=Boolean(linkText.trim()&&targetValue.trim());
  const passed=completed===11&&signUsable>=2&&textClear===3&&posterUsable>=4&&linkReady;
  const conclusion=completed<11?`还需评价 ${11-completed} 项`:passed?"通过：新模块可以进入完整首页重新合成":"需要修正：新模块尚未达到第二关门槛";
  const summary=useMemo(()=>`${signUsable}/3 招牌可采用 · ${textClear}/3 文本清楚 · ${posterUsable}/5 海报可用`,[signUsable,textClear,posterUsable]);
  async function copy(){
    const lines=["新模块内容与视觉验证",...signVariants.map(v=>`店铺招牌·${v.name}：${signScores[v.id]==="yes"?"愿意采用":signScores[v.id]==="no"?"不采用":"未评"}`),`公告文本·单行：${textScores.single==="yes"?"清楚":textScores.single==="no"?"有问题":"未评"}`,`公告文本·多行：${textScores.multi==="yes"?"清楚":textScores.multi==="no"?"有问题":"未评"}`,`公告文本·文字链接：${textScores.link==="yes"?"清楚":textScores.link==="no"?"有问题":"未评"}`,`链接目标：${targetType}｜${targetValue||"未填写"}`,...posterVariants.map(v=>`新增海报·${v.name}：${posterScores[v.id]==="direct"?"可直接用":posterScores[v.id]==="adjust"?"轻微调整":posterScores[v.id]==="reject"?"不通过":"未评"}`),`完成度：${completed}/11`,`结论：${conclusion}`];
    try{await navigator.clipboard.writeText(lines.join("\n"));setCopyLabel("已复制");window.setTimeout(()=>setCopyLabel("复制第二关结论"),1600)}catch{setCopyLabel("复制失败")}
  }
  const binaryButtons=(group:"sign"|"text",id:string)=>{const scores=group==="sign"?signScores:textScores;const update=group==="sign"?setSignScores:setTextScores;return <div className="vm-buttons"><button className={scores[id]==="yes"?"yes active":"yes"} onClick={()=>update(old=>({...old,[id]:"yes"}))}><Check size={12}/>{group==="sign"?"愿意采用":"清楚"}</button><button className={scores[id]==="no"?"no active":"no"} onClick={()=>update(old=>({...old,[id]:"no"}))}>{group==="sign"?"不采用":"有问题"}</button></div>};
  return <main className="vm-page">
    <header className="vm-header"><a href="/formats">← 返回格式结构</a><div><span>第二关</span><h1>新模块内容与视觉验证</h1><p>结构已经通过。本轮只判断招牌是否值得采用、文本流程是否清楚，以及新增海报是否保持同一视觉系统。</p></div><aside><small>已评价</small><strong>{completed}/11</strong></aside></header>
    <section className="vm-section"><header><span>01</span><div><h2>店铺招牌</h2><p>同一家店、同一套清透夏装视觉，比较三种微购原生样式。</p></div><b>{signUsable}/3 可采用</b></header><div className="vm-grid signs">{signVariants.map(v=><article className="vm-card" key={v.id}><div className="vm-preview"><Sign variant={v.id}/></div><div className="vm-card-copy"><strong>{v.name}</strong><p>{v.note}</p>{binaryButtons("sign",v.id)}</div></article>)}</div></section>
    <section className="vm-section"><header><span>02</span><div><h2>公告和文本</h2><p>AI 起草、用户可编辑；文字链接配置目标后才允许导出。</p></div><b>{textClear}/3 清楚</b></header><div className="vm-grid texts"><article className="vm-card"><div className="vm-editor"><label>单行公告 <PencilLine size={13}/></label><input value={single} maxLength={50} onChange={e=>setSingle(e.target.value)}/><div className="native-single">🔊 {single||"请输入单行公告"}</div></div>{binaryButtons("text","single")}</article><article className="vm-card"><div className="vm-editor"><label>多行文本 <span>{multi.length}/200</span></label><textarea value={multi} maxLength={200} onChange={e=>setMulti(e.target.value)}/><div className="native-multi">{multi||"请输入多行文本"}</div></div>{binaryButtons("text","multi")}</article><article className="vm-card"><div className="vm-editor"><label>文字链接 <ExternalLink size={13}/></label><input value={linkText} onChange={e=>setLinkText(e.target.value)}/><div className="target-row"><select value={targetType} onChange={e=>setTargetType(e.target.value)}><option>商品</option><option>分类</option><option>外部链接</option></select><input value={targetValue} onChange={e=>setTargetValue(e.target.value)} placeholder="填写跳转目标"/></div><div className="native-link"><span>{linkText||"链接文案"}</span><b>›</b></div><small className={linkReady?"ready":"missing"}>{linkReady?"目标已配置，可导出":"目标未配置，禁止导出"}</small></div>{binaryButtons("text","link")}</article></div></section>
    <section className="vm-section"><header><span>03</span><div><h2>新增海报版式</h2><p>使用上一轮已经通过一致性验证的真实生成素材，只评价组合后的视觉可用性。</p></div><b>{posterUsable}/5 可用</b></header><div className="vm-grid posters">{posterVariants.map(v=><article className="vm-card" key={v.id}><div className="vm-preview poster"><Posters variant={v.id}/></div><div className="vm-card-copy"><strong>{v.name}</strong><div className="vm-buttons three"><button className={posterScores[v.id]==="direct"?"yes active":"yes"} onClick={()=>setPosterScores(old=>({...old,[v.id]:"direct"}))}>可直接用</button><button className={posterScores[v.id]==="adjust"?"adjust active":"adjust"} onClick={()=>setPosterScores(old=>({...old,[v.id]:"adjust"}))}>轻微调整</button><button className={posterScores[v.id]==="reject"?"no active":"no"} onClick={()=>setPosterScores(old=>({...old,[v.id]:"reject"}))}>不通过</button></div></div></article>)}</div></section>
    <footer className={`vm-summary ${passed?"passed":""}`}><div><strong>{conclusion}</strong><span>{summary}</span></div><button onClick={copy}><Copy size={14}/>{copyLabel}</button></footer>
  </main>
}


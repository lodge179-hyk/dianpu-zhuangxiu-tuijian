"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, CircleAlert, Copy, Image as ImageIcon } from "lucide-react";
import "./validation.css";
import "./conclusion.css";
import "./grid-adjustments.css";

type Verdict = "pass" | "minor" | "fail";
type Route = "a" | "b" | "c";
const samples = [
  { id: "apparel", name: "服装上身", note: "人物、版型、面料", input: "/validation/inputs/apparel-1.jpg" },
  { id: "leather-shorts", name: "皮质短裤", note: "反光材质、腰线与裤型", input: "/validation/inputs/leather-shorts-1.jpg" },
  { id: "cosmetics", name: "美妆礼盒", note: "包装、色彩与物件数量", input: "/validation/inputs/cosmetics-2.jpg" },
  { id: "shoes", name: "运动鞋", note: "鞋型、鞋底与侧面纹理", input: "/validation/inputs/shoes-1.jpg" },
  { id: "motorcycle", name: "摩托车", note: "车身结构、灯组与机械细节", input: "/validation/inputs/motorcycle-1.jpg" },
];
const verdicts: Array<{ id: Verdict; label: string }> = [{ id: "pass", label: "可直接用" }, { id: "minor", label: "轻微调整" }, { id: "fail", label: "商品失真" }];

export default function ValidationPage() {
  const [scores, setScores] = useState<Record<string, Verdict>>({});
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const totals = useMemo(() => ({ a: samples.filter(s => scores[`${s.id}-a`] && scores[`${s.id}-a`] !== "fail").length, b: samples.filter(s => scores[`${s.id}-b`] && scores[`${s.id}-b`] !== "fail").length, c: samples.filter(s => scores[`${s.id}-c`] && scores[`${s.id}-c`] !== "fail").length }), [scores]);
  const completed = Object.keys(scores).length;
  useEffect(() => { try { const saved = localStorage.getItem("image-fidelity-scores-v1"); if (saved) setScores(JSON.parse(saved)); } catch {} }, []);
  const setScore = (sample: string, route: Route, verdict: Verdict) => setScores(old => { const next = {...old, [`${sample}-${route}`]: verdict}; localStorage.setItem("image-fidelity-scores-v1", JSON.stringify(next)); return next; });
  const copyResults = async () => {
    const label = Object.fromEntries(verdicts.map(item => [item.id, item.label]));
    const lines = [
      "商品保真验证结果",
      `完成度：${completed}/15`,
      `合格数：A ${totals.a}/5，B ${totals.b}/5，C ${totals.c}/5`,
      ...samples.map(sample => `${sample.name}：${(["a", "b", "c"] as Route[]).map(route => `${route.toUpperCase()} ${scores[`${sample.id}-${route}`] ? label[scores[`${sample.id}-${route}`]] : "未评"}`).join("；")}`),
      `自动结论：${conclusion}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 1800);
    } catch {
      setCopyStatus("failed");
    }
  };
  const conclusion = completed < 15 ? `还需判断 ${15-completed} 张` : Math.max(totals.a,totals.b,totals.c) >= 4 ? "通过：至少一条路线达到下一阶段门槛" : "未通过：先解决商品保真，不进入跨模块生成";
  return <main className="validation-page">
    <header className="validation-header"><a href="/"><ArrowLeft size={17}/>返回布局验证</a><div><span>第三阶段 A</span><h1>商品保真路线对照</h1><p>同一商品、同一宽幅规格。先判断是不是同一件商品，再判断画面是否好看。</p></div><div className="score-board"><small>当前合格数</small><b>A {totals.a}/5</b><b>B {totals.b}/5</b><b>C {totals.c}/5</b></div></header>
    <section className="route-legend"><div><strong>原始商品图</strong><span>商品身份基准</span></div><div><strong>A · 直接生成</strong><span>设计强，可能改商品</span></div><div><strong>B · 提示保留</strong><span>模型仍会重新绘制</span></div><div><strong>C · 原图合成</strong><span>确定性处理，不重绘商品</span></div></section>
    <section className="validation-list">{samples.map((sample,index)=><article className="validation-row" key={sample.id}><div className="sample-title"><span>{String(index+1).padStart(2,"0")}</span><div><h2>{sample.name}</h2><p>重点：{sample.note}</p></div></div><div className="comparison-grid"><figure className="source-card"><div><img src={sample.input} alt={`${sample.name}原图`}/></div><figcaption><ImageIcon size={14}/>原图</figcaption></figure>{(["a","b","c"] as Route[]).map(route=><figure key={route}><img src={`/validation/outputs/${sample.id}-${route}.png`} alt={`${sample.name}路线${route.toUpperCase()}结果`}/><figcaption><strong>路线 {route.toUpperCase()}</strong><div>{verdicts.map(v=><button key={v.id} className={scores[`${sample.id}-${route}`]===v.id?v.id:""} onClick={()=>setScore(sample.id,route,v.id)}>{v.id==="pass"&&<Check size={12}/>} {v.label}</button>)}</div></figcaption></figure>)}</div></article>)}</section>
    <footer className={`validation-summary ${completed===15?"complete":""}`}><CircleAlert size={18}/><p><strong>{conclusion}</strong><br/>用户结论：A 5/5，B 5/5，C 0/5。A/B 进入跨模块验证，C 淘汰。</p><a href="/consistency">进入跨模块验证</a><button type="button" onClick={copyResults}><Copy size={14}/>{copyStatus === "copied" ? "已复制" : copyStatus === "failed" ? "复制失败" : "复制评分结果"}</button></footer>
  </main>;
}

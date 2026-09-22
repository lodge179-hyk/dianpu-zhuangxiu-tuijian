"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, CircleAlert, Copy } from "lucide-react";
import "./style.css";
import "./handoff.css";

type Verdict = "pass" | "minor" | "fail";

const navItems = [
  ["nav-1.png", "白色款"],
  ["nav-2.png", "粉色款"],
  ["nav-3.png", "面料细节"],
  ["nav-4.png", "双色陈列"],
  ["nav-5.png", "整套搭配"],
];

const criteria = [
  ["palette", "颜色统一", "奶白、浅绿与低饱和粉是否属于同一套配色"],
  ["light", "光线统一", "窗边柔光、阴影方向与画面明暗是否连贯"],
  ["material", "材质统一", "薄纱、弧形空间与金属道具是否形成共同语言"],
  ["product", "商品统一", "四扣、罗纹、版型和白/粉配色是否仍像同一款商品"],
  ["whole", "整页统一", "连续浏览时是否像一家店，而不是九张无关图片"],
];

const verdicts: Array<{ id: Verdict; label: string }> = [
  { id: "pass", label: "统一" },
  { id: "minor", label: "轻微跳脱" },
  { id: "fail", label: "不统一" },
];

export default function ConsistencyPage() {
  const [scores, setScores] = useState<Record<string, Verdict>>({});
  const [copyStatus, setCopyStatus] = useState("复制结论");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("consistency-scores-v1");
      if (saved) setScores(JSON.parse(saved));
    } catch {}
  }, []);
  const completed = Object.keys(scores).length;
  const qualified = useMemo(() => criteria.filter(([id]) => scores[id] && scores[id] !== "fail").length, [scores]);
  const conclusion = completed < criteria.length
    ? `还需判断 ${criteria.length - completed} 项`
    : qualified === criteria.length
      ? "通过：可以进入完整首页合成"
      : "未通过：先收敛跨模块视觉规范";
  const setScore = (id: string, verdict: Verdict) => setScores(old => {
    const next = { ...old, [id]: verdict };
    localStorage.setItem("consistency-scores-v1", JSON.stringify(next));
    return next;
  });
  const copyResults = async () => {
    const labels = Object.fromEntries(verdicts.map(item => [item.id, item.label]));
    const text = [
      "跨模块视觉一致性验证",
      `完成度：${completed}/${criteria.length}`,
      ...criteria.map(([id, name]) => `${name}：${scores[id] ? labels[scores[id]] : "未评"}`),
      `结论：${conclusion}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("已复制");
      window.setTimeout(() => setCopyStatus("复制结论"), 1800);
    } catch { setCopyStatus("复制失败"); }
  };

  return <main className="consistency-page">
    <header className="consistency-header">
      <a href="/validation"><ArrowLeft size={17}/>返回商品保真验证</a>
      <div><span>第三阶段 B</span><h1>跨模块视觉一致性</h1><p>同一商品、同一视觉简报生成九张素材。请连续浏览后判断它们是否属于同一家店。</p></div>
      <aside><small>生成素材</small><strong>1 + 3 + 5</strong><span>轮播 · 海报 · 导航</span></aside>
    </header>

    <div className="consistency-layout">
      <section className="phone-column">
        <div className="phone-label"><span>微购首页模拟</span><b>空气感罗纹系列</b></div>
        <div className="store-phone">
          <div className="phone-bar"><span>9:41</span><span>◉ ◒ ▰</span></div>
          <div className="shop-strip"><div className="avatar">境</div><div><strong>织境日常研究所</strong><small>清透日常 · 本周新色</small></div><button>＋ 订阅</button></div>
          <section className="campaign-carousel"><img src="/validation/consistency/carousel.png" alt="白色罗纹上衣轮播图"/><div className="dots">● ○ ○</div></section>
          <section className="campaign-nav">{navItems.map(([file, label]) => <div key={file}><img src={`/validation/consistency/${file}`} alt={label}/><span>{label}</span></div>)}</section>
          <section className="campaign-posters">{[1, 2, 3].map(index => <img key={index} src={`/validation/consistency/poster-${index}.png`} alt={`系列海报 ${index}`}/>)}</section>
          <footer>— 已经到底了 —</footer>
        </div>
      </section>

      <aside className="consistency-review">
        <div className="review-intro"><span>验收重点</span><h2>不要逐张评分，<br/>先看整套是否连贯</h2><p>“轻微跳脱”也算可继续；只要出现一项“不统一”，下一步就先修视觉规范。</p></div>
        <div className="criteria-list">{criteria.map(([id, name, description], index) => <article key={id}>
          <div><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{name}</strong><small>{description}</small></span></div>
          <div className="verdict-row">{verdicts.map(verdict => <button key={verdict.id} className={scores[id] === verdict.id ? verdict.id : ""} onClick={() => setScore(id, verdict.id)}>{verdict.id === "pass" && <Check size={12}/>} {verdict.label}</button>)}</div>
        </article>)}</div>
        <div className={`consistency-conclusion ${completed === criteria.length ? "complete" : ""}`}><CircleAlert size={18}/><p><strong>{conclusion}</strong><br/>用户结论：5/5 全部统一，可以进入完整首页合成。</p><a href="/full-page">进入完整首页验证</a><button onClick={copyResults}><Copy size={14}/>{copyStatus}</button></div>
      </aside>
    </div>
  </main>;
}

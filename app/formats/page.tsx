"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import StoreModule from "../../components/store-module";
import { formatCount, storeFormatRegistry, type StoreFormatType } from "../../lib/store-formats";
import "./style.css";

type Verdict = "clear" | "issue";
const reviewVersion = "shared-renderer-v1";
const storageKey = "format-review:" + reviewVersion;
const groups = Object.entries(storeFormatRegistry).map(([type, format]) => ({ type: type as StoreFormatType, label: format.label, variants: Object.entries(format.variants) }));
const validKeys = new Set(groups.flatMap(group => group.variants.map(([variant]) => group.type + "." + variant)));

export default function FormatsPage() {
  const [scores, setScores] = useState<Record<string, Verdict>>({});
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}"); setScores(Object.fromEntries(Object.entries(saved).filter(([key, value]) => validKeys.has(key) && (value === "clear" || value === "issue"))) as Record<string,Verdict>); } catch { setNotice("本机复验记录读取失败，请重新评价"); }
    setLoaded(true);
  }, []);
  useEffect(() => { if (loaded) try { localStorage.setItem(storageKey, JSON.stringify(scores)); } catch { setNotice("无法保存本机复验记录，请复制结果留存"); } }, [loaded, scores]);
  const completed = Object.keys(scores).length;
  const passed = Object.values(scores).filter(value => value === "clear").length;
  const conclusion = completed < formatCount ? "当前实现还有 " + (formatCount-completed) + " 项未评价" : passed === formatCount ? "当前实现全部通过" : "当前实现有 " + (formatCount-passed) + " 项需要修正";
  async function copyResult() {
    const lines = ["当前实现复验：" + reviewVersion, ...groups.flatMap(group => group.variants.map(([variant, format]) => group.label + " · " + format.label + "：" + (scores[group.type + "." + variant] === "clear" ? "正确" : scores[group.type + "." + variant] === "issue" ? "有问题" : "未评价"))), conclusion];
    try { await navigator.clipboard.writeText(lines.join("\n")); setNotice("已复制当前复验结果"); } catch { setNotice("复制失败"); }
  }
  return <main className="formats-page">
    <header className="formats-header"><a href="/">← 返回任务</a><div><span>当前实现复验</span><h1>完整装修格式</h1><p>历史格式验证：22/22 通过；单列商品橱窗修复已获认可。以下是共享组件迁移后的独立复验，未评价项不自动沿用历史通过结论。</p></div><aside><small>本次已评价</small><strong>{completed}/{formatCount}</strong></aside></header>
    <section className="rule-strip"><b>固定规则</b><span>招牌唯一置顶</span><span>正文 3–8 个</span><span>同类模块可重复</span><span>海报与轮播满铺</span><span>1px 白线分隔</span><span>无额外标题或收藏按钮</span></section>
    <div className="format-groups">{groups.map(group => <section className="format-group" key={group.type}><header><h2>{group.label}</h2><small>{group.variants.length} 种格式</small></header><div className="format-grid">{group.variants.map(([variant, format]) => {
      const key = group.type + "." + variant;
      const items = format.slots.map((_: unknown, index: number) => ({ id: key + "-" + index, src: group.type === "poster" ? "/validation/full-page/poster-" + (index%3+1) + ".jpg" : group.type === "navigation" || group.type === "showcase" ? "/validation/full-page/nav-" + (index%5+1) + ".jpg" : "/validation/full-page/carousel.jpg", name: ["清透罗纹短袖","轻盈通勤上衣","低饱和新色","夏日基础款","日常搭配"][index%5], price: group.type === "showcase" ? String([129,169,109,199][index%4]) : undefined }));
      return <article className="format-card" key={key}><div className="format-preview"><StoreModule id={key} type={group.type} variant={variant} title={group.type === "shopSign" ? "日常衣橱" : "本周新品已上架，轻盈面料适合通勤与日常搭配。"} items={items}/></div><div className="format-meta"><div><strong>{format.label}</strong><span>{scores[key] === "clear" ? "本次已通过" : scores[key] === "issue" ? "本次需修正" : "本次未评价"}</span></div><div className="format-actions"><button className={scores[key] === "clear" ? "chosen good" : ""} onClick={() => setScores(old => ({...old,[key]:"clear"}))}><Check size={12}/>正确</button><button className={scores[key] === "issue" ? "chosen issue" : ""} onClick={() => setScores(old => ({...old,[key]:"issue"}))}>有问题</button></div></div></article>;
    })}</div></section>)}</div>
    <section className="format-group" aria-label="异常状态检查"><header><h2>异常状态检查</h2><small>模拟素材，不计入22种格式评价</small></header><div className="format-grid">
      {[{id:"missing-price",label:"未填写价格",src:"/validation/full-page/nav-1.jpg"},{id:"missing-image",label:"图片尚未就绪"},{id:"preserved-risk",label:"无法安全裁切",src:"/validation/full-page/poster-1.jpg",preserveWhole:true,state:"risk" as const},{id:"rejected-image",label:"质检未通过",src:"/validation/full-page/nav-1.jpg",state:"reject" as const},{id:"restored-risk",label:"恢复旧版本后待确认",src:"/validation/full-page/poster-1.jpg",preserveWhole:true,state:"risk" as const}].map(item => <article className="format-card" key={item.id}><div className="format-preview"><StoreModule id={"state-" + item.id} type="showcase" variant="single" items={[{...item,name:"状态检查商品"}]}/></div><div className="format-meta"><strong>{item.label}</strong></div></article>)}
    </div></section>
    <footer className="formats-summary"><div><strong>{conclusion}</strong><span>{notice || "复验记录保存在本浏览器，不影响真实任务质量状态"}</span></div><button onClick={copyResult}><Copy size={14}/>复制验收结果</button></footer>
  </main>;
}

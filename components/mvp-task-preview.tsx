"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { Check, ImageUp, LoaderCircle, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import StoreModule from "./store-module";
import { canSelectPlan } from "@/lib/mvp-contract";
import type { MvpTask } from "@/lib/mvp-contract";
import { storeFormatRegistry, type StoreFormatType } from "@/lib/store-formats";

const serviceUrl = process.env.NEXT_PUBLIC_MVP_SERVICE_URL || "/mvp-service";
type Props = { task: MvpTask; onUpdate: (task: MvpTask) => void; onNotice: (message: string) => void };

export default function MvpTaskPreview({ task, onUpdate, onNotice }: Props) {
  const [activeId, setActiveId] = useState(task.plans[0]?.id ?? "");
  const [copy, setCopy] = useState<Record<string, string>>({});
  const [reviewAsset,setReviewAsset] = useState<string>();
  const [busyAsset, setBusyAsset] = useState<string>();
  const plan = task.plans.find((item) => item.id === activeId) ?? task.plans[0];
  useEffect(() => { if (!task.plans.some((item) => item.id === activeId) && task.plans[0]) setActiveId(task.plans[0].id); }, [activeId, task.plans]);

  async function accept(response: Response) {
    const value = await response.json() as MvpTask | { error: string };
    if (!response.ok || !("id" in value)) { onNotice(("error" in value ? value.error : undefined) ?? "操作失败"); return; }
    onUpdate(value); return value;
  }
  async function request(path: string, method = "POST", payload: unknown = { revision: task.revision }) {
    return accept(await fetch(`${serviceUrl}${path}`, { method, headers: { "Content-Type": "application/json", "If-Match": String(task.revision) }, body: JSON.stringify(payload) }));
  }
  async function replace(assetId: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    setBusyAsset(assetId); const form = new FormData(); form.append("image", file);
    try { await accept(await fetch(`${serviceUrl}/tasks/${task.id}/assets/${assetId}/replace`, { method: "POST", headers: { "If-Match": String(task.revision) }, body: form })); } finally { setBusyAsset(undefined); }
  }
  if (!plan) return <div className="empty-result"><LoaderCircle className="spin"/><strong>{task.currentStep ?? "正在准备方案"}</strong><span>素材完成后会逐张出现在这里</span></div>;

  const modules = [plan.shopSign, ...plan.modules];
  const assets = [...new Set(modules.flatMap((module) => module.assetIds))].map((id) => task.assets.find((asset) => asset.id === id)).filter(Boolean) as MvpTask["assets"];
  const selectable = canSelectPlan(task, plan.id);
  const pricedCalls = task.modelCalls.filter((call) => call.estimatedCost !== undefined); const estimatedCost = pricedCalls.reduce((sum, call) => sum + (call.estimatedCost ?? 0), 0);

  return <div className="result-shell">
    <nav className="plan-tabs">{task.plans.map((item) => <button key={item.id} className={item.id === plan.id ? "active" : ""} onClick={() => setActiveId(item.id)}><small>{item.strategy === "atmosphere" ? "01" : item.strategy === "quick" ? "02" : "03"}</small><strong>{item.name}</strong></button>)}</nav>
    <div className="preview-columns">
      <section className="phone-preview"><div className="store-top"><span>9:41</span><span>微购店铺预览</span></div>{modules.map((module) => <StoreModule key={module.id} id={module.id} type={module.type as StoreFormatType} variant={module.variant} title={copy[module.id] ?? module.title} items={module.assetIds.map((assetId) => {
        const asset = task.assets.find((item) => item.id === assetId);
        const product = task.products.find((item) => item.id === asset?.productId);
        return { id: assetId, src: asset?.currentVersion ? `${serviceUrl}/assets/${asset.id}/${asset.currentVersion}` : undefined, name: product?.name ?? "商品", price: product?.price, preserveWhole: asset?.adaptation?.mode === "preserved", state: asset?.verdict === "reject" ? "reject" : asset?.verdict === "risk" && !asset.approvedRisk ? "risk" : undefined };
      })}/>)}</section>
      <aside className="plan-note"><span>方案逻辑</span><h3>{plan.name}</h3><p>{plan.rationale}</p>
        <ol>{modules.map((module, index) => <li key={module.id}><b>{String(index + 1).padStart(2, "0")}</b><span>{storeFormatRegistry[module.type as StoreFormatType].label}</span>{!module.assetIds.length && <input value={copy[module.id] ?? module.title ?? ""} onChange={(event) => setCopy((old) => ({ ...old, [module.id]: event.target.value }))}/>}</li>)}</ol>
        {Object.keys(copy).length > 0 && <button className="minor-action" onClick={() => request(`/tasks/${task.id}/result`, "PATCH", { revision: task.revision, copy })}>保存文案</button>}
        <div className="usage-summary"><span><b>{task.modelCalls.length}</b> 次模型调用</span><span><b>{task.modelCalls.length > 0 && pricedCalls.length === task.modelCalls.length ? `约 ¥${estimatedCost.toFixed(2)}` : "费用待核算"}</b>{task.modelCalls.length ? pricedCalls.length === task.modelCalls.length ? " · 根据本机价格表" : " · 等待完整价格表" : " · 尚未调用模型"}</span></div>
        <div className="asset-review"><strong>素材检查</strong>{assets.map((asset, index) => <article key={asset.id}><span><b>素材 {index + 1} · {asset.ratio}</b><small>{asset.error ?? (asset.verdict === "pass" ? "检查通过" : "等待检查")}</small></span><em className={`verdict-${asset.verdict}`}>{asset.approvedRisk ? "已放行" : asset.manuallyRejected ? "人工不合格" : asset.verdict === "pass" ? "通过" : asset.verdict === "risk" ? "有风险" : asset.verdict === "reject" ? "不通过" : "处理中"}</em><div className="asset-buttons"><button onClick={()=>setReviewAsset(reviewAsset===asset.id?undefined:asset.id)}>原图对照</button>{asset.verdict === "risk" && !asset.approvedRisk && <button onClick={() => request(`/tasks/${task.id}/assets/${asset.id}/approve`)}>放行</button>}{asset.verdict !== "pending" && !asset.manuallyRejected && <button onClick={() => request(`/tasks/${task.id}/assets/${asset.id}/reject`)}>不合格</button>}{asset.verdict !== "pending" && asset.route !== "original" && <button disabled={busyAsset === asset.id} onClick={async () => { setBusyAsset(asset.id); try { await request(`/tasks/${task.id}/assets/${asset.id}/regenerate`); } finally { setBusyAsset(undefined); } }}><Sparkles size={10}/>重生成</button>}<label><ImageUp size={10}/>换图<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => replace(asset.id, event)}/></label>{asset.previousVersion && <button onClick={() => request(`/tasks/${task.id}/assets/${asset.id}/restore`)}><RotateCcw size={10}/>恢复</button>}</div>{reviewAsset===asset.id && <div className="asset-source-comparison">{task.products.find(p=>p.id===asset.productId)?.images.map((name,index)=><figure key={name}><img src={`${serviceUrl}/tasks/${task.id}/sources/${encodeURIComponent(name)}`} alt={`原图角度${index+1}`}/><figcaption>原图角度 {index+1}</figcaption></figure>)}{asset.currentVersion>0&&<figure><img src={`${serviceUrl}/assets/${asset.id}/${asset.currentVersion}`} alt="当前结果"/><figcaption>当前结果 · {asset.adaptation?.reason ?? asset.error ?? "检查商品身份与构图"}</figcaption></figure>}</div>}</article>)}</div>
        <button className="select-plan" disabled={!selectable} onClick={() => request(`/tasks/${task.id}/result`, "PATCH", { revision: task.revision, selectedPlanId: plan.id })}>{task.selectedPlanId === plan.id ? <><Check size={15}/>已选择此方案</> : selectable ? "选择此方案" : <><TriangleAlert size={15}/>处理风险后可选择</>}</button>
        <button className="minor-action" onClick={()=>request(`/tasks/${task.id}/review`,"POST",{revision:task.revision,verdict:"decline"})}>本任务暂无愿意采用的方案</button>
        <p>{task.adoptionReviews?.at(-1)?.verdict === "decline" ? "已记录不采用评价" : "采用评价与素材检查分别记录"}</p>
      </aside>
    </div>
  </div>;
}

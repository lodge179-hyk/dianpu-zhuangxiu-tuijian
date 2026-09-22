"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";

import type { summarizeTasks } from "../../server/metrics";
type Metrics = ReturnType<typeof summarizeTasks>;

const serviceUrl = process.env.NEXT_PUBLIC_MVP_SERVICE_URL || "/mvp-service";
const percent = (value: number | null) => value === null ? "暂无" : `${(value * 100).toFixed(1)}%`;
const duration = (value?: number) => value === undefined ? "暂无" : value >= 60_000 ? `${(value / 60_000).toFixed(1)} 分钟` : `${(value / 1000).toFixed(1)} 秒`;

export default function MetricsPage() {
  const [metrics, setMetrics] = useState<Metrics>(); const [batchId,setBatchId] = useState(""); const [error, setError] = useState("");
  const load = useCallback(async () => { try { setError(""); const response = await fetch(`${serviceUrl}/metrics${batchId ? `?batchId=${encodeURIComponent(batchId)}` : ""}`, { cache: "no-store" }); const value = await response.json() as Metrics | { error: string }; if (!response.ok || !("tasks" in value)) throw new Error("error" in value ? value.error : "统计读取失败"); setMetrics(value); } catch (reason) { setError(reason instanceof Error ? reason.message : "统计读取失败"); } }, [batchId]);
  useEffect(() => { void load(); }, [load]);
  return <main className="metrics-page"><header><a href="/"><ArrowLeft size={16}/>返回任务</a><div><span>封闭测试仪表盘</span><h1>MVP 验收统计</h1><p>按独立批次记录首次结果和人工评价；历史调试任务不进入新的测试批次。</p></div><button onClick={() => void load()}><RefreshCw size={15}/>刷新</button></header>
    {error ? <section className="metrics-empty">{error}</section> : !metrics ? <section className="metrics-empty">正在读取本地记录…</section> : <>
      <section className="usage-panel"><label>测试批次 <select value={batchId || metrics.scope.batchId || ""} onChange={event=>setBatchId(event.target.value)}>{metrics.scope.batches.map(id=><option key={id} value={id}>{id}</option>)}</select></label><span>{metrics.scope.legacy ? "历史记录：缺失数据为未知，不作为新测试结论" : metrics.scope.purposes.includes("technical") ? "技术稳定性测试，混合样本不代表跨品类商业验收" : "独立基线测试"}</span></section><section className="metrics-grid">
        <article><small>已启动任务</small><strong>{metrics.tasks.total}</strong><span>{metrics.tasks.terminal} 个首轮处理已结束</span></article>
        <article><small>产生采用方案</small><strong>{metrics.tasks.adopted}/{metrics.tasks.total}</strong><span>采用率 {percent(metrics.tasks.adoptionRate)}</span></article>
        <article><small>平均生成耗时</small><strong>{duration(metrics.tasks.averageDurationMs)}</strong><span>入队至首次处理结束（含暂停）；旧记录缺失不推算</span></article>
        <article><small>测试品类覆盖</small><strong>{metrics.tasks.categoryCount ?? 0}</strong><span>{(metrics.tasks.categories ?? []).join("、") || "创建任务时尚未填写"}</span></article>
        <article><small>结构合法率</small><strong>{percent(metrics.tasks.structureRate ?? 0)}</strong><span>{metrics.tasks.structurallyValid}/{metrics.tasks.planned} 个有输出任务；{metrics.tasks.noOutput} 个无输出</span></article>
        <article><small>AI 素材首轮通过率</small><strong>{percent(metrics.quality.firstPassRate)}</strong><span>{metrics.quality.firstPass}/{metrics.quality.aiAssets} 张 AI 素材；{metrics.quality.unknownFirstVerdict} 张首次结论未知</span></article>
        <article><small>自动重试率</small><strong>{percent(metrics.quality.retryRate)}</strong><span>{metrics.quality.retried} 张发生重试</span></article>
        <article><small>人工不合格率</small><strong>{percent(metrics.quality.manualRejectionRate)}</strong><span>{metrics.quality.manuallyRejected} 张曾被人工否决，修复后仍保留记录</span></article>
      </section>
      <section className="usage-panel"><div><span>模型调用</span><b>{metrics.usage.calls} 次</b></div><div><span>输入 / 输出 Token</span><b>{metrics.usage.inputTokens} / {metrics.usage.outputTokens}</b></div><div><span>人工重生成</span><b>{metrics.quality.manualRegenerations} 次</b></div><div><span>估算费用</span><b>{metrics.usage.pricedCalls === metrics.usage.calls && metrics.usage.calls > 0 ? `¥${metrics.usage.estimatedCost.toFixed(2)}` : "价格表待补全"}</b></div></section>
      <section className="usage-panel"><div><span>人工评价</span><b>采用 {metrics.tasks.adopted} · 不采用 {metrics.tasks.declined} · 待评 {metrics.tasks.pendingReview}</b></div><div><span>原图裁切首轮通过</span><b>{metrics.quality.localFirstPass}/{metrics.quality.localAssets}；来源未知 {metrics.quality.unknownRoute}</b></div><div><span>请求状态</span><b>成功 {metrics.usage.successful} · 失败 {metrics.usage.failed} · 未知/进行中 {metrics.usage.unknown}</b></div><div><span>未知用量 / 费用</span><b>{metrics.usage.unknownTokenCalls} / {metrics.usage.unknownCostCalls} 次</b></div></section><p className="metrics-gate">本轮为现有素材技术测试：结构合法率目标100%，采用目标8/10；混合难例单列解释。速度与费用先测量，不预设达标阈值。</p>
    </>}
  </main>;
}

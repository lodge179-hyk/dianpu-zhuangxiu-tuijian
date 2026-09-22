import type { MvpTask } from "../lib/mvp-contract";

type Call = MvpTask["modelCalls"][number];
export type ModelCallObserver = (call: Call) => Promise<void>;
type Options = {
  model: string;
  requestType: Call["requestType"];
  endpoint: string;
  body: unknown;
  timeoutMs: number;
  observe?: ModelCallObserver;
  ratio?: string;
  retryReason?: string;
};

export function providerError(message: string) {
  return Object.assign(new Error(message), { fatalProvider: /overdue balance|insufficient balance|欠费|余额不足/i.test(message) });
}

/** Persist dispatch before networking, then settle that same ID once, even on errors. */
export async function modelRequest<T>(options: Options, parse: (payload: any) => T | Promise<T>): Promise<T> {
  const call: Call = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), model: options.model, requestType: options.requestType, durationMs: 0, status: "pending", ratio: options.ratio, retryReason: options.retryReason };
  await options.observe?.(call);
  const started = Date.now();
  let received = false;
  try {
    const response = await fetch(options.endpoint, { method: "POST", signal: AbortSignal.timeout(options.timeoutMs), headers: { Authorization: `Bearer ${process.env.ARK_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(options.body) });
    received = true;
    const raw = await response.text();
    if (response.status === 413 || /request entity too large|payload too large/i.test(raw)) throw providerError("模型服务拒绝请求：图片数据过大（HTTP " + response.status + "），请减少或压缩分析图片");
    let payload: { usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string } };
    try { payload = JSON.parse(raw); } catch {
      throw providerError("模型服务返回非JSON响应（HTTP " + response.status + "），请求未能正常完成");
    }
    call.inputTokens = payload.usage?.input_tokens;
    call.outputTokens = payload.usage?.output_tokens;
    if (!response.ok) throw providerError(payload.error?.message ?? `模型服务 HTTP ${response.status}`);
    const result = await parse(payload);
    call.status = "success";
    return result;
  } catch (error) {
    call.status = received ? "failed" : "unknown";
    call.error = error instanceof Error ? error.message : "模型请求异常";
    throw error;
  } finally {
    call.durationMs = Date.now() - started;
    await options.observe?.(call);
  }
}

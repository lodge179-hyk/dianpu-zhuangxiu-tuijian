import { modelRequest, type ModelCallObserver } from "./model-request";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { productAnalysisSchema, type MvpTask } from "../lib/mvp-contract";
import { uploadRoot } from "./task-store";

/** Analysis copies retain the full frame; normalized boxes still map to originals. */
export async function analysisImage(bytes: Buffer) {
  for (const edge of [1600, 1280, 1024, 800]) {
    const result = await sharp(bytes).rotate().resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer();
    if (result.length <= 512 * 1024) return result;
  }
  throw new Error("商品分析图片压缩后仍过大，请使用较小图片；尚未发送模型请求");
}

export async function analyzeProducts(task: MvpTask, observe?: ModelCallObserver) {
  const fallback = task.products.map((product) => ({ productId: product.id, summary: product.name, identitySensitive: /包装|鞋|机械|印花|摩托|瓶|盒/.test(product.name), protectedFeatures: ["品类", "版型", "主色", "材质"] }));
  const key = process.env.ARK_API_KEY; const model = process.env.ARK_VISION_MODEL; const endpoint = process.env.ARK_RESPONSES_ENDPOINT;
  if (!key || !model || !endpoint) return { analyses: fallback, model: undefined, durationMs: 0, usage: undefined };
  const content: Array<{ type: string; text?: string; image_url?: string }> = [{ type: "input_text", text: "识别下列商品的关键身份特征。每件商品可能有多张不同角度参考图。按商品输入顺序返回纯JSON数组，每项字段 productId、summary、identitySensitive、protectedFeatures、views。views为每个参考角度提供{image:下方标注的文件名,confidence:0到1,box:{left,top,width,height}}；坐标相对于自动旋正后的图像归一化到0到1，box必须包围商品全部关键结构、包装文字、鞋底或机械部件，不包括与商品无关的背景。不确定则confidence小于0.85，不要猜测。包装文字、鞋底、机械结构、独特印花应判为身份敏感。" }];
  for (const product of task.products) { content.push({ type: "input_text", text: `商品 ${product.id}：${product.name}${product.isHero ? "（主推）" : ""}` }); for (const filename of product.images) { content.push({type:"input_text",text:"参考角度文件名：" + filename}); const bytes = await analysisImage(await readFile(path.join(uploadRoot, task.id, filename))); const mime = "image/jpeg"; content.push({ type: "input_image", image_url: `data:${mime};base64,${bytes.toString("base64")}` }); } }
  const started = Date.now();
  return modelRequest({ model, requestType: "analysis", endpoint, timeoutMs: 120000, observe, body: { model, store: false, max_output_tokens: 6000, reasoning: { effort: "minimal" }, input: [{ role: "user", content }] } }, (payload) => {
  const text = payload.output?.flatMap((item: { content?: Array<{ type?: string; text?: string }> }) => item.content ?? []).find((item: { type?: string; text?: string }) => item.type === "output_text")?.text ?? ""; const match = text.match(/\[[\s\S]*\]/); if (!match) throw new Error("商品分析结果不是有效JSON数组"); const parsed = JSON.parse(match[0]); if (!Array.isArray(parsed) || parsed.length !== task.products.length) throw new Error("商品分析数量与输入不一致");
  if (new Set(parsed.map((item) => item.productId)).size !== task.products.length || parsed.some((item) => !task.products.some((product) => product.id === item.productId))) throw new Error("商品分析身份与输入不一致");
  const analyses = task.products.map((product, index) => { const item = parsed.find((entry) => entry.productId === product.id); return productAnalysisSchema.parse({ ...item, productId: product.id, views: Array.isArray(item.views) ? item.views.filter((view: {image?: string}) => view.image && task.products[index].images.includes(view.image)) : undefined }); }); return { analyses, model, durationMs: Date.now() - started, usage: { inputTokens: payload.usage?.input_tokens, outputTokens: payload.usage?.output_tokens } };
  });
}

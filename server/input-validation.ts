import sharp from "sharp";
import { taskSchema } from "../lib/mvp-contract";

export const uploadLimits={fileBytes:8*1024*1024,totalBytes:100*1024*1024,files:27};
export function validateInputMetadata(input: unknown) {
  if(!input||typeof input!=="object")throw new Error("缺少任务输入");
  const value=input as Record<string,unknown>;
  const parsed=taskSchema.parse({id:"input-validation",revision:0,createdAt:"",updatedAt:"",status:"draft",progress:0,brief:value.brief,visualDescription:value.visualDescription,products:value.products,styleReferences:value.styleReferences,testCategory:value.testCategory});
  if(new Set(parsed.products.map(p=>p.id)).size!==parsed.products.length)throw new Error("商品 ID 必须唯一");
  const keys=[...parsed.products.flatMap(p=>p.images),...parsed.styleReferences];
  if(new Set(keys).size!==keys.length)throw new Error("每个上传图片字段必须唯一");
  return {brief:parsed.brief,visualDescription:parsed.visualDescription,products:parsed.products,styleReferences:parsed.styleReferences,testCategory:parsed.testCategory};
}
export async function validateImageBytes(bytes: Buffer) {
  if(!bytes.length||bytes.length>uploadLimits.fileBytes)throw new Error("单张图片必须为1字节至8MB");
  try {
    const image=sharp(bytes,{limitInputPixels:64_000_000});const meta=await image.metadata();
    if(!["jpeg","png","webp"].includes(meta.format??"")||!meta.width||!meta.height||(meta.pages??1)>1)throw new Error("仅支持静态JPG、PNG、WebP图片");
    await image.stats(); // Decode pixels, not just a possibly intact header.
    return meta.format;
  } catch(error) {throw new Error("图片无法完整解码或格式/像素数量不受支持",{cause:error});}
}

import { readFile,readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { validateImageBytes,validateInputMetadata,uploadLimits } from "../server/input-validation";

export async function prepareBatch(manifestPath:string,limit=Infinity) {
  const manifest=JSON.parse(await readFile(manifestPath,"utf8"));
  if(!Array.isArray(manifest.tasks)||!manifest.tasks.length)throw Error("批量清单没有任务");
  if(!(limit===Infinity||Number.isInteger(limit)&&limit>0))throw Error("limit必须为正整数");
  const root=path.resolve(manifest.productRoot??path.dirname(manifestPath));
  const folders=(await readdir(root,{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name);
  const prepared=[];
  for(const [index,definition] of manifest.tasks.slice(0,limit).entries()) {
    if(!Array.isArray(definition.products))throw Error("任务缺少商品列表");
    const files:{key:string;filename:string;bytes:Buffer;mime:string;hash:string}[]=[];
    const products=[];
    for(const [i,product] of definition.products.entries()) {
      const matches=product.folder?folders.filter(name=>name===product.folder):product.match?folders.filter(name=>name.includes(product.match)):[];
      if(!product.directory&&matches.length!==1)throw Error(`商品目录必须唯一匹配：${product.folder??product.match}，实际${matches.length}个`);
      const directory=product.directory?path.resolve(path.dirname(manifestPath),product.directory):path.join(root,matches[0]);
      const names=product.files??(await readdir(directory)).filter(name=>/\.(jpe?g|png|webp)$/i.test(name)).sort().slice(0,3);
      const images=[];
      for(const [j,filename] of names.entries()) {
        if(path.basename(filename)!==filename)throw Error("图片名不能包含目录");
        const bytes=await readFile(path.join(directory,filename));const format=await validateImageBytes(bytes);
        const key=`p${i}-${j}`;images.push(key);files.push({key,filename,bytes,mime:`image/${format}`,hash:createHash("sha256").update(bytes).digest("hex")});
      }
      products.push({id:`p${i+1}`,name:product.name??path.basename(directory),price:product.price===undefined?undefined:String(product.price),isHero:i===(definition.heroIndex??0),images});
    }
    if(files.reduce((sum,file)=>sum+file.bytes.length,0)>uploadLimits.totalBytes)throw Error("任务图片总量超过100MB");
    const metadata=validateInputMetadata({brief:definition.brief,visualDescription:definition.visualDescription,products,styleReferences:[],testCategory:definition.category});
    const fingerprint=createHash("sha256").update(JSON.stringify({metadata,files:files.map(({key,filename,hash})=>({key,filename,hash}))})).digest("hex");
    prepared.push({index,metadata,files,fingerprint});
  }
  return prepared;
}

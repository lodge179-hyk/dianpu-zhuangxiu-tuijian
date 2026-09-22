import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { layoutRequest } from './whole-page.mjs';
import Busboy from 'busboy';
import sharp from 'sharp';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const output=path.join(root,'output/decoration-mvp/web-runs');
const port=Number(process.env.DECORATION_PORT||5180);
const origin=`http://127.0.0.1:${port}`;
let busy=false;
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
async function upload(req){
 return new Promise((resolve,reject)=>{
  const files={},fields={};let failure;let total=0;
  const parser=Busboy({headers:req.headers,limits:{files:4,fileSize:12*1024*1024,fields:16,fieldSize:2000,parts:20}});
  parser.on('file',(name,stream)=>{const chunks=[];if(!/^(product[0-2]|avatar|scene)$/.test(name)||files[name])failure=new Error('图片字段无效或重复');files[name]=null;
   stream.on('data',c=>{total+=c.length;if(total>48*1024*1024)failure=new Error('图片总量不能超过48MB');if(!failure)chunks.push(c);});
   stream.on('limit',()=>failure=new Error('单张图片不能超过12MB'));
   stream.on('end',()=>files[name]=Buffer.concat(chunks));
  });
  parser.on('field',(name,value,info)=>{if(info.valueTruncated)failure=new Error('文字过长');fields[name]=value;});
  for(const event of ['filesLimit','fieldsLimit','partsLimit'])parser.on(event,()=>failure=new Error('上传项目过多'));
  parser.on('error',reject);req.on('aborted',()=>reject(new Error('上传已取消')));
  parser.on('close',()=>failure?reject(failure):resolve({files,fields}));req.pipe(parser);
 });
}
const server=http.createServer(async(req,res)=>{
 try{
  if(!new Set([`127.0.0.1:${port}`,`localhost:${port}`]).has(req.headers.host)){json(res,403,{error:'请通过本机入口访问'});return;}
  const url=new URL(req.url,origin);
  if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(await readFile(path.join(here,'web.html')));return;}
  const result=url.pathname.match(/^\/results\/([a-f0-9-]{36})\/(preview\.png|scene-prompt\.txt|run\.json)$/);
  if(req.method==='GET'&&result){const data=await readFile(path.join(output,result[1],'result',result[2]));res.writeHead(200,{'Content-Type':result[2].endsWith('.png')?'image/png':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);return;}
  if(req.method==='POST'&&url.pathname==='/api/preview'){
   if(req.headers.origin!==origin&&req.headers.origin!==`http://localhost:${port}`){json(res,403,{error:'请求来源无效'});return;}
   if(busy){json(res,409,{error:'上一份预览正在处理，请稍后再试'});return;}
   busy=true;
   try{
    const {files,fields}=await upload(req);
    const nickname=(fields.nickname||'').trim();if(!nickname||nickname.length>30)throw new Error('请填写30字以内的店铺昵称');
    for(let i=0;i<3;i++){if(!files[`product${i}`]?.length)throw new Error(`请选择商品${i+1}的图片`);if(!fields[`name${i}`]?.trim())throw new Error(`请填写商品${i+1}的名称`);if(fields[`price${i}`]&&!/^\d{1,7}(\.\d{1,2})?$/.test(fields[`price${i}`]))throw new Error('价格应为正数，最多两位小数');}
    const normalized={};
    for(const [name,bytes] of Object.entries(files)){
     if(!bytes?.length)continue;
     const im=sharp(bytes,{limitInputPixels:40000000});const meta=await im.metadata();
     if(!['jpeg','png','webp'].includes(meta.format))throw new Error('仅支持JPG、PNG、WebP');
     const data=await im.rotate().png().toBuffer({resolveWithObject:true});
     if(name==='scene')throw new Error('本入口已改为整页直生成，不再接收场景图拼接');
     normalized[name]=data;
    }
    const id=randomUUID(),dir=path.join(output,id);await mkdir(dir,{recursive:true});
    for(const [name,value] of Object.entries(normalized))await writeFile(path.join(dir,`${name}.png`),value.data);
    const config={nickname,avatarPath:normalized.avatar?'avatar.png':'',avatarText:nickname.slice(0,1),style:'暖色背景，真实商品陈列',scene:'scene.png',products:[]};
    for(let i=0;i<3;i++){
     const key=`product${i}`,m=normalized[key].info,s=Math.min(m.width,m.height);
     const position=fields[`position${i}`]||'center';if(!['top','center','bottom'].includes(position))throw new Error('裁切位置无效');
     const y=position==='top'?0:position==='bottom'?m.height-s:Math.floor((m.height-s)/2);
     config.products.push({name:fields[`name${i}`].trim().slice(0,60),price:fields[`price${i}`]||'',image:`${key}.png`,crop:[Math.floor((m.width-s)/2),y,s,s]});
    }
    const layout=layoutRequest(fields,config.products,nickname);
    delete config.scene;for(const p of config.products)delete p.crop;
    config.layout={order:layout.order,columns:layout.columns,navigationCount:4};
    await writeFile(path.join(dir,'config.json'),JSON.stringify(config,null,2));
    await mkdir(path.join(dir,'result'));
    await writeFile(path.join(dir,'result','scene-prompt.txt'),layout.prompt);
    const references=[path.join(here,'fixed-header-clean.png'),path.join(root,'output/decoration-mvp/direct-whole-page-02/whole-page.png'),...config.products.map(p=>path.join(dir,p.image))];
    if(normalized.avatar)references.push(path.join(dir,'avatar.png'));
    await writeFile(path.join(dir,'result','references.json'),JSON.stringify(references,null,2));
    await writeFile(path.join(dir,'result','run.json'),JSON.stringify({status:'awaiting_whole_page_generation',generationCalls:0,layout:config.layout},null,2));
    json(res,200,{id,mode:'PrepareWholePage',preview:null,prompt:`/results/${id}/scene-prompt.txt`,directory:dir});
   }finally{busy=false;}return;
  }
  json(res,404,{error:'找不到该页面'});
 }catch(error){json(res,error.code==='ENOENT'?404:400,{error:error.message?.includes('Command failed')?'合成失败，请检查图片与裁切后重试':error.message||'处理失败'});}
});
server.listen(port,'127.0.0.1',()=>console.log(`装修预览入口 ${origin}`));

import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile,readdir,rename,copyFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import Busboy from 'busboy';
import sharp from 'sharp';
import {analyze,refineBoxes,cropProducts,generateBanner,render} from './core.mjs';
import {normalizeDesign} from './design.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
export const output=path.join(root,'output/decoration-assisted');
const port=Number(process.env.ASSISTED_PORT||5181),origin=`http://127.0.0.1:${port}`;
const required=['ARK_API_KEY','ARK_VISION_MODEL','ARK_RESPONSES_ENDPOINT','ARK_IMAGE_MODEL','ARK_IMAGE_ENDPOINT'];
const configured=()=>required.every(k=>process.env[k]);
const validId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
const dirFor=id=>path.join(output,id);
let busy=false,activeId=null;

function safeMessage(error){
  let message=error instanceof Error?error.message:'处理未完成，请重新提交。';
  if(process.env.ARK_API_KEY)message=message.split(process.env.ARK_API_KEY).join('[已隐藏]');
  if(/abort|timeout|timed out/i.test(message))return '服务响应超时。没有自动重试，避免重复计费。';
  if(/fetch failed|ECONN|ENOTFOUND/i.test(message))return '暂时无法连接生成服务。请稍后重试。';
  if(/ENOENT|EACCES|EPERM/i.test(message))return '本地结果文件暂时不可读写，请稍后重试。';
  return message.slice(0,500);
}
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
async function save(state){
  const filename=path.join(dirFor(state.id),'run.json');
  const temp=filename+'.'+randomUUID()+'.tmp';
  await writeFile(temp,JSON.stringify(state,null,2));await rename(temp,filename);
}
async function readState(id){return JSON.parse(await readFile(path.join(dirFor(id),'run.json'),'utf8'));}
async function upload(req){return new Promise((resolve,reject)=>{
  const chunks=[];let fail,seen=false;
  const parser=Busboy({headers:req.headers,limits:{files:1,fileSize:30*1024*1024,fields:1,fieldSize:600}});
  parser.on('file',(name,stream)=>{
    seen=true;if(name!=='screenshot')fail=new Error('请选择店铺截图。');
    stream.on('data',c=>{if(!fail)chunks.push(c);});
    stream.on('limit',()=>{fail=new Error('截图文件超过30MB，请压缩后上传。');chunks.length=0;});
    stream.on('error',reject);
  });
  // Older open pages may still submit the retired style field. Ignore it.
  parser.on('field',name=>{if(name!=='style')fail=new Error('上传包含未知字段，请刷新页面。');});
  parser.on('filesLimit',()=>{fail ||= new Error('每次只上传一张店铺截图。');});
  parser.on('fieldsLimit',()=>{fail ||= new Error('请刷新页面后重新上传截图。');});
  parser.on('error',reject);req.on('aborted',()=>reject(new Error('上传已中断。')));
  parser.on('close',()=>fail?reject(fail):!seen?reject(new Error('请选择截图。')):resolve(Buffer.concat(chunks)));
  req.pipe(parser);
});}
async function normalize(bytes){
  const image=sharp(bytes,{limitInputPixels:100000000});let meta;
  try{meta=await image.metadata();}catch(e){if(/pixel limit/i.test(e.message))throw new Error('截图超过1亿像素，请选择包含主要商品的一段截图。');throw new Error('无法读取图片，请使用PNG、JPG或WebP截图。');}
  if(!['png','jpeg','webp'].includes(meta.format))throw new Error('仅支持PNG、JPG、WebP截图。');
  if((meta.pages||1)>1)throw new Error('请上传静态截图。');
  const ratio=Math.min(1,Math.sqrt(30000000/(meta.width*meta.height)),2400/meta.width);
  const normalized=await image.rotate().resize({width:Math.max(1,Math.floor(meta.width*ratio)),height:Math.max(1,Math.floor(meta.height*ratio)),fit:'inside',withoutEnlargement:true}).png().toBuffer();
  return {bytes:normalized,warnings:ratio<1?['截图已自动缩小用于处理，原文件保留在本机。']:[]};
}
async function fallbackBanner(analysis,dir){
  const width=1460,height=1095,images=[];
  const design=normalizeDesign(analysis.design,analysis.products,analysis.shopName);
  for(const slot of design.hero.slots){
    const i=analysis.products.findIndex(p=>p.id===slot.productId);
    if(i<0)continue;
    const left=Math.round(slot.x*width/100),top=Math.round(slot.y*height/100);
    const w=Math.max(1,Math.min(width-left,Math.round(slot.w*width/100)));
    const h=Math.max(1,Math.min(height-top,Math.round(slot.h*height/100)));
    const input=await sharp(await readFile(path.join(dir,`product-${i}.png`))).resize(w,h,{fit:'contain',background:design.palette.background}).png().toBuffer();
    images.push({input,left,top});
  }
  await sharp({create:{width,height,channels:3,background:design.palette.background}}).composite(images).png().toFile(path.join(dir,'banner.png'));
}
async function run(state,bytes,reused){
  const dir=dirFor(state.id);let analysis,partial=false;
  const step=async(n,label)=>{state.step=n;state.stage=label;await save(state);};
  const call=async(kind,operation)=>{
    const record={kind,status:'started',startedAt:new Date().toISOString()};state.calls.push(record);await save(state);
    try{const value=await operation();record.status=value?.localization && value.localization.status!=='complete'?'completed_with_fallback':'success';return value;}
    catch(e){record.status='failed_or_unknown';record.error=safeMessage(e);throw e;}
    finally{record.finishedAt=new Date().toISOString();await save(state);}
  };
  try{
    if(reused){analysis=reused;await step(3,'沿用店铺素材与整页设计方案');}
    else{
      await step(1,'读取店名与商品，规划整页重点');
      const initial=await call('analysis',()=>analyze(bytes));
      await writeFile(path.join(dir,'analysis-initial.json'),JSON.stringify(initial,null,2));
      state.shopName=initial.shopName;state.productCount=initial.products.length;state.design=initial.design||{title:'根据商品定制',summary:initial.style};
      await step(2,'核对店铺信息，整理商品边界');
      analysis=await call('crop-localization',()=>refineBoxes(bytes,initial,{directory:dir}));
      analysis.design ||= initial.design;
      state.warnings.push(...(analysis.warnings||[]));
      await step(3,'清理截图素材，分配页面区域');state.warnings=[...new Set([...state.warnings,...await cropProducts(bytes,analysis,dir)])];
    }
    analysis.design=normalizeDesign(analysis.design,analysis.products,analysis.shopName);
    await writeFile(path.join(dir,'analysis.json'),JSON.stringify(analysis,null,2));
    await writeFile(path.join(dir,'blueprint.json'),JSON.stringify({shopName:analysis.shopName,shopIdentity:analysis.shopIdentity,design:analysis.design,products:analysis.products.map(({id,name,category})=>({id,name,category}))},null,2));
    state.shopName=analysis.shopName;state.design=analysis.design;state.productCount=analysis.products.length;state.style=analysis.style;state.canRetry=true;
    await step(4,'按整页方案生成主视觉');
    try{await call('generation',()=>generateBanner(analysis,dir,analysis.style));analysis.bannerSource='generated';}
    catch(e){
      partial=true;state.generationError=safeMessage(e);
      state.warnings.push('主海报未生成成功，当前预览使用截图中的商品原图组合；可单独重新生成海报。');
      analysis.bannerSource='source-composite';await fallbackBanner(analysis,dir);
    }
    await writeFile(path.join(dir,'analysis.json'),JSON.stringify(analysis,null,2));
    await step(5,'排版整页与分区图片');const spec=await render(analysis,dir);
    state.artifacts=spec.artifacts;
    state.hasPreview=true;state.status=partial?'partial':'complete';state.stage=partial?'整页预览已组合，主视觉使用原图替代':'整页预览已生成';state.canRetry=partial;
    state.warnings.push('采用已确认的微购样板结构；固定招牌和平台控件复用参考素材，当前为静态装修图，尚未发布到店铺。');
  }catch(e){state.status='failed';state.stage='本次未完成';state.error=safeMessage(e);}
  finally{state.warnings=[...new Set(state.warnings)];state.finishedAt=new Date().toISOString();try{await save(state);}finally{busy=false;activeId=null;}}
}
function launch(state,bytes,reused){void run(state,bytes,reused).catch(e=>console.error('任务状态保存失败：',safeMessage(e)));}
async function newState(warnings=[]){
  const id=randomUUID();await mkdir(dirFor(id),{recursive:true});
  const state={id,version:'demo-4',status:'running',stage:'准备截图',step:0,startedAt:new Date().toISOString(),calls:[],warnings,hasPreview:false,canRetry:false};
  await save(state);return state;
}
await mkdir(output,{recursive:true});
for(const id of await readdir(output)){
  if(!validId(id))continue;
  try{const s=await readState(id);if(s.status==='running'){s.status='failed';s.stage='任务已中断';s.error='服务已重启，任务没有自动重新计费。';s.finishedAt=new Date().toISOString();await save(s);}}catch{}
}
const server=http.createServer(async(req,res)=>{
  try{
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return send(res,403,{error:'请通过本机入口访问。'});
    const url=new URL(req.url,origin);
    if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(await readFile(path.join(here,'index.html')));}
    if(req.method==='GET'&&url.pathname==='/api/status')return send(res,200,{version:'demo-4',configured:configured(),busy,activeId});
    const match=url.pathname.match(/^\/runs\/([a-f0-9-]{36})\/(run\.json|analysis\.json|layout\.json|design\.json|preview\.png|banner\.png|hero-panel\.png|feature-panel\.png|catalog-panel\.png|screenshot\.png|product-[0-5]\.png)$/);
    if(req.method==='GET'&&match){
      const data=await readFile(path.join(dirFor(match[1]),match[2]));
      res.writeHead(200,{'Content-Type':match[2].endsWith('.png')?'image/png':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(url.searchParams.has('download')?{'Content-Disposition':`attachment; filename="${match[2]}"`}:{})});return res.end(data);
    }
    if(req.method==='GET'&&url.pathname==='/api/recent'){
      const items=[];for(const id of await readdir(output)){if(!validId(id))continue;try{const s=await readState(id);items.push({...s,hasPreview:s.hasPreview??s.status==='complete'});}catch{}}
      return send(res,200,items.sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).slice(0,10));
    }
    if(req.method==='POST'&&['/api/generate','/api/retry'].includes(url.pathname)){
      if(![origin,`http://localhost:${port}`].includes(req.headers.origin))return send(res,403,{error:'请求来源无效。'});
      if(!configured())return send(res,503,{error:'生成服务尚未配置完整，请联系应用维护者。'});
      if(busy)return send(res,409,{error:'上一份装修仍在生成，请稍后。',activeId});
      busy=true;let state;
      try{
        if(url.pathname==='/api/generate'){
          const raw=await upload(req),normalized=await normalize(raw);state=await newState(normalized.warnings);activeId=state.id;
          await writeFile(path.join(dirFor(state.id),'source-upload.bin'),raw);await writeFile(path.join(dirFor(state.id),'screenshot.png'),normalized.bytes);
          send(res,202,{id:state.id});launch(state,normalized.bytes);
        }else{
          const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2048)throw new Error('请求内容过长。');chunks.push(chunk);}
          const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!validId(body.id))throw new Error('预览记录无效。');
          const prior=await readState(body.id);if(!prior.canRetry)throw new Error('当前记录不需要重新生成海报。');
          const analysis=JSON.parse(await readFile(path.join(dirFor(body.id),'analysis.json'),'utf8'));
          state=await newState((prior.warnings||[]).filter(w=>!w.includes('主海报未生成成功')));state.retryOf=body.id;activeId=state.id;
          for(const file of ['screenshot.png',...analysis.products.map((_,i)=>`product-${i}.png`)])await copyFile(path.join(dirFor(body.id),file),path.join(dirFor(state.id),file));
          await save(state);send(res,202,{id:state.id});launch(state,null,analysis);
        }
      }catch(e){
        try{if(state){state.status='failed';state.stage='任务未启动';state.error=safeMessage(e);await save(state);}}finally{busy=false;activeId=null;}
        throw e;
      }return;
    }
    send(res,404,{error:'没有找到该内容。'});
  }catch(e){if(!res.headersSent)send(res,e.code==='ENOENT'?404:400,{error:safeMessage(e)});}
});
server.requestTimeout=120000;
server.listen(port,'127.0.0.1',()=>console.log(`装修 Demo ${origin}`));

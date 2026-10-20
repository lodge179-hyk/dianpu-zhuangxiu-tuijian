'use strict';
const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const visible=(id,show)=>$(id).classList.toggle('hidden',!show);
let config=null,current=null,busy=false,exporting=false,poll=null,uploadQueue=Promise.resolve(),uploadPending=0,previewKey='',restoreToken=0;
const selectedImages=[];
const storage={get:key=>{try{return localStorage.getItem(key);}catch{return null;}},set:(key,value)=>{try{localStorage.setItem(key,value);}catch{}},remove:key=>{try{localStorage.removeItem(key);}catch{}}};
async function api(url,options={}){const response=await fetch(url,options);let data;try{data=await response.json();}catch{throw Error('服务响应异常，请稍后重试。');}if(!response.ok)throw Object.assign(Error(data.error||'操作未完成'),{status:response.status});return data;}
function notice(id,message,error=false){$(id).textContent=message;$(id).classList.toggle('error',error);visible(id,!!message);}
function options(){return {modules:[...document.querySelectorAll('[name=module]:checked')].map(n=>n.value),styleId:document.querySelector('[name=style]:checked')?.value||'auto',preserveProducts:$('preserve-products').checked,shopName:$('shop-name').value.trim()};}
function updateSummary(){
 if(!config)return;
 const mode=config.studio.modes.find(m=>m.id===$('generation-mode').value),o=options();
 const style=o.styleId==='auto'?'AI 推荐':mode.styles.find(s=>s.id===o.styleId)?.name||'AI 推荐';
 $('creation-summary').textContent=`${mode.name} · ${style} · ${o.modules.length} 类模块`;
 $('fidelity-description').textContent=o.preserveProducts?'开启：保留原商品的款式、配色与结构，重新设计背景和构图。':'关闭：保留经营方向，允许设计同类新款。';
 $('plan').disabled=busy||exporting||uploadPending>0||!config.configured;
}
function renderStyles(selected='auto'){
 const mode=config.studio.modes.find(m=>m.id===$('generation-mode').value);
 const styles=[{id:'auto',name:'AI 推荐',colors:['#E8EDDC','#D4DFC6','#B0C3A1'],description:'结合商品，自动确定设计方向'},...mode.styles];
 if(!styles.some(s=>s.id===selected))selected='auto';
 $('style-options').replaceChildren();
 for(const style of styles){const label=el('label',undefined,'style-option'),radio=el('input'),swatch=el('span',undefined,'style-swatch');radio.type='radio';radio.name='style';radio.value=style.id;radio.checked=style.id===selected;radio.onchange=updateSummary;for(const color of style.colors){const part=el('i');part.style.backgroundColor=color;swatch.append(part);}label.append(radio,swatch,el('strong',style.name),el('small',style.description));$('style-options').append(label);}
 updateSummary();
}
function renderModules(selected=config.studio.defaults.modules){
 $('module-options').replaceChildren();
 for(const item of config.studio.families){const label=el('label',undefined,'module-option'),input=el('input'),copy=el('span');input.type='checkbox';input.name='module';input.value=item.id;input.checked=item.required||selected.includes(item.id);input.disabled=!!item.required;input.onchange=updateSummary;copy.append(el('strong',item.name+(item.required?' · 必备':'')),el('small',item.description));label.append(input,copy);$('module-options').append(label);}
 updateSummary();
}
function lock(value){busy=value;document.body.classList.toggle('is-busy',value);for(const field of document.querySelectorAll('#studio-form fieldset'))field.disabled=value||exporting;for(const id of ['new-project','recent-runs','download','download-png'])$(id).disabled=value||exporting;for(const n of document.querySelectorAll('.input-remove,.recovery-actions button,.batch input'))n.disabled=value||exporting;$('plan').textContent=value?'创作进行中…':current?'按当前设置生成新方案':'开始生成 ↗';updateSummary();}
function renderInputs(){
 $('input-list').replaceChildren();$('input-count').textContent=selectedImages.length+' / 6 张';
 for(const item of selectedImages){const box=el('div',undefined,'input-item'),img=el('img'),remove=el('button','×','input-remove');img.src=item.url;img.alt=item.name;remove.type='button';remove.setAttribute('aria-label','移除 '+item.name);remove.disabled=busy||exporting;remove.onclick=()=>{if(busy||exporting)return;if(item.file)URL.revokeObjectURL(item.url);selectedImages.splice(selectedImages.indexOf(item),1);renderInputs();};box.append(img,remove,el('p',item.name),el('small',`${item.width} × ${item.height}${item.file?' · '+(item.file.size/1024/1024).toFixed(1)+' MB':' · 已保存'}`));$('input-list').append(box);}
}
function clearImages(){for(const item of selectedImages)if(item.file)URL.revokeObjectURL(item.url);selectedImages.length=0;renderInputs();}
function addFiles(files){
 if(busy||exporting)return;
 const incoming=[...files];uploadPending++;updateSummary();
 uploadQueue=uploadQueue.then(async()=>{
  const errors=[];
  for(const file of incoming){
   if(selectedImages.some(i=>i.file&&i.file.name===file.name&&i.file.size===file.size&&i.file.lastModified===file.lastModified))continue;
   if(!['image/png','image/jpeg','image/webp'].includes(file.type)){errors.push(file.name+'：仅支持 JPG、PNG、WebP。');continue;}
   if(file.size>10*1024*1024){errors.push(file.name+'：单张超过 10 MB。');continue;}
   if(selectedImages.length>=6){errors.push('最多 6 张，请先移除不需要的图片。');break;}
   if(selectedImages.reduce((s,i)=>s+(i.file?.size||i.bytes||0),0)+file.size>30*1024*1024){errors.push('图片合计超过 30 MB。');continue;}
   const url=URL.createObjectURL(file),img=new Image();img.src=url;
   try{await img.decode();if(Math.min(img.naturalWidth,img.naturalHeight)<80||img.naturalWidth*img.naturalHeight>60000000)throw Error('短边需至少80 px，总像素不能超过6000万。');selectedImages.push({file,name:file.name,url,width:img.naturalWidth,height:img.naturalHeight});}
   catch(e){URL.revokeObjectURL(url);errors.push(file.name+'：'+(e.message.includes('80')?e.message:'无法读取，请换一张完整图片。'));}
  }
  renderInputs();notice('upload-errors',errors.join(' '),true);
 }).finally(()=>{uploadPending--;updateSummary();});
}
$('screenshot').onchange=e=>{addFiles(e.target.files);e.target.value='';};
for(const name of ['dragenter','dragover'])$('drop-zone').addEventListener(name,e=>{e.preventDefault();if(!busy)$('drop-zone').classList.add('dragging');});
for(const name of ['dragleave','drop'])$('drop-zone').addEventListener(name,e=>{e.preventDefault();$('drop-zone').classList.remove('dragging');if(name==='drop')addFiles(e.dataTransfer.files);});
document.addEventListener('paste',e=>{if(e.target.matches('input[type=text],textarea,[contenteditable]'))return;const files=e.clipboardData?.files;if(files?.length){e.preventDefault();addFiles(files);}});
$('generation-mode').onchange=()=>renderStyles();$('preserve-products').onchange=updateSummary;$('shop-name').oninput=updateSummary;
$('recommended-modules').onclick=()=>{if(config)renderModules();};
const fileData=file=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('图片读取失败'));r.readAsDataURL(file);});
async function inputData(item){if(item.file)return fileData(item.file);const response=await fetch(item.url);if(!response.ok)throw Error('已保存的商品原图不可用，请重新上传。');return fileData(await response.blob());}
$('studio-form').onsubmit=async e=>{
 e.preventDefault();if(busy||exporting||uploadPending)return;
 notice('form-error','');if(!selectedImages.length){notice('form-error','请先上传至少一张商品图片。',true);notice('upload-errors','请先上传至少一张商品图片。',true);$('screenshot').focus();return;}
 const chosen=options();if(!chosen.modules.some(m=>['carousel','poster','showcase'].includes(m))){notice('form-error','至少选择一种图片展示模块：轮播与横幅、主题海报或商品橱窗。',true);return;}
 const generationMode=$('generation-mode').value;lock(true);notice('form-error','正在上传商品并创建方案…');
 try{const images=await Promise.all(selectedImages.map(async item=>({name:item.name,data:await inputData(item)})));const state=await api('/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({images,generationMode,options:chosen})});notice('form-error','');previewKey='';show(state);$('result-title').scrollIntoView({block:'nearest',behavior:'smooth'});await recentRuns();}
 catch(error){lock(false);notice('form-error',error.message,true);}
};
function fitPreview(){if($('preview-panel').classList.contains('hidden'))return;const width=Math.min(483,$('preview-canvas').clientWidth),scale=width/483;const height=Math.ceil((current?.layout?.height||0)*scale);$('preview-stage').style.width=width+'px';$('preview-stage').style.height=height+'px';$('frame').style.transform=`scale(${scale})`;}
new ResizeObserver(fitPreview).observe($('preview-canvas'));$('frame').onload=fitPreview;
function status(text,error=false){visible('status-card',!!text);$('status-card').classList.toggle('error',error);$('status').textContent=error?'本次创作尚未完成':text;visible('error-details',error);$('error-message').textContent=error?text:'';}
function recovery(label,url,body){const b=el('button',label,'primary');b.onclick=async()=>{if(busy||exporting)return;lock(true);try{show(await api(url,{method:'POST',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})}));}catch(e){lock(false);status(e.message,true);}};$('recovery').append(b);return b;}
function show(state){
 current=state;clearTimeout(poll);storage.set('store-planning-run',state.id);history.replaceState(null,'','?run='+state.id);
 const pending=['planning','generating'].includes(state.status),total=state.plan?.assets.length||0,filled=state.plan?.assets.filter(a=>state.filledAssets?.includes(a.id)).length||0,complete=state.status==='ready'&&total>0&&filled===total&&!state.generationError;
 const studio=state.visualProfile?.studio||state.plan?.studio;
 visible('empty-preview',false);visible('run-info',true);$('run-info').textContent=studio?`${config.studio.modes.find(m=>m.id===studio.mode)?.name||studio.mode} · ${studio.style.name} · ${studio.options.preserveProducts?'商品保真':'创意示意'}${state.plan?' · '+state.plan.modules.length+' 个模块':''}`:'已保存的历史方案 · 保留原有设计规则';
 $('result-title').textContent=state.plan?.shop.name||'正在创作你的店铺';$('result-badge').textContent=complete?'已完成':pending?'创作中':state.status==='needs-input'?'需要补图':'待继续';
 visible('progress',true);const stage=complete?3:['generating','cropping','generation-failed'].includes(state.workflow?.stage)?2:['planning-content','designing','selecting-style','planned'].includes(state.workflow?.stage)?1:0;
 for(const n of document.querySelectorAll('[data-stage]')){n.classList.toggle('active',Number(n.dataset.stage)===stage);n.classList.toggle('done',Number(n.dataset.stage)<stage);}
 $('progress-message').textContent=complete?'整店已组装，可以浏览并下载。':state.workflow?.label||'正在准备商品资料…';$('asset-progress').textContent=total?`素材完成 ${filled} / ${total}${state.batches?.length?' · 共 '+state.batches.length+' 批':''}`:'规划阶段会确定章节、构图与素材数量。';
 $('recovery').replaceChildren();$('recovery-note').textContent='';status('');lock(pending);
 if(state.status==='failed'){status(state.error||'创作未完成，已保存现有资料。',true);if(state.canResumeResearch)recovery('从未完成步骤继续','/api/runs/'+state.id+'/resume');$('recovery-note').textContent='继续使用本任务保存的设置。若要改风格或模块，请在左侧生成新方案。';}
 if(state.status==='needs-input'){status(state.workflow?.label||'请补充更清楚的商品图片。',true);$('recovery-note').textContent='调整左侧图片后，再生成新方案。';}
 if(state.status==='ready'&&total>filled){if(state.generationError)status(state.generationError,true);else status('已保留完成的素材，可以继续剩余部分。');recovery('继续未完成素材','/api/runs/'+state.id+'/generate',{regenerate:false});$('recovery-note').textContent='优先复用已保存的总图；尚未生成的部分会继续调用模型。';if(state.generationFailure&&state.generationFailure.kind!=='generation'){recovery('重新生成未完成批次','/api/runs/'+state.id+'/generate',{regenerate:true}).className='';$('recovery-note').textContent+=' 原总图无法处理时可重新生成，会再次计费；已完成批次保留。';}}
 const preview=!!state.preview&&!!state.layout&&filled>0;visible('preview-panel',preview);
 if(preview){$('frame').style.height=Math.ceil(state.layout.height)+'px';const key=state.id+':'+filled+':'+JSON.stringify(state.generatedSheets||{})+':'+JSON.stringify(state.importedBatches||[]);if(key!==previewKey){previewKey=key;$('frame').src=state.preview+'?v='+encodeURIComponent(key);}$('open-preview').href=state.preview;requestAnimationFrame(fitPreview);}
 visible('download-actions',complete);renderBatches(state,complete);if(pending)poll=setTimeout(()=>refresh(state.id),2200);
}
function renderBatches(state,complete){
 const warnings=Object.values(state.cropReports||{}).some(r=>r.crops?.some(c=>c.framingReviewRequired));visible('material-details',!!state.plan&&(!complete||warnings));$('batches').replaceChildren();
 if(!state.plan)return;
 for(const [index,batch] of (state.batches||[]).entries()){
  const done=batch.rows.flat().filter(id=>state.filledAssets?.includes(id)).length,framing=state.cropReports?.[batch.id]?.crops?.filter(c=>c.framingReviewRequired)||[];if(done===batch.panelCount&&!framing.length)continue;
  const box=el('div',undefined,'batch');box.append(el('h3',`素材组 ${index+1} · ${done}/${batch.panelCount}`));if(framing.length)box.append(el('p','请核对主体是否完整，部分图片需要检查裁剪。'));
  const upload=el('input');upload.type='file';upload.accept='image/png,image/jpeg,image/webp';upload.disabled=busy;upload.setAttribute('aria-label','补传第'+(index+1)+'组完整总图');box.append(el('p','已有完整总图可手动补传；保留分隔带，最大30 MB。'),upload);
  upload.onchange=async()=>{const f=upload.files[0];if(!f||busy)return;if(f.size>30*1024*1024){status('总图超过30 MB。',true);return;}lock(true);try{previewKey='';show(await api(`/api/runs/${state.id}/batches/${batch.id}`,{method:'POST',headers:{'Content-Type':f.type},body:f}));}catch(e){lock(false);status(e.message,true);}};
  const attempt=state.generatedSheets?.[batch.id];if(attempt){const link=el('a','查看已保存的原始总图 ↗');link.href=`/runs/${state.id}/${batch.id}-attempt-${attempt}-source.png`;link.target='_blank';link.rel='noopener';box.append(link);}
  $('batches').append(box);
 }
}
async function refresh(id){try{const state=await api('/api/runs/'+id);if(current?.id===id)show(state);}catch(e){if(current?.id!==id)return;if(!e.status||e.status>=500){status('连接暂时中断，正在重新连接；没有重发生成请求。',true);poll=setTimeout(()=>refresh(id),5000);}else{lock(false);status(e.message,true);}}}
async function restoreRun(id){
 if(busy||exporting||uploadPending)return;
 const token=++restoreToken;clearTimeout(poll);lock(true);
 try{const state=await api('/api/runs/'+id);if(token!==restoreToken)return;clearImages();const o=state.visualProfile?.studio?.options||config.studio.defaults;$('generation-mode').value=config.studio.modes.some(m=>m.id===state.generationMode)?state.generationMode:'general';$('shop-name').value=o.shopName||'';$('preserve-products').checked=!!o.preserveProducts;renderStyles(o.styleId);renderModules(o.modules);for(const input of state.inputs||[])selectedImages.push({...input,url:`/runs/${state.id}/${input.file}`});renderInputs();previewKey='';show(state);}
 catch(e){if(token!==restoreToken)return;if(!e.status||e.status>=500){current={id};lock(true);status('连接暂时中断，正在重新连接；没有重发生成请求。',true);poll=setTimeout(()=>{if(token===restoreToken){busy=false;restoreRun(id);}},5000);}else{lock(false);status(e.message,true);}}
}
async function recentRuns(){try{const runs=await api('/api/runs');$('recent-runs').replaceChildren(el('option','最近作品'));$('recent-runs').firstChild.value='';for(const run of runs){const item=el('option',`${run.name} · ${new Date(run.createdAt).toLocaleDateString('zh-CN')}`);item.value=run.id;$('recent-runs').append(item);}}catch{/* The current task remains usable if history is unavailable. */}}
$('recent-runs').onchange=e=>{if(e.target.value)restoreRun(e.target.value);};
$('new-project').onclick=()=>{if(!config||busy||exporting||uploadPending)return;++restoreToken;clearTimeout(poll);current=null;previewKey='';clearImages();storage.remove('store-planning-run');history.replaceState(null,'','/');$('generation-mode').value='general';$('shop-name').value='';$('preserve-products').checked=false;renderStyles();renderModules();for(const id of ['progress','run-info','preview-panel','download-actions','material-details'])visible(id,false);visible('empty-preview',true);$('result-title').textContent='设计预览';$('result-badge').textContent='等待创作';$('download-status').textContent='';status('');notice('form-error','');notice('upload-errors','');lock(false);$('screenshot').focus();};
async function download(kind){if(busy||exporting||!current)return;exporting=true;lock(false);$('download-status').textContent='正在准备下载…';try{const result=await api(`/api/runs/${current.id}/download/${kind}`,{method:'POST'});const link=el('a');link.href=result.url;link.download='';document.body.append(link);link.click();link.remove();$('download-status').textContent=kind==='shop.png'?'长图已开始下载。':'素材包已开始下载。解压后按模块说明使用。';}catch(e){$('download-status').textContent=e.message+(kind==='shop.png'?' 你仍可单独下载素材包。':'');}finally{exporting=false;lock(false);}}
$('download').onclick=()=>download('materials.zip');$('download-png').onclick=()=>download('shop.png');
async function boot(){
 try{config=await api('/api/config');if(!config.studio)throw Error('页面已更新，服务仍是旧版本，请重启创作服务。');$('generation-mode').replaceChildren();for(const mode of config.studio.modes){const option=el('option',mode.name);option.value=mode.id;$('generation-mode').append(option);}$('generation-mode').disabled=false;renderStyles();renderModules();if(!config.configured)notice('config-notice','创作服务尚未配置完整。你可以准备图片与设计选项，配置完成后刷新再生成。');await recentRuns();const id=new URLSearchParams(location.search).get('run')||storage.get('store-planning-run');if(id&&/^[a-f0-9-]{36}$/.test(id))await restoreRun(id);else lock(false);}
 catch(e){notice('config-notice',e.message||'无法连接创作服务，请刷新重试。',true);}
}
boot();

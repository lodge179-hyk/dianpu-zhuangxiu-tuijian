const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {createVisualProfile}=require('./visual-profile.cjs');
const {createStudio,styles}=require('./studio-config.cjs');
const {compileCreative}=require('./campaign-workflow.cjs');
const {applyDesign,validateRecognition}=require('./model-contracts.cjs');
const {validatePlan,buildBatches,aspectRatios}=require('./plan.cjs');
const {studioBatches}=require('./studio-batches.cjs');
const {artworkGeometry,bakeArtwork}=require('./slot-artwork.cjs');
const {prepareProductReferences}=require('./product-references.cjs');
const {prepareVisualReferences}=require('./visual-skill.cjs');
const sharp=require('sharp');
const recognition={sufficient:true,categories:['手袋'],products:[1,2,3,4].map(i=>({category:'手袋',description:'原商品'+i+'，清楚可见的手柄与包体',imageIndex:i})),observations:[],uncertainties:[],missing:[]};
function fixture(preserve=false){
 const profile=createVisualProfile('bags',{preserveProducts:preserve});
 const reference={id:profile.visualSkill.referenceIds[0],borrow:'主体完整，安静的空间与自然光',avoid:'不复制商品、品牌及其他店铺文案'};
 let count=0;
 const visual=(imageForm='cutout',copy)=>{const i=++count%4+1;return {evidenceIds:['product-'+i],subject:'原商品'+i+'的独立展示',caption:'款式'+count,imageForm,copy:copy||{heading:'',body:'',placement:'none',tone:'base'},visualPlan:{picture:'商品在安静的浅色背景中独立展示，保持完整轮廓，构图提供清楚的视觉信息。',difference:'展示不同的款式与整体轮廓',designIds:['design-'+i],camera:imageForm==='macro'?'macro':'eye-level',treatment:imageForm==='flat-icon'?'graphic':'still-life',visualReference:reference}};};
 const mod=(type,chapter,visuals,text='')=>({type,chapter,message:chapter+'，提供有区别的浏览信息',transition:'承接前一章',visuals,...(text?{text}:{})});
 const value={concept:'轻盈日常',reason:'图形与商品摄影分工明确',style:{palette:['#F4F1E8','#303B35'],background:'浅色安静背景',lighting:'柔和自然光',photography:'完整清楚的商品表面'},anchors:['统一配色'],content:{narrative:'主题、分类、选择、细节顺序展开',reason:'信息有层次',reference,pageDesign:{version:1,background:'#F4F1E8',foreground:'#26352E',alternateBackground:'#293C30',alternateForeground:'#FFFFFF',accent:'#B39261',typography:'sans'},collection:[1,2,3,4].map(i=>({id:'design-'+i,category:'手袋',appearance:'手袋'+i+'的实际轮廓、配色与连接',...(preserve?{sourceEvidenceId:'product-'+i}:{})})),modules:[
  mod('signboard.minimal','店铺身份',[]),mod('carousel.medium','主题开场',[visual('editorial',{heading:'随身风景',body:'',placement:'left',tone:'base',surface:'gradient',align:'left',size:'display',widthRatio:.44})]),mod('navigation.four','分类入口',[visual('flat-icon'),visual('flat-icon'),visual('flat-icon'),visual('flat-icon')]),mod('text.link','款式选择',[],'找到日常的搭配'),mod('poster.two','搭配关系',[visual('lifestyle'),visual('editorial')]),mod('showcase.three','清楚浏览',[visual(),visual(),visual()]),mod('text.link','细节引导',[],'看见细节'),mod('poster.single','可见细节',[visual('macro')]),
 ]}};
 return {profile,value};
}
function finished(preserve=false){const {profile,value}=fixture(preserve);const {skeleton,creative}=compileCreative(value,recognition,profile);const result=applyDesign(skeleton.plan,{artDirection:{concept:creative.concept,narrative:creative.content.narrative,anchors:creative.anchors},assets:skeleton.tasks.map(t=>({id:t.id,prompt:t.visualPlan.picture,camera:t.visualPlan.camera,treatment:t.visualPlan.treatment,visualReference:t.visualPlan.visualReference}))},{visualProfile:profile});return {profile,plan:validatePlan({...result,campaign:{reference:creative.content.reference,collection:creative.content.collection},assets:result.assets.map(a=>({...a,designIds:skeleton.tasks.find(t=>t.id===a.id).visualPlan.designIds}))}).plan};}
test('every category has isolated presets, complete module choices and saved options',()=>{
 for(const mode of Object.keys(styles)){const p=createVisualProfile(mode,{styleId:styles[mode][0].id,preserveProducts:true});assert.equal(p.studio.style.id,styles[mode][0].id);assert.equal(p.studio.options.modules.length,6);assert.equal(p.studio.options.preserveProducts,true);assert.equal(createVisualProfile(mode).studio,undefined);}
 assert.throws(()=>createStudio('bags',{styleId:'luxury'}),/不属于/);assert.throws(()=>createStudio('bags',{modules:['signboard','text']}),/至少选择/);
});
test('complete page compiles, user choice reaches generation, hero is not navigation',()=>{
 const {profile,plan}=finished();assert.equal(plan.modules.length,8);assert.equal(plan.studio.options.preserveProducts,false);assert.equal(plan.assets.find(a=>a.id==='overview').direction.role,'hero');
 const batches=buildBatches(plan,[],profile);assert.ok(batches.length>=2&&batches.length<=6);assert.match(batches[0].prompt,/图像形式/);assert.equal(batches.flatMap(b=>b.rows.flat()).length,plan.assets.length);assert.ok(batches.every(b=>b.visualReferences.length<=3));
});
test('missing selected family is reviewable, but cannot become generation-ready',()=>{
 const {profile,value}=fixture();value.content.modules[2]=value.content.modules[4];const draft=compileCreative(value,recognition,profile,{draft:true});assert.ok(draft.reviewContext.requiredChanges.studioIssues.some(s=>s.includes('navigation')));assert.equal(draft.skeleton,undefined);assert.throws(()=>compileCreative(value,recognition,profile),/缺少用户/);
});
test('unselected family and short pages are rejected together',()=>{
 const {profile,value}=fixture();profile.studio=createStudio('bags',{modules:['signboard','carousel','poster']});value.content.modules=value.content.modules.slice(0,5);const draft=compileCreative(value,recognition,profile,{draft:true});assert.ok(draft.reviewContext.requiredChanges.studioIssues.length>=2);
});
test('fidelity binds each asset to original evidence and actual image index',()=>{
 const {profile,plan}=finished(true);assert.ok(plan.assets.every(a=>a.productReferences.length));for(const a of plan.assets)for(const ref of a.productReferences)assert.equal(ref.imageIndex,Number(ref.evidenceId.split('-')[1]));
 assert.ok(buildBatches(plan,[],profile).every(b=>b.productReferences.length));
 const {profile:p,value}=fixture(true);delete value.content.collection[0].sourceEvidenceId;assert.throws(()=>compileCreative(value,recognition,p),/sourceEvidenceId/);
});
test('single clear product is supported by new tasks; legacy threshold stays intact',()=>{
 const raw={sufficient:true,groups:[{name:'手袋',products:[{description:'清楚的蓝色手袋',imageIndex:1}]}],observations:[],uncertainties:[],missing:[]};assert.equal(validateRecognition(raw,1,{minProducts:1}).sufficient,true);assert.equal(validateRecognition(raw,1).sufficient,false);
});
test('24 mixed assets partition within six sheets without duplicate or missing slots',()=>{
 const ratios=['4:3','1:1','1:1','1:1','1:1','3:1','3:4','577:848'];const assets=Array.from({length:24},(_,i)=>({id:i?'asset-'+i:'overview',aspect:ratios[i%ratios.length]}));const batches=studioBatches(assets,aspectRatios);assert.ok(batches.length<=6);const ids=batches.flatMap(b=>b.rows.flat());assert.equal(new Set(ids).size,24);assert.equal(ids.length,24);for(const b of batches)assert.ok(b.rows.flat().length<=6);
});
test('new typography keeps a short Chinese title intact and preserves readable geometry',async()=>{
 const a={version:2,heading:'光色交响',body:'',placement:'left',tone:'base',surface:'gradient',width:483,height:362.25,background:'#F4F1E8',foreground:'#26352E',typography:'sans'};assert.deepEqual(artworkGeometry(a).heading,['光色交响']);const bytes=await sharp({create:{width:966,height:725,channels:3,background:'#cdd9be'}}).png().toBuffer();const output=await bakeArtwork(bytes,a);assert.equal((await sharp(output).metadata()).width,966);
});
test('product attachment preparation is local, deduplicates originals and fails on missing evidence',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-refs-'));try{await sharp({create:{width:100,height:100,channels:3,background:'#eeeeee'}}).jpeg().toFile(path.join(dir,'input-1.jpg'));const batch={studio:createStudio('bags',{preserveProducts:true}),productReferences:[{evidenceId:'product-1',imageIndex:1,description:'原商品'},{evidenceId:'product-2',imageIndex:1,description:'另一商品'}]};const result=await prepareProductReferences(dir,batch,3);assert.equal(result.images.length,1);assert.equal(result.records[0].attachment,4);assert.equal(result.records[0].products.length,2);batch.productReferences[0].imageIndex=2;await assert.rejects(()=>prepareProductReferences(dir,batch),/原图缺失/);batch.studio.options.preserveProducts=false;assert.equal((await prepareProductReferences(dir,batch)).images.length,0);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('new page reference files are available locally for every category',async()=>{for(const mode of Object.keys(styles)){const visual=await prepareVisualReferences(createVisualProfile(mode,{}),{includePage:true});assert.equal(visual.pageReferences.length,2);assert.equal(visual.images.length,visual.references.length+2);}});
test('offline planning carries preserved products through recognition, creation and revision without generating images',async()=>{
 const {productWorkflow}=require('./product-workflow.cjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-planning-'));const {profile,value}=fixture(true);let calls=0;
 const old=process.env.DASHSCOPE_API_KEY;process.env.DASHSCOPE_API_KEY='offline-placeholder';
 try{
  const data='data:image/jpeg;base64,'+(await sharp({create:{width:150,height:150,channels:3,background:'#e6e6e6'}}).jpeg().toBuffer()).toString('base64');
  const run={id:'11111111-1111-1111-1111-111111111111',folder:dir,state:{status:'planning',generationMode:'bags',visualProfile:profile,filledAssets:[],importedBatches:[],planningRequestAttempts:0,imageGenerationCallsByThisTool:0}};
  const save=(dir,state)=>fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify(state));
  await productWorkflow(run,Array.from({length:4},(_,i)=>({name:'商品'+i,data})),save,{generate:false,fetcher:async(url,init)=>{
   calls++;const body=JSON.parse(init.body),input=JSON.parse(body.input.messages[1].content[0].text);
   const response=calls===1?{sufficient:true,groups:[{name:'手袋',businessTraits:'完整包型与不同配色',products:recognition.products.map(({category,...p})=>p)}],businessScope:{summary:'手袋经营',freedom:'只更换场景和构图',avoid:'不能更换商品'},observations:[],uncertainties:[],missing:[]}:value;
   if(calls>1){assert.equal(input.userRequirements.options.preserveProducts,true);assert.equal(input.productAttachments.length,4);assert.equal(input.evidence[0].imageIndex,1);assert.equal(body.parameters.max_tokens,24000);assert.ok(body.input.messages[1].content.length>4);}
   return new Response(JSON.stringify({output:{choices:[{message:{content:[{text:JSON.stringify(response)}]},finish_reason:'stop'}]}}),{status:200});
  }});
  assert.equal(calls,3);assert.equal(run.state.status,'ready');assert.equal(run.state.imageGenerationCallsByThisTool,0);assert.equal(run.state.plan.studio.options.preserveProducts,true);assert.equal(run.state.batches.length,3);assert.ok(run.state.batches.every(b=>b.productReferences.length));
 }finally{if(old===undefined)delete process.env.DASHSCOPE_API_KEY;else process.env.DASHSCOPE_API_KEY=old;fs.rmSync(dir,{recursive:true,force:true});}
});
test('prepared image request includes original pixels, bounded references and an accurate audit',async()=>{
 const {generateSheet}=require('./ark-image-provider.cjs');const {plan,profile}=finished(true),batch=buildBatches(plan,[],profile)[0];const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-request-'));const previous=process.env.ARK_API_KEY;process.env.ARK_API_KEY='offline-placeholder';let sent;
 try{
  for(let i=1;i<=4;i++)await sharp({create:{width:100,height:100,channels:3,background:'#eeccbb'}}).jpeg().toFile(path.join(dir,`input-${i}.jpg`));
  await assert.rejects(()=>generateSheet(dir,plan,batch,1,{fetcher:async(url,init)=>{sent=JSON.parse(init.body);return new Response(JSON.stringify({error:{code:'OfflineContractStop'}}),{status:400});}}),/OfflineContractStop/);
  assert.ok(Array.isArray(sent.image)&&sent.image.length<=10);assert.match(sent.prompt,/原图，最高商品身份依据/);
  const audit=JSON.parse(fs.readFileSync(path.join(dir,batch.id+'-attempt-1-settings.json'),'utf8'));assert.equal(audit.preserveProducts,true);assert.ok(audit.productReferences.length);for(const r of audit.productReferences)assert.match(sent.image[r.attachment-1],/^data:image\/jpeg;base64,/);
 }finally{if(previous===undefined)delete process.env.ARK_API_KEY;else process.env.ARK_API_KEY=previous;fs.rmSync(dir,{recursive:true,force:true});}
});
test('studio ZIP retains native text, selected settings and original-product mapping without leaking uploads',async()=>{
 const {compose}=require('./compose.cjs'),{materialsZip}=require('./download.cjs'),{unzipSync,strFromU8}=require('fflate');const {plan,profile}=finished(true);const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-export-'));
 try{compose(dir,plan,{visualProfile:profile});const bytes=await sharp({create:{width:120,height:120,channels:3,background:'#e6e9dc'}}).png().toBuffer();for(const a of plan.assets)fs.writeFileSync(path.join(dir,'assets',a.id+'.png'),bytes);fs.writeFileSync(path.join(dir,'input-1.jpg'),'private-original-marker');const state={id:'offline-export',status:'ready',plan,filledAssets:plan.assets.map(a=>a.id)};const files=unzipSync(await materialsZip(dir,state));const mapping=JSON.parse(strFromU8(files['素材对照.json']));assert.equal(mapping.designOptions.preserveProducts,true);assert.equal(mapping.modules.find(m=>m.type==='text.link').text,'找到日常的搭配');assert.ok(mapping.modules.flatMap(m=>m.images).every(i=>i.sourceProducts.length));assert.ok(!Object.keys(files).some(f=>f.includes('input-1')));assert.match(strFromU8(files['使用说明.txt']),/原图为生成依据/);assert.match(strFromU8(files['本次设计设置.txt']),/商品保真：开启/);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('complete invalid drafts collect field errors without rewriting or becoming executable',()=>{
 const {profile,value}=fixture();value.concept='主'.repeat(112);
 value.content.modules[1].visuals[0].imageForm='still-life';
 value.content.modules[2].visuals[0].copy.widthRatio=0;
 delete value.content.modules[3].visuals;
 const original=structuredClone(value),result=compileCreative(value,recognition,profile,{draft:true});
 assert.equal(result.skeleton,undefined);assert.deepEqual(result.creative,original);assert.deepEqual(value,original);
 const issues=result.reviewContext.requiredChanges.schemaIssues;
 assert.match(issues.find(i=>i.path==='concept').reason,/最多 100.*当前 112/);
 for(const field of ['imageForm','widthRatio','visuals'])assert.ok(issues.some(i=>i.path.endsWith(field)));
 assert.throws(()=>compileCreative(value,recognition,profile),/concept（最多 100 个字符，当前 112 个）/);
 const legacy=createVisualProfile('bags');assert.throws(()=>compileCreative(value,recognition,legacy,{draft:true}),/concept/);
 assert.throws(()=>compileCreative({concept:'只有标题'},recognition,profile,{draft:true}),error=>!error.creativeDraft);
});
test('continuation reuses a complete invalid cached draft and spends only the existing revision call',async()=>{
 const {planCampaign}=require('./campaign-workflow.cjs');const {profile,value}=fixture(true);
 const bad=structuredClone(value);bad.concept='主'.repeat(112);bad.content.modules[1].visuals[0].imageForm='still-life';delete bad.content.modules[3].visuals;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-draft-recovery-')),original=JSON.stringify(bad);const previous=process.env.DASHSCOPE_API_KEY;process.env.DASHSCOPE_API_KEY='offline-placeholder';let calls=0;
 try{
  const inputs=[];for(let i=1;i<=4;i++){const file=`input-${i}.jpg`;await sharp({create:{width:100,height:100,channels:3,background:'#eee'}}).jpeg().toFile(path.join(dir,file));inputs.push({file});}
  fs.writeFileSync(path.join(dir,'content-call.json'),JSON.stringify({status:'completed',finishReason:'stop'}));fs.writeFileSync(path.join(dir,'content-response.txt'),original);
  const run={folder:dir,state:{inputs,recognition:{...recognition,businessScope:{summary:'手袋经营',categories:[{category:'手袋',traits:'完整包型'}],freedom:'背景构图',avoid:'不换商品'}},planningRequestAttempts:2,imageGenerationCallsByThisTool:0}};
  const save=(folder,state)=>fs.writeFileSync(path.join(folder,'state.json'),JSON.stringify(state));
  await planCampaign(run,profile,save,{reuse:true,setStage:()=>{},fetcher:async(url,init)=>{
   calls++;const input=JSON.parse(JSON.parse(init.body).input.messages[1].content[0].text);
   assert.deepEqual(input.draft,bad);assert.ok(input.requiredChanges.schemaIssues.some(i=>i.path==='concept'));assert.equal(run.state.plan,undefined);
   return new Response(JSON.stringify({output:{choices:[{message:{content:[{text:JSON.stringify(value)}]},finish_reason:'stop'}]}}),{status:200});
  }});
  assert.equal(calls,1);assert.equal(run.state.planningRequestAttempts,3);assert.equal(run.state.imageGenerationCallsByThisTool,0);assert.ok(run.state.plan);
  assert.equal(fs.readFileSync(path.join(dir,'content-response.txt'),'utf8'),original);assert.ok(!fs.existsSync(path.join(dir,'content-attempt-2-call.json')));
 }finally{if(previous===undefined)delete process.env.DASHSCOPE_API_KEY;else process.env.DASHSCOPE_API_KEY=previous;fs.rmSync(dir,{recursive:true,force:true});}
});
module.exports={fixture,finished,recognition};

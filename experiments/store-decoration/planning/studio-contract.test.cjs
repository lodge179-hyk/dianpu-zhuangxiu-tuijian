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
 const profile=createVisualProfile('bags',{preserveProducts:preserve});profile.studio=createStudio('bags',{preserveProducts:preserve},{version:1});
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
 for(const mode of Object.keys(styles)){const p=createVisualProfile(mode,{styleId:styles[mode][0].id,preserveProducts:true});assert.equal(p.studio.style.id,styles[mode][0].id);assert.equal(p.studio.options.modules.length,2);assert.equal(p.studio.options.preserveProducts,true);assert.equal(createVisualProfile(mode).studio,undefined);}
 assert.throws(()=>createStudio('bags',{styleId:'luxury'}),/不属于/);assert.throws(()=>createStudio('bags',{modules:['signboard','text']},{version:1}),/至少选择/);
});
test('complete page compiles, user choice reaches generation, hero is not navigation',()=>{
 const {profile,plan}=finished();assert.equal(plan.modules.length,8);assert.equal(plan.studio.options.preserveProducts,false);assert.equal(plan.assets.find(a=>a.id==='overview').direction.role,'hero');
 const batches=buildBatches(plan,[],profile);assert.ok(batches.length>=2&&batches.length<=6);assert.match(batches[0].prompt,/图像形式/);assert.equal(batches.flatMap(b=>b.rows.flat()).length,plan.assets.length);assert.ok(batches.every(b=>b.visualReferences.length<=3));
});
test('missing selected family is reviewable, but cannot become generation-ready',()=>{
 const {profile,value}=fixture();value.content.modules[2]=value.content.modules[4];const draft=compileCreative(value,recognition,profile,{draft:true});assert.ok(draft.reviewContext.requiredChanges.studioIssues.some(s=>s.includes('navigation')));assert.equal(draft.skeleton,undefined);assert.throws(()=>compileCreative(value,recognition,profile),/缺少用户/);
});
test('unselected family and short pages are rejected together',()=>{
 const {profile,value}=fixture();profile.studio=createStudio('bags',{modules:['signboard','carousel','poster']},{version:1});value.content.modules=value.content.modules.slice(0,5);const draft=compileCreative(value,recognition,profile,{draft:true});assert.ok(draft.reviewContext.requiredChanges.studioIssues.length>=2);
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
for(const version of [1,2])test(`v${version} offline planning carries preserved products through recognition, creation and revision without generating images`,async()=>{
 const {productWorkflow}=require('./product-workflow.cjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-planning-'));const {profile,value}=(version===1?fixture:editorialFixture)(true);let calls=0;
 const old=process.env.DASHSCOPE_API_KEY;process.env.DASHSCOPE_API_KEY='offline-placeholder';
 try{
  const data='data:image/jpeg;base64,'+(await sharp({create:{width:150,height:150,channels:3,background:'#e6e6e6'}}).jpeg().toBuffer()).toString('base64');
  const run={id:'11111111-1111-1111-1111-111111111111',folder:dir,state:{status:'planning',generationMode:'bags',visualProfile:profile,filledAssets:[],importedBatches:[],planningRequestAttempts:0,imageGenerationCallsByThisTool:0}};
  const save=(dir,state)=>fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify(state));
  await productWorkflow(run,Array.from({length:4},(_,i)=>({name:'商品'+i,data})),save,{generate:false,fetcher:async(url,init)=>{
   calls++;const body=JSON.parse(init.body),input=JSON.parse(body.input.messages[1].content[0].text);
   const response=calls===1?{sufficient:true,groups:[{name:'手袋',businessTraits:'完整包型与不同配色',products:recognition.products.map(({category,...p})=>p)}],businessScope:{summary:'手袋经营',freedom:'只更换场景和构图',avoid:'不能更换商品'},observations:[],uncertainties:[],missing:[]}:value;
   if(calls>1){assert.equal(input.userRequirements.options.preserveProducts,true);assert.equal(input.productAttachments.length,4);assert.equal(input.evidence[0].imageIndex,1);assert.equal(body.parameters.max_tokens,version===1?24000:40000);assert.ok(body.input.messages[1].content.length>4);}
   return new Response(JSON.stringify({output:{choices:[{message:{content:[{text:JSON.stringify(response)}]},finish_reason:'stop'}]}}),{status:200});
  }});
  assert.equal(calls,3);assert.equal(run.state.status,'ready');assert.equal(run.state.imageGenerationCallsByThisTool,0);assert.equal(run.state.plan.studio.options.preserveProducts,true);assert.ok(run.state.batches.length<=profile.studio.maxBatches);assert.ok(run.state.batches.some(b=>b.productReferences.length));if(version===2)assert.ok(run.state.layout.height>=4800);
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
for(const version of [1,2])test(`v${version} continuation reuses an invalid cached draft and spends only the existing revision call`,async()=>{
 const {planCampaign}=require('./campaign-workflow.cjs');const {profile,value}=(version===1?fixture:editorialFixture)(true);
 if(version===2){value.content.modules[1].visuals[0].copy.align='right';const banner=value.content.modules.find(m=>m.type==='carousel.small').visuals[0];banner.copy.placement='center';banner.copy.align='center';banner.visualPlan.treatment='texture';}
 const bad=structuredClone(value);
 if(version===1){bad.concept='主'.repeat(112);bad.content.modules[1].visuals[0].imageForm='still-life';delete bad.content.modules[3].visuals;}
 else {delete bad.content.modules[3].text;bad.content.modules[7].visuals[0].visualPlan.picture='   ';}
 const draft=compileCreative(bad,recognition,profile,{draft:true});assert.equal(draft.skeleton,undefined);assert.throws(()=>compileCreative(bad,recognition,profile),/整页创作字段/);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-draft-recovery-')),original=JSON.stringify(bad);const previous=process.env.DASHSCOPE_API_KEY;process.env.DASHSCOPE_API_KEY='offline-placeholder';let calls=0;
 try{
  const inputs=[];for(let i=1;i<=4;i++){const file=`input-${i}.jpg`;await sharp({create:{width:100,height:100,channels:3,background:'#eee'}}).jpeg().toFile(path.join(dir,file));inputs.push({file});}
  fs.writeFileSync(path.join(dir,'content-call.json'),JSON.stringify({status:'completed',finishReason:'stop'}));fs.writeFileSync(path.join(dir,'content-response.txt'),original);
  const run={folder:dir,state:{inputs,recognition:{...recognition,businessScope:{summary:'手袋经营',categories:[{category:'手袋',traits:'完整包型'}],freedom:'背景构图',avoid:'不换商品'}},planningRequestAttempts:2,imageGenerationCallsByThisTool:0}};
  const save=(folder,state)=>fs.writeFileSync(path.join(folder,'state.json'),JSON.stringify(state));
  await planCampaign(run,profile,save,{reuse:true,setStage:()=>{},fetcher:async(url,init)=>{
   calls++;const input=JSON.parse(JSON.parse(init.body).input.messages[1].content[0].text);
   assert.deepEqual(input.draft,draft.creative);assert.ok(input.requiredChanges.schemaIssues.some(i=>i.path===(version===1?'concept':'content.modules.3.text')));assert.equal(run.state.plan,undefined);
   if(version===2){assert.equal(input.draft.content.modules[3].text,undefined);assert.ok(input.requiredChanges.schemaIssues.some(i=>i.path.endsWith('picture')));assert.ok(!input.requiredChanges.schemaIssues.some(i=>/placement|align/.test(i.path)));}
   return new Response(JSON.stringify({output:{choices:[{message:{content:[{text:JSON.stringify(value)}]},finish_reason:'stop'}]}}),{status:200});
  }});
  assert.equal(calls,1);assert.equal(run.state.planningRequestAttempts,3);assert.equal(run.state.imageGenerationCallsByThisTool,0);assert.ok(run.state.plan);
  if(version===2){assert.equal(run.state.plan.assets.find(a=>a.id==='overview').artwork.align,'right');const banner=run.state.plan.assets.find(a=>a.artwork?.placement==='center');assert.equal(banner.direction.treatment,'texture');assert.deepEqual(banner.designIds,[]);assert.match(buildBatches(run.state.plan,[],profile).map(b=>b.prompt).join('\n'),/构图意图center/);}
  assert.equal(fs.readFileSync(path.join(dir,'content-response.txt'),'utf8'),original);assert.ok(!fs.existsSync(path.join(dir,'content-attempt-2-call.json')));
 }finally{if(previous===undefined)delete process.env.DASHSCOPE_API_KEY;else process.env.DASHSCOPE_API_KEY=previous;fs.rmSync(dir,{recursive:true,force:true});}
});
test('native image copy supports center and right while legacy overlays keep their supported geometry',async()=>{
 const {artworkSchema,copySchema}=require('./slot-artwork.cjs');
 const native={version:3,heading:'随身风景',body:'',placement:'center',align:'right',tone:'base',width:483,height:161,background:'#FFFFFF',foreground:'#333333',typography:'sans'};
 assert.ok(artworkSchema.safeParse(native).success);assert.equal(artworkSchema.safeParse({...native,version:2}).success,false);assert.equal(copySchema.safeParse({heading:'标题',placement:'center'}).success,false);
 const bytes=Buffer.from('native-pixels');assert.equal(await bakeArtwork(bytes,native),bytes);
});
test('v2 reuses a saved concise revision and its supplied page reference without another planning call',async()=>{
 const {planCampaign}=require('./campaign-workflow.cjs'),{createHash}=require('crypto');
 const {profile,value}=editorialFixture(true),pageId=profile.visualSkill.pageReferenceIds[0];
 value.content.reference.id=pageId;
 for(const m of value.content.modules)for(const v of m.visuals){v.visualPlan.visualReference={...value.content.reference};v.visualPlan.picture='小尺寸去底图，展示包身侧面。';}
 const bad=structuredClone(value);delete bad.content.modules[3].text;
 const recognitionState={...recognition,businessScope:{summary:'手袋经营',categories:[{category:'手袋',traits:'完整包型'}],freedom:'背景构图',avoid:'不换商品'}};
 const draft=compileCreative(bad,recognition,profile,{draft:true}).creative;
 const signature=createHash('sha256').update(JSON.stringify({creative:draft,businessScope:recognitionState.businessScope,profile})).digest('hex');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-concise-cache-'));let calls=0;
 try{
  const inputs=[];for(let i=1;i<=4;i++){const file=`input-${i}.jpg`;await sharp({create:{width:100,height:100,channels:3,background:'#eee'}}).jpeg().toFile(path.join(dir,file));inputs.push({file});}
  for(const [stage,response] of [['content',bad],['design',value]]){fs.writeFileSync(path.join(dir,stage+'-call.json'),JSON.stringify({status:'completed',finishReason:'stop'}));fs.writeFileSync(path.join(dir,stage+'-response.txt'),JSON.stringify(response));}
  fs.writeFileSync(path.join(dir,'design-input.json'),JSON.stringify({draft,draftSignature:signature}));
  const run={folder:dir,state:{inputs,recognition:recognitionState,planningRequestAttempts:3,imageGenerationCallsByThisTool:0}};
  await planCampaign(run,profile,()=>{},{reuse:true,setStage:()=>{},fetcher:async()=>{calls++;throw Error('No model request allowed');}});
  assert.equal(calls,0);assert.equal(run.state.planningRequestAttempts,3);assert.equal(run.state.plan.campaign.reference.id,pageId);
  assert.ok(run.state.plan.assets.every(a=>a.prompt==='小尺寸去底图，展示包身侧面。'));
  const batches=buildBatches(run.state.plan,[],profile);assert.ok(batches.every(b=>b.visualReferences.some(r=>r.id===pageId&&r.referenceKind==='page')));
  const prepared=await require('./visual-skill.cjs').prepareGenerationReferences(dir,batches[0].visualReferences);assert.equal(prepared.records[0].referenceKind,'page');assert.match(prepared.images[0],/^data:image\/jpeg;base64,/);
  const invalid=structuredClone(value);invalid.content.modules[1].visuals[0].visualPlan.picture=' ';assert.throws(()=>compileCreative(invalid,recognition,profile),/picture/);
  const blankPlan=structuredClone(run.state.plan);blankPlan.assets[0].prompt=' ';assert.throws(()=>validatePlan(blankPlan),/prompt/);
  const unknown=structuredClone(value);unknown.content.reference.id='not-supplied';assert.throws(()=>compileCreative(unknown,recognition,profile),/本任务之外/);
  const legacy=fixture();legacy.value.content.modules[1].visuals[0].visualPlan.picture='小尺寸去底图，展示包身侧面。';assert.throws(()=>compileCreative(legacy.value,recognition,legacy.profile),/picture/);
  const oldPlan=finished().plan;oldPlan.assets[0].prompt='小尺寸去底图，展示包身侧面。';assert.throws(()=>validatePlan(oldPlan),/旧版本/);
  assert.equal(fs.readFileSync(path.join(dir,'design-response.txt'),'utf8'),JSON.stringify(value));
 }finally{if(!path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe cleanup');fs.rmSync(dir,{recursive:true,force:true});}
});
test('v2 continuation repairs only missing product selections and reuses the signed repair',async()=>{
 const {planCampaign}=require('./campaign-workflow.cjs'),{createHash}=require('crypto');
 const {profile,value}=editorialFixture(true),bad=structuredClone(value);
 bad.content.modules[1].visuals[0].evidenceIds=[];bad.content.modules[1].visuals[0].visualPlan.designIds=[];
 bad.content.modules[1].visuals[0].subject='多款手袋的群像';
 const recognitionState={...recognition,businessScope:{summary:'手袋经营',categories:[{category:'手袋',traits:'完整包型'}],freedom:'背景构图',avoid:'不换商品'}};
 const draft=compileCreative(value,recognition,profile,{draft:true}).creative;
 const signature=createHash('sha256').update(JSON.stringify({creative:draft,businessScope:recognitionState.businessScope,profile})).digest('hex');
 const repairedVisual=value.content.modules[1].visuals[0],patch={repairs:[{moduleIndex:1,visualIndex:0,designIds:repairedVisual.visualPlan.designIds,
  subject:repairedVisual.subject,picture:repairedVisual.visualPlan.picture,difference:repairedVisual.visualPlan.difference}]};
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-reference-repair-')),previous=process.env.DASHSCOPE_API_KEY;
 process.env.DASHSCOPE_API_KEY='offline-placeholder';let calls=0;
 try{
  const inputs=[];for(let i=1;i<=4;i++){const file=`input-${i}.jpg`;await sharp({create:{width:100,height:100,channels:3,background:'#eee'}}).jpeg().toFile(path.join(dir,file));inputs.push({file});}
  for(const [stage,response] of [['content',value],['design',bad],['design-attempt-2',bad]]){
   fs.writeFileSync(path.join(dir,stage+'-call.json'),JSON.stringify({status:'completed',finishReason:'stop'}));
   fs.writeFileSync(path.join(dir,stage+'-response.txt'),JSON.stringify(response));
   if(stage.startsWith('design'))fs.writeFileSync(path.join(dir,stage+'-input.json'),JSON.stringify({draft,draftSignature:signature}));
  }
  const run={folder:dir,state:{inputs,recognition:recognitionState,planningRequestAttempts:4,imageGenerationCallsByThisTool:0}};
  const execute=fetcher=>planCampaign(run,profile,()=>{},{reuse:true,setStage:()=>{},fetcher});
  const fetcher=async(url,init)=>{
   calls++;const body=JSON.parse(init.body),input=JSON.parse(body.input.messages[1].content[0].text);
   assert.equal(input.draft,undefined);assert.equal(input.visuals.length,1);assert.equal(input.visuals[0].moduleIndex,1);
   assert.equal(input.visuals[0].visual.subject,bad.content.modules[1].visuals[0].subject);
   assert.equal(input.collection.length,4);assert.deepEqual(input.productAttachments.map(a=>a.attachment),[1,2,3,4]);
   assert.equal(body.input.messages[1].content.length,5);assert.ok(body.parameters.max_tokens<40000);
   return new Response(JSON.stringify({output:{choices:[{message:{content:[{text:JSON.stringify(patch)}]},finish_reason:'stop'}]}}),{status:200});
  };
  await execute(fetcher);
  assert.equal(calls,1);assert.equal(run.state.planningRequestAttempts,5);assert.equal(run.state.imageGenerationCallsByThisTool,0);
  const asset=run.state.plan.assets.find(a=>a.id==='overview');
  assert.deepEqual(asset.designIds,repairedVisual.visualPlan.designIds);assert.deepEqual(asset.productReferences.map(r=>r.evidenceId),repairedVisual.evidenceIds);
  assert.deepEqual(run.state.contentPlan,compileCreative(value,recognition,profile).creative.content);
  await execute(async()=>{throw Error('Valid saved repair must not call any model');});
  assert.equal(run.state.planningRequestAttempts,5);
  assert.equal(fs.readFileSync(path.join(dir,'design-attempt-2-response.txt'),'utf8'),JSON.stringify(bad));
  assert.ok(!fs.existsSync(path.join(dir,'design-attempt-3-call.json')));
  // A changed saved revision cannot reuse a repair from the previous creative.
  bad.content.modules[1].visuals[0].subject='新的群像构图';
  fs.writeFileSync(path.join(dir,'design-attempt-2-response.txt'),JSON.stringify(bad));
  delete run.state.plan;await execute(fetcher);assert.equal(calls,2);assert.equal(run.state.planningRequestAttempts,6);
  // Invalid replies stop after one targeted call, without broad revision fallback.
  bad.content.modules[1].visuals[0].subject='需要再次选择的构图';
  fs.writeFileSync(path.join(dir,'design-attempt-2-response.txt'),JSON.stringify(bad));delete run.state.plan;
  let rejectedCalls=0;
  await assert.rejects(execute(async()=>{
   rejectedCalls++;return new Response(JSON.stringify({output:{choices:[{message:{content:[{text:JSON.stringify({repairs:[]})}]},finish_reason:'stop'}]}}),{status:200});
  }));
  assert.equal(rejectedCalls,1);assert.equal(run.state.plan,undefined);assert.equal(run.state.imageGenerationCallsByThisTool,0);
 }finally{if(previous===undefined)delete process.env.DASHSCOPE_API_KEY;else process.env.DASHSCOPE_API_KEY=previous;fs.rmSync(dir,{recursive:true,force:true});}
});
test('targeted product repair rejects guessed IDs, duplicate targets, broad edits and unrelated failures',()=>{
 const {referenceRepairTargets,applyReferenceRepair}=require('./studio-reference-repair.cjs');
 const {profile,value}=editorialFixture(true);
 for(const index of [1,4]){const visual=value.content.modules[index].visuals[0];visual.evidenceIds=[];visual.visualPlan.designIds=[];}
 const revision=compileCreative(value,recognition,profile,{draft:true}),targets=referenceRepairTargets(revision,recognition,profile),before=structuredClone(revision.creative);
 assert.equal(targets.length,2);
 const patch={repairs:targets.map(t=>({moduleIndex:t.moduleIndex,visualIndex:t.visualIndex,designIds:['design-1'],subject:'原商品一',picture:'保持原商品轮廓和配色',difference:'更清楚的整体轮廓'}))};
 const repaired=applyReferenceRepair(revision.creative,targets,patch);assert.ok(compileCreative(repaired,recognition,profile).skeleton);assert.deepEqual(revision.creative,before);
 for(const mutate of [
  p=>p.repairs[0].designIds=[],
  p=>p.repairs[0].designIds=['design-999'],
  p=>p.repairs[0].designIds=['design-1','design-1'],
  p=>p.repairs[0].moduleIndex=2,
  p=>p.repairs[1]={...p.repairs[0]},
  p=>p.repairs[0].picture=' ',
  p=>p.repairs[0].copy={heading:'擅自改文案'},
 ]){const invalid=structuredClone(patch);mutate(invalid);assert.throws(()=>applyReferenceRepair(revision.creative,targets,invalid));}
 assert.equal(referenceRepairTargets(revision,recognition,{...profile,studio:{...profile.studio,version:1}}),null);
 const mixed=structuredClone(revision);mixed.reviewContext.requiredChanges.studioIssues=['页面高度不足'];assert.equal(referenceRepairTargets(mixed,recognition,profile),null);
});
function editorialFixture(preserve=false){
 const {profile,value}=fixture(preserve);profile.studio=createStudio('bags',{modules:['signboard'],preserveProducts:preserve});
 const sample=value.content.modules[7].visuals[0];
 for(let i=0;i<10;i++){
  const visual=structuredClone(sample),banner=i%3===0;
  visual.subject='章节'+i+'的商品展示';visual.visualPlan.picture+='这是章节'+i+'的独立构图。';
  if(banner){visual.evidenceIds=[];visual.visualPlan.designIds=[];visual.visualPlan.treatment='graphic';visual.imageForm='graphic-collage';visual.copy={heading:'随行的风景',body:'',placement:'left',tone:'base'};}
  delete visual.visualPlan.visualReference;
  value.content.modules.push({type:banner?'carousel.small':i===1?'carousel.large':'poster.single',chapter:'生活章节'+i,message:'展示章节'+i+'的整体或细节',transition:'不同尺度与信息交替',visuals:[visual]});
 }
 return {profile,value};
}
test('v2 measures vertical content, permits unselected families and inherits declared references',()=>{
 const {profile,value}=editorialFixture(true),before=structuredClone(value),{skeleton}=compileCreative(value,recognition,profile);
 assert.equal(profile.studio.version,2);assert.ok(skeleton.plan.modules.length>=16);assert.ok(require('./studio-layout.cjs').measureStudioModules(skeleton.plan.modules).height>=4800);
 assert.deepEqual(value,before);assert.ok(skeleton.plan.modules.some(m=>m.type==='showcase.three'));assert.deepEqual(profile.studio.options.modules,['signboard']);
 assert.ok(skeleton.plan.assets.some(a=>a.direction.role==='atmosphere'&&a.designIds===undefined));
 assert.ok(skeleton.plan.assets.filter(a=>a.artwork).every(a=>a.artwork.version===3));
 const missingHeight=structuredClone(skeleton.plan);delete missingHeight.studio.minPageHeight;assert.throws(()=>validatePlan(missingHeight),/minPageHeight|4800/);
 const invalid=structuredClone(skeleton.plan);invalid.studio.options.modules.push('navigation');invalid.modules=invalid.modules.filter(m=>!m.type.startsWith('navigation.'));assert.throws(()=>validatePlan(invalid),/勾选/);
});
test('v2 rejects a short page even with enough compact modules and reports actual heights',()=>{
 const {profile,value}=editorialFixture();value.content.modules=value.content.modules.map((m,i)=>i===0?m:{type:'carousel.small',chapter:'章节'+i,message:'有效内容'+i,transition:'',visuals:[structuredClone(value.content.modules[1].visuals[0])]});
 const draft=compileCreative(value,recognition,profile,{draft:true});assert.ok(draft.reviewContext.requiredChanges.studioIssues.some(i=>i.includes('整页高')&&i.includes('4800')));assert.throws(()=>compileCreative(value,recognition,profile),/少于4800/);
 const feedback=draft.reviewContext.requiredChanges.layoutFeedback;
 assert.equal(feedback.currentHeight,require('./studio-layout.cjs').measureStudioModules(value.content.modules).height);
 assert.equal(feedback.missingHeight,Math.ceil(4800-feedback.currentHeight));assert.equal(feedback.remainingModules,24-value.content.modules.length);
 assert.match(feedback.instruction,/实际增加或重组/);
});
test('v2 native copy stays in generation prompts and is never covered by a program overlay',async()=>{
 const {profile,value}=editorialFixture(),{skeleton,creative}=compileCreative(value,recognition,profile);
 const designed=applyDesign(skeleton.plan,{artDirection:{concept:creative.concept,narrative:creative.content.narrative,anchors:creative.anchors},assets:skeleton.tasks.map(t=>({id:t.id,prompt:t.visualPlan.picture,camera:t.visualPlan.camera,treatment:t.visualPlan.treatment,visualReference:t.visualPlan.visualReference}))},{visualProfile:profile});
 const plan=validatePlan({...designed,campaign:{reference:creative.content.reference,collection:creative.content.collection},assets:designed.assets.map(a=>({...a,designIds:skeleton.tasks.find(t=>t.id===a.id).visualPlan.designIds}))}).plan;
 const batches=buildBatches(plan,[],profile),prompt=batches.map(b=>b.prompt).join('\n');assert.match(prompt,/随行的风景/);assert.match(prompt,/图文一体/);assert.doesNotMatch(prompt,/文字之后准确写入|不画文字和假按钮|程序裁剪后把文字/);
 const bytes=Buffer.from('unchanged-native-image');assert.equal(await bakeArtwork(bytes,plan.assets.find(a=>a.artwork).artwork),bytes);
 const {compose}=require('./compose.cjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-length-'));
 try{
  const result=compose(dir,plan,{visualProfile:profile});assert.equal(result.layout.height,require('./studio-layout.cjs').measureStudioModules(plan.modules).height);assert.ok(result.layout.height>=4800);
  // Calibration pixels exercise crop/export only; no model call or storefront visual acceptance.
  const id='overview',batch=plan.batches.find(b=>b.rows.flat().includes(id));
  const red=await sharp({create:{width:600,height:16,channels:3,background:'#cc3311'}}).png().toBuffer();
  const panel=await sharp({create:{width:600,height:500,channels:3,background:'#225577'}}).composite([{input:red,left:0,top:20},{input:red,left:0,top:464}]).png().toBuffer();
  const sheet=await sharp({create:{width:624,height:524,channels:3,background:'#ff00ff'}}).composite([{input:panel,left:12,top:12}]).png().toBuffer();
  const report=await require('./crop.cjs').cropBatch(sheet,plan,batch.id,dir,{...batch,rows:[[id]]});
  assert.equal(report.crops[0].fitMethod,'contain-with-background');assert.equal(report.crops[0].allowedRemovedAreaPercent,3);assert.equal(report.crops[0].copyBaked,false);assert.equal(report.crops[0].textRendering,'native-image');
  const cropped=fs.readFileSync(path.join(dir,'assets',id+'.png')),pixels=await sharp(cropped).raw().toBuffer();let redCount=0;for(let i=0;i<pixels.length;i+=3)if(pixels[i]===204&&pixels[i+1]===51&&pixels[i+2]===17)redCount++;assert.ok(redCount>=19000,'Both edge markers survive without a text overlay');
  for(const asset of plan.assets)if(asset.id!==id)fs.writeFileSync(path.join(dir,'assets',asset.id+'.png'),panel);
  const {unzipSync,strFromU8}=require('fflate'),files=unzipSync(await require('./download.cjs').materialsZip(dir,{id:'offline-v2',status:'ready',plan,filledAssets:plan.assets.map(a=>a.id)}));
  const mapping=JSON.parse(strFromU8(files['素材对照.json'])),mapped=mapping.modules.flatMap(m=>m.images).find(i=>i.assetId===id);assert.equal(mapped.textRendering,'native-image');assert.equal(mapped.copyBaked,false);assert.deepEqual(Buffer.from(files[mapped.file]),cropped);assert.match(strFromU8(files['使用说明.txt']),/核对实际文字/);assert.match(strFromU8(files['本次设计设置.txt']),/AI可补充其他模块/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('v2 keeps photo and graphic choices open while preserving numeric delivery budgets',()=>{
 const {profile,value}=editorialFixture();profile.studio=createStudio('bags',{styleId:'commute',modules:['signboard']});
 for(const m of value.content.modules)for(const v of m.visuals)v.imageForm='still-life';
 assert.ok(compileCreative(value,recognition,profile).skeleton); // No hard color-match or image-form quota.
 const ratios=['4:3','1:1','3:1','3:4'];const assets=Array.from({length:40},(_,i)=>({id:i?'asset-'+i:'overview',aspect:ratios[i%4]}));const batches=studioBatches(assets,aspectRatios,10);assert.ok(batches.length<=10);assert.equal(new Set(batches.flatMap(b=>b.rows.flat())).size,40);
});
test('crop accepts separate closed frames with page margins, but rejects missing or mismatched panels atomically',async()=>{
 const {cropBatch}=require('./crop.cjs'),{plan}=finished();
 const ids=plan.assets.slice(0,4).map(a=>a.id),batch={id:'framed-grid',rows:[[ids[0]],ids.slice(1)]};
 for(const asset of plan.assets)delete asset.artwork;
 plan.batches=[batch,...studioBatches(plan.assets.slice(4),aspectRatios,5).map((b,i)=>({...b,id:'remaining-'+i}))];
 validatePlan(plan);
 // Geometry calibration only: four flat rectangles surrounded by separate
 // magenta frames on a pale page, with an unrelated magenta mark inside.
 const frame=(x,y,w,h,color)=>`<rect x="${x}" y="${y}" width="${w+16}" height="${h+16}" fill="#ff00ff"/><rect x="${x+8}" y="${y+8}" width="${w}" height="${h}" fill="${color}"/>`;
 const panels=frame(24,24,480,360,'#24567a')+[24,192,360].map((x,i)=>frame(x,424,144,144,['#112233','#446655','#bbccdd'][i])).join('');
 const sheet=async(extra='',height=608)=>sharp(Buffer.from(`<svg width="544" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="544" height="${height}" fill="#eeeade"/>${panels}<rect x="240" y="160" width="22" height="22" fill="#ff00ff"/>${extra}</svg>`)).png().toBuffer();
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-framed-crop-'));
 try{
  const bytes=await sheet(),report=await cropBatch(bytes,plan,batch.id,dir,batch);
  assert.equal(report.separatorDetection,'closed-frames');assert.equal(report.newGenerationCalls,0);
  assert.deepEqual(report.crops.map(c=>c.assetId),ids);
  const saved=ids.map(id=>fs.readFileSync(path.join(dir,'assets',id+'.png')));
  for(let i=0;i<ids.length;i++){
   const {data,info}=await sharp(saved[i]).raw().toBuffer({resolveWithObject:true});
   const rgb=index=>[data[index],data[index+1],data[index+2]];
   assert.notDeepEqual(rgb(0),[255,0,255]);assert.notDeepEqual(rgb((info.width-1)*info.channels),[255,0,255]);
   assert.ok(report.crops[i].detectedRect.top>24);
  }
  const main=await sharp(saved[0]).raw().toBuffer();let magenta=0;
  for(let i=0;i<main.length;i+=3)if(main[i]===255&&main[i+1]===0&&main[i+2]===255)magenta++;
  assert.equal(magenta,22*22,'An isolated magenta object remains in the content');
  const gap=await sheet('<rect x="240" y="24" width="16" height="12" fill="#eeeade"/>');
  await assert.rejects(cropBatch(gap,plan,batch.id,dir,batch),/识别到/);
  const extra=await sheet(frame(24,624,144,144,'#aabbcc'),808);
  await assert.rejects(cropBatch(extra,plan,batch.id,dir,batch),/识别到/);
  await assert.rejects(cropBatch(bytes,plan,batch.id,dir,{...batch,rows:[ids.slice(0,2),ids.slice(2)]}),/识别到/);
  ids.forEach((id,i)=>assert.deepEqual(fs.readFileSync(path.join(dir,'assets',id+'.png')),saved[i]));
  const pinkContent=await sharp(Buffer.from(`<svg width="544" height="608" xmlns="http://www.w3.org/2000/svg"><rect width="544" height="608" fill="#eeeade"/>${panels.replace('#24567a','#f0d1e7')}</svg>`)).png().toBuffer();
  const pinkReport=await cropBatch(pinkContent,plan,batch.id,dir,batch);
  assert.ok(Object.values(pinkReport.crops[0].boundaryTrim).every(n=>n<=4),'Pale content must not become a separator flood');
  const center=await sharp(path.join(dir,'assets',ids[0]+'.png')).extract({left:100,top:100,width:1,height:1}).removeAlpha().raw().toBuffer();
  assert.deepEqual([...center],[240,209,231]);
 }finally{if(!path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe cleanup');fs.rmSync(dir,{recursive:true,force:true});}
});
test('crop jointly handles color drift, page margins and row/column layouts',async()=>{
 const {cropBatch}=require('./crop.cjs'),{plan:base}=finished();
 const available=base.assets.filter(a=>a.aspect==='1:1').slice(0,4).map(a=>a.id);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-separator-matrix-'));
 try{
  for(const counts of [[1,3],[2,1,1],[2,2],[1,2,1],[1]])for(const variant of ['rose-frames','gradient-frames-jpeg','mixed-grid','internal-rose']){
   const plan=structuredClone(base),ids=available.slice(0,counts.reduce((a,b)=>a+b,0));let cursor=0;
   const batch={id:'matrix',rows:counts.map(n=>ids.slice(cursor,cursor+=n))};
   for(const asset of plan.assets)delete asset.artwork;
   plan.batches=[batch,...studioBatches(plan.assets.filter(a=>!ids.includes(a.id)),aspectRatios,5).map((b,i)=>({...b,id:'rest-'+i}))];
   const width=720,frames=variant.includes('frames'),open=variant==='internal-rose',margin=frames?24:open?0:12,gap=frames?16:12,border=frames?10:0;
   const frameColor=variant==='gradient-frames-jpeg'?'url(#pink)':'#f5069b';
   const shapes=[];let top=margin;
   for(const row of batch.rows){
    const cell=Math.floor((width-margin*2-gap*(row.length-1))/row.length),size=cell-border*2;
    for(const [column] of row.entries()){
     const left=margin+column*(cell+gap);
     if(frames)shapes.push(`<rect x="${left}" y="${top}" width="${cell}" height="${cell}" fill="${frameColor}"/>`);
     shapes.push(`<rect x="${left+border}" y="${top+border}" width="${size}" height="${size}" fill="#547d91"/>`);
     if(variant.endsWith('jpeg'))shapes.push(`<rect x="${left+border+2}" y="${top+border+2}" width="${size-4}" height="${size-4}" fill="none" stroke="#fde2f7" stroke-width="2"/>`);
     if(variant==='mixed-grid'&&column)shapes.push(`<rect x="${left-gap}" y="${top}" width="${gap}" height="${cell}" fill="#f5069b"/>`);
    }
    top+=cell+gap;
   }
   const height=top-gap+margin,background=frames?'#eeeade':open?'#f5069b':'#ff00ff';
   const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="pink"><stop stop-color="#fa02af"/><stop offset="1" stop-color="#de127e"/></linearGradient></defs><rect width="${width}" height="${height}" fill="${background}"/>${shapes.join('')}</svg>`;
   const image=sharp(Buffer.from(svg));const bytes=await(variant.endsWith('jpeg')?image.jpeg({quality:93}):image.png()).toBuffer();
   let report;try{report=await cropBatch(bytes,plan,batch.id,dir,batch);}catch(error){error.message=`${counts}/${variant}: ${error.message}`;throw error;}
   assert.deepEqual(report.crops.map(c=>c.assetId),ids,`${counts}/${variant}`);
   if((variant!=='mixed-grid'||counts.some(n=>n>1))&&!(open&&ids.length===1))assert.equal(report.separatorCalibrationSource,'panel-boundaries',`${counts}/${variant}`);
   if(frames)assert.equal(report.separatorDetection,'closed-frames');
   for(const id of ids){
    const {data,info}=await sharp(path.join(dir,'assets',id+'.png')).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const edge=[];for(let x=0;x<info.width;x++)for(const y of [0,info.height-1])edge.push([x,y]);
    for(let y=0;y<info.height;y++)for(const x of [0,info.width-1])edge.push([x,y]);
    for(const [x,y] of edge){
     const i=(y*info.width+x)*3;assert.ok(!(data[i]>170&&data[i+2]>130&&data[i]-data[i+1]>8&&data[i+2]-data[i+1]>8),`${counts}/${variant}: pink border residue`);
    }
   }
  }
 }finally{if(!path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe cleanup');fs.rmSync(dir,{recursive:true,force:true});}
});
test('v2 prompt exposes the full catalog, banner roles, height and model-rendered typography',()=>{
 const {profile}=editorialFixture();const prompt=require('./studio-contract.cjs').studioPrompt(profile);for(const type of Object.keys(require('./catalog.cjs').entries).filter(t=>t!=='signboard.fullscreen'))assert.ok(prompt.includes(type));assert.match(prompt,/未勾选仍可使用/);assert.match(prompt,/4800px/);assert.match(prompt,/程序不再后贴白板/);assert.match(prompt,/text.single\/text.multiline是平台公告/);assert.match(prompt,/evidenceIds只能引用输入evidence中的product-/);assert.match(prompt,/navigation.five必须有5个visual/);
});

test('v2 resolves misplaced visual references and redundant empty evidence through explicit chosen designs',()=>{
 const {profile,value}=editorialFixture(true),ref=profile.visualSkill.referenceIds[0];
 // Numbers are unrelated: chosen design-2 is explicitly bound to original 4.
 value.content.collection[1].sourceEvidenceId='product-4';value.content.collection[3].sourceEvidenceId='product-2';
 for(const m of value.content.modules)for(const v of m.visuals)v.evidenceIds=[ref];
 const source=structuredClone(value),{skeleton,creative}=compileCreative(value,recognition,profile);
 assert.deepEqual(value,source);
 assert.deepEqual(creative.content.modules[1].visuals[0].evidenceIds,['product-4']);
 assert.equal(skeleton.plan.assets.find(a=>a.id==='overview').productReferences[0].imageIndex,4);
 assert.deepEqual(creative.content.modules.find(m=>m.type==='carousel.small').visuals[0].evidenceIds,[]);
 const empty=structuredClone(value);empty.content.modules[1].visuals[0].evidenceIds=[];
 assert.deepEqual(compileCreative(empty,recognition,profile).creative.content.modules[1].visuals[0].evidenceIds,['product-4']);
 const mixed=structuredClone(value);mixed.content.modules[1].visuals[0].evidenceIds=['product-4',ref];
 assert.deepEqual(compileCreative(mixed,recognition,profile).creative.content.modules[1].visuals[0].evidenceIds,['product-4']);
 const design=structuredClone(value);design.content.modules[1].visuals[0].evidenceIds=['design-2'];
 assert.deepEqual(compileCreative(design,recognition,profile).creative.content.modules[1].visuals[0].evidenceIds,['product-4']);
});

test('v2 non-preserved designs resolve only unique category evidence, without interpreting ID numbers',()=>{
 const {normalizeStudioContent}=require('./storefront-contract.cjs');
 const {profile,value}=editorialFixture(),ref=profile.visualSkill.referenceIds[0];
 const visual=value.content.modules[1].visuals[0];visual.evidenceIds=[ref];visual.visualPlan.designIds=['design-2','design-4'];
 const evidence=[{id:'product-9',category:'手袋'}],before=structuredClone(value);
 const result=normalizeStudioContent(value.content,profile,evidence);
 assert.deepEqual(result.modules[1].visuals[0].evidenceIds,['product-9']);assert.deepEqual(value,before);
 assert.deepEqual(normalizeStudioContent(result,profile,evidence),result);
 // Two originals of the same category do not provide a unique identity.
 assert.deepEqual(normalizeStudioContent(value.content,profile,[...evidence,{id:'product-10',category:'手袋'}]).modules[1].visuals[0].evidenceIds,[ref]);
});

test('reference normalization retains unknown IDs, explicit conflicts and unresolved product selections',()=>{
 const {normalizeStudioContent}=require('./storefront-contract.cjs'),{evidenceFor}=require('./content-plan.cjs');
 const {profile,value}=editorialFixture(true),ref=profile.visualSkill.referenceIds[0],evidence=evidenceFor(recognition,profile);
 const cases=[
  v=>{v.content.modules[1].visuals[0].evidenceIds=['unknown-reference'];},
  v=>{v.content.modules[1].visuals[0].evidenceIds=['product-1',ref];},
  v=>{v.content.modules[1].visuals[0].evidenceIds=[ref];v.content.modules[1].visuals[0].visualPlan.designIds=['design-99'];},
  v=>{v.content.modules[1].visuals[0].evidenceIds=[ref];delete v.content.collection[1].sourceEvidenceId;},
  v=>{v.content.modules[1].visuals[0].evidenceIds=[ref];v.content.collection[1].sourceEvidenceId='product-99';},
  v=>{v.content.modules[1].visuals[0].evidenceIds=[ref];v.content.modules[1].visuals[0].visualPlan.designIds=[];},
  v=>{v.content.modules[1].visuals[0].evidenceIds=[ref];v.content.collection.push(structuredClone(v.content.collection[1]));},
 ];
 for(const change of cases){
  const bad=structuredClone(value);change(bad);
  const result=normalizeStudioContent(bad.content,profile,evidence);
  assert.deepEqual(result.modules[1].visuals[0].evidenceIds,bad.content.modules[1].visuals[0].evidenceIds);
  assert.throws(()=>compileCreative(bad,recognition,profile));
 }
 const legacy=fixture(true);legacy.value.content.modules[1].visuals[0].evidenceIds=[ref];
 assert.deepEqual(normalizeStudioContent(legacy.value.content,legacy.profile,evidence),legacy.value.content);
 assert.throws(()=>compileCreative(legacy.value,recognition,legacy.profile));
});

test('v2 reports independent slot counts, names and short-page constraints together without making a plan',()=>{
 const {profile,value}=editorialFixture(true);
 value.content.modules=value.content.modules.slice(0,8);
 value.content.modules[2].type='navigation.five';value.content.modules[2].visuals.length=1;
 value.content.modules[4].visuals[0].caption='';
 value.content.modules[4].type='showcase.two';
 value.content.modules[5].visuals.length=2;
 value.content.modules[0].type='signboard.default';
 value.content.modules[0].visuals=[structuredClone(value.content.modules[1].visuals[0])];
 value.content.modules[0].visuals[0].copy.placement='center';
 const before=structuredClone(value),draft=compileCreative(value,recognition,profile,{draft:true});
 assert.equal(draft.skeleton,undefined);assert.deepEqual(value,before);
 const issues=draft.reviewContext.requiredChanges;
 assert.equal(issues.code,'STOREFRONT_STRUCTURE');
 assert.ok(issues.structureIssues.some(i=>i.component==='navigation.five'&&i.actualImages===1&&i.minImages===5));
 assert.ok(issues.structureIssues.some(i=>i.component==='showcase.three'&&i.actualImages===2));
 assert.ok(issues.structureIssues.some(i=>i.path.endsWith('caption')));
 assert.ok(issues.structureIssues.some(i=>i.component==='signboard.default'&&i.path.endsWith('copy')));
 assert.ok(issues.studioIssues.some(i=>i.includes('4800')));assert.ok(issues.studioIssues.some(i=>i.includes('16')));
 assert.throws(()=>compileCreative(value,recognition,profile),/整页结构尚未完成/);
});

test('v2 continuation keeps the latest saved revision after reference normalization and repairs structure in one call',async()=>{
 const {planCampaign}=require('./campaign-workflow.cjs'),{createHash}=require('crypto');
 const {profile,value}=editorialFixture(true),ref=profile.visualSkill.referenceIds[0];
 const bad=structuredClone(value);bad.content.modules=bad.content.modules.slice(0,8);
 bad.content.modules[2].visuals.length=1;
 for(const m of bad.content.modules)for(const v of m.visuals){v.evidenceIds=[ref];v.visualPlan.visualReference={...bad.content.reference};}
 const latest=structuredClone(bad);latest.concept='保留最新修订的主题';latest.content.modules[1].visuals[0].subject='最新修订的独立构图';
 const recognitionState={...recognition,businessScope:{summary:'手袋经营',categories:[{category:'手袋',traits:'完整包型'}],freedom:'背景构图',avoid:'不换商品'}};
 const signature=createHash('sha256').update(JSON.stringify({creative:bad,businessScope:recognitionState.businessScope,profile})).digest('hex');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-reference-structure-'));let calls=0;
 const previous=process.env.DASHSCOPE_API_KEY;process.env.DASHSCOPE_API_KEY='offline-placeholder';
 try{
  const inputs=[];for(let i=1;i<=4;i++){const file=`input-${i}.jpg`;await sharp({create:{width:100,height:100,channels:3,background:'#eee'}}).jpeg().toFile(path.join(dir,file));inputs.push({file});}
  for(const [stage,response] of [['content',bad],['design',latest]]){fs.writeFileSync(path.join(dir,stage+'-call.json'),JSON.stringify({status:'completed',finishReason:'stop'}));fs.writeFileSync(path.join(dir,stage+'-response.txt'),JSON.stringify(response));}
  fs.writeFileSync(path.join(dir,'design-input.json'),JSON.stringify({draft:bad,draftSignature:signature}));
  const run={folder:dir,state:{inputs,recognition:recognitionState,planningRequestAttempts:3,imageGenerationCallsByThisTool:0}};
  const save=(folder,state)=>fs.writeFileSync(path.join(folder,'state.json'),JSON.stringify(state));
  const options={reuse:true,setStage:()=>{},fetcher:async(url,init)=>{
   calls++;const input=JSON.parse(JSON.parse(init.body).input.messages[1].content[0].text);
   assert.equal(input.draft.concept,latest.concept);assert.equal(input.draft.content.modules[1].visuals[0].subject,latest.content.modules[1].visuals[0].subject);
   assert.deepEqual(input.draft.content.modules[1].visuals[0].evidenceIds,['product-2']);
   assert.ok(input.requiredChanges.structureIssues.length);assert.ok(input.requiredChanges.studioIssues.some(i=>i.includes('4800')));
   assert.equal(run.state.plan,undefined);
   return new Response(JSON.stringify({output:{choices:[{message:{content:[{text:JSON.stringify(value)}]},finish_reason:'stop'}]}}),{status:200});
  }};
  await planCampaign(run,profile,save,options);
  assert.equal(calls,1);assert.equal(run.state.planningRequestAttempts,4);assert.equal(run.state.imageGenerationCallsByThisTool,0);assert.ok(run.state.plan);
  assert.ok(fs.existsSync(path.join(dir,'design-attempt-2-call.json')));assert.ok(!fs.existsSync(path.join(dir,'content-attempt-2-call.json')));
  await planCampaign(run,profile,save,options);assert.equal(calls,1);
  assert.equal(fs.readFileSync(path.join(dir,'design-response.txt'),'utf8'),JSON.stringify(latest));
 }finally{if(previous===undefined)delete process.env.DASHSCOPE_API_KEY;else process.env.DASHSCOPE_API_KEY=previous;fs.rmSync(dir,{recursive:true,force:true});}
});
test('v2 reference notes may be omitted or blank, while chosen IDs and explicit creative notes stay intact',()=>{
 const {normalizeStudioContent}=require('./storefront-contract.cjs'),{referenceMetadata}=require('./visual-skill.cjs');
 for(const absent of [undefined,'',' \n\t ']){
  const {profile,value}=editorialFixture(true),other=profile.visualSkill.referenceIds.find(id=>id!==value.content.reference.id);
  value.content.reference.avoid='整套明确排除蓝色背景，不排除轮廓线';
  const same=value.content.modules[1].visuals[0],different=value.content.modules[2].visuals[0];
  same.visualPlan.visualReference={id:value.content.reference.id,borrow:absent,avoid:absent};
  different.visualPlan.visualReference={id:other,borrow:absent,avoid:absent};
  const before=structuredClone(value),{creative,skeleton}=compileCreative(value,recognition,profile);
  const sameRef=creative.content.modules[1].visuals[0].visualPlan.visualReference,otherRef=creative.content.modules[2].visuals[0].visualPlan.visualReference;
  assert.deepEqual(sameRef,creative.content.reference);
  assert.equal(otherRef.id,other);assert.equal(otherRef.borrow,referenceMetadata(profile).find(r=>r.id===other).focus);
  assert.match(otherRef.avoid,/不复制案例商品/);assert.doesNotMatch(otherRef.avoid,/蓝色/);
  assert.deepEqual(value,before);assert.ok(skeleton.plan.assets.every(a=>a.visualReference.borrow&&a.visualReference.avoid));
  assert.deepEqual(normalizeStudioContent(creative.content,profile),creative.content);
 }
 const {profile,value}=editorialFixture(true);
 value.content.reference={id:value.content.reference.id};
 const explicit=value.content.modules[1].visuals[0].visualPlan.visualReference;
 explicit.borrow='只借倾斜构图，不复制文字';explicit.avoid='保留明亮底色，排除案例道具';
 const result=compileCreative(value,recognition,profile);
 assert.deepEqual(result.creative.content.modules[1].visuals[0].visualPlan.visualReference,explicit);
 assert.match(result.creative.content.reference.avoid,/不复制案例商品/);
});

test('v2 reference defaults preserve aliases but never replace unknown choices, malformed notes or legacy contracts',()=>{
 const {profile,value}=editorialFixture(true);
 const alias=structuredClone(value);alias.content.modules[1].visuals[0].visualPlan.visualReference={id:value.content.reference.id,Borrow:'只借明暗关系',Avoid:'不借原图字样'};
 assert.deepEqual(compileCreative(alias,recognition,profile).creative.content.modules[1].visuals[0].visualPlan.visualReference,{id:value.content.reference.id,borrow:'只借明暗关系',avoid:'不借原图字样'});
 for(const reference of [
  {id:'unknown-case',borrow:'',avoid:''},
  {borrow:'仅有说明，没有选择参考',avoid:''},
  {id:value.content.reference.id,borrow:null,avoid:''},
  {id:value.content.reference.id,borrow:'已选构图',avoid:42},
  {id:value.content.reference.id,borrow:'已选构图',avoid:'字'.repeat(121)},
 ]){
  const bad=structuredClone(value);bad.content.modules[1].visuals[0].visualPlan.visualReference=reference;
  assert.throws(()=>compileCreative(bad,recognition,profile),/visualReference/);
 }
 const legacy=fixture(true);legacy.value.content.modules[1].visuals[0].visualPlan.visualReference.avoid='';
 assert.throws(()=>compileCreative(legacy.value,recognition,legacy.profile),/avoid/);
});

test('v2 saved final with blank reference notes compiles through generation preparation with zero model calls',async()=>{
 const {planCampaign}=require('./campaign-workflow.cjs'),{createHash}=require('crypto');
 const {profile,value}=editorialFixture(true),other=profile.visualSkill.referenceIds.find(id=>id!==value.content.reference.id);
 for(const m of value.content.modules)for(const v of m.visuals)v.visualPlan.visualReference={id:other,borrow:'保留本图已经选择的构图',avoid:''};
 const recognitionState={...recognition,businessScope:{summary:'手袋经营',categories:[{category:'手袋',traits:'完整包型'}],freedom:'背景构图',avoid:'不换商品'}};
 // A prior version signed this substantive draft before optional-note defaults.
 const signature=createHash('sha256').update(JSON.stringify({creative:value,businessScope:recognitionState.businessScope,profile})).digest('hex');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-reference-notes-cache-'));let calls=0;
 try{
  const inputs=[];for(let i=1;i<=4;i++){const file=`input-${i}.jpg`;await sharp({create:{width:100,height:100,channels:3,background:'#eee'}}).jpeg().toFile(path.join(dir,file));inputs.push({file});}
  for(const stage of ['content','design']){fs.writeFileSync(path.join(dir,stage+'-call.json'),JSON.stringify({status:'completed',finishReason:'stop'}));fs.writeFileSync(path.join(dir,stage+'-response.txt'),JSON.stringify(value));}
  fs.writeFileSync(path.join(dir,'design-input.json'),JSON.stringify({draft:value,draftSignature:signature}));
  const run={folder:dir,state:{inputs,recognition:recognitionState,planningRequestAttempts:3,imageGenerationCallsByThisTool:0}};
  await planCampaign(run,profile,()=>{},{reuse:true,setStage:()=>{},fetcher:async()=>{calls++;throw Error('Unexpected model request');}});
  assert.equal(calls,0);assert.equal(run.state.planningRequestAttempts,3);assert.equal(run.state.imageGenerationCallsByThisTool,0);
  assert.ok(run.state.plan.assets.every(a=>a.visualReference.id===other&&a.visualReference.borrow==='保留本图已经选择的构图'&&a.visualReference.avoid));
  const batches=buildBatches(run.state.plan,[],profile);assert.ok(batches.length);
  const prepared=await require('./visual-skill.cjs').prepareGenerationReferences(dir,batches[0].visualReferences);
  assert.ok(prepared.images.length);assert.ok(batches[0].visualReferences.every(r=>r.uses.every(u=>u.avoid)));
  assert.equal(fs.readFileSync(path.join(dir,'design-response.txt'),'utf8'),JSON.stringify(value));
 }finally{
  const relative=path.relative(os.tmpdir(),dir);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
function shortEditorialFixture(){
 const {profile,value}=editorialFixture(true);
 const banner=value.content.modules.find(m=>m.type==='carousel.small');
 for(let i=8;i<value.content.modules.length;i++)value.content.modules[i]={...structuredClone(banner),chapter:'原有章节'+i};
 const draft=compileCreative(value,recognition,profile,{draft:true});
 return {profile,value,draft,context:require('./studio-layout-repair.cjs').layoutRepairContext(draft,profile)};
}
function layoutInsertions(value,context,{short=false}={}){
 const type=short?'carousel.small':'carousel.large',variant=context.componentOptions.find(e=>e.type===type).variants.find(v=>v.images===1);
 const count=short?1:Math.ceil(context.minimumAddedHeight/variant.height),sample=value.content.modules[1].visuals[0];
 return {insertions:[{afterModuleIndex:7,modules:Array.from({length:count},(_,i)=>{
  const visual=structuredClone(sample);visual.subject='新增可见商品关系'+i;visual.visualPlan.picture='新的独立构图'+i+'：展示已选商品在自然场景中的完整轮廓和不同使用关系。';
  return {type,chapter:'新增内容'+i,message:'在已有章节后补充实际使用与搭配信息'+i,transition:'承接可见细节，进入使用关系',visuals:[visual]};
 })}]};
}
test('layout repair inserts model-authored content without changing the existing page and verifies real height',()=>{
 const {applyLayoutRepair,layoutRepairContext}=require('./studio-layout-repair.cjs');
 const {profile,value,draft,context}=shortEditorialFixture(),before=structuredClone(draft.creative);
 assert.ok(context);assert.ok(context.minimumAddedHeight>0);
 const patch=layoutInsertions(value,context),added=patch.insertions[0].modules.length;
 const repaired=applyLayoutRepair(draft.creative,context,patch),result=compileCreative(repaired,recognition,profile);
 assert.ok(require('./studio-layout.cjs').measureStudioModules(result.skeleton.plan.modules).height>=4800);
 assert.deepEqual(repaired.content.modules.slice(0,8),before.content.modules.slice(0,8));
 assert.deepEqual(repaired.content.modules.slice(8+added),before.content.modules.slice(8));
 assert.deepEqual(repaired.content.collection,before.content.collection);assert.deepEqual(repaired.style,before.style);assert.deepEqual(draft.creative,before);
 const mixed=structuredClone(draft);mixed.reviewContext.requiredChanges.studioIssues.push('另一项不符合要求');
 assert.equal(layoutRepairContext(mixed,profile),null);
 const legacy=structuredClone(profile);legacy.studio.version=1;assert.equal(layoutRepairContext(draft,legacy),null);
 const noRoom=structuredClone(profile);noRoom.studio.maxModules=value.content.modules.length;assert.equal(layoutRepairContext(draft,noRoom),null);
 assert.equal(layoutRepairContext(result,profile),null);
});
test('layout repair rejects no-op, duplicated, out-of-scope, over-budget and still-short additions',()=>{
 const {applyLayoutRepair}=require('./studio-layout-repair.cjs');
 const {profile,value,draft,context}=shortEditorialFixture(),patch=layoutInsertions(value,context),module=patch.insertions[0].modules[0];
 for(const response of [
  {insertions:[]},
  {...patch,content:{modules:[]}},
  {insertions:[{afterModuleIndex:999,modules:[module]}]},
  {insertions:[{afterModuleIndex:1,modules:[module]},{afterModuleIndex:1,modules:[module]}]},
  {insertions:[{afterModuleIndex:1,modules:[value.content.modules[1]]}]},
  {insertions:[{afterModuleIndex:1,modules:[{...module,type:'signboard.default'}]}]},
  {insertions:[{afterModuleIndex:1,modules:Array(context.remainingModules+1).fill(module)}]},
  {insertions:[{afterModuleIndex:1,modules:[{...module,visuals:Array(context.remainingImages+1).fill(module.visuals[0])}]}]},
 ])assert.throws(()=>applyLayoutRepair(draft.creative,context,response));
 const short=applyLayoutRepair(draft.creative,context,layoutInsertions(value,context,{short:true}));
 assert.throws(()=>compileCreative(short,recognition,profile),/少于4800/);
 const unknown=structuredClone(patch);unknown.insertions[0].modules[0].visuals[0].visualPlan.designIds=['design-99'];
 assert.throws(()=>compileCreative(applyLayoutRepair(draft.creative,context,unknown),recognition,profile),/未定义款式/);
});
for(const failFirst of [false,true])test(`layout continuation uses one focused request, retains valid caches and never falls back to whole-page retry (${failFirst?'failed patch':'success'})`,async()=>{
 const {planCampaign}=require('./campaign-workflow.cjs'),{createHash}=require('crypto');
 const {profile,value,draft,context}=shortEditorialFixture(),latest=structuredClone(value);latest.concept='最新已完成的整店主题';
 const recognitionState={...recognition,businessScope:{summary:'手袋经营',categories:[{category:'手袋',traits:'完整包型'}],freedom:'背景构图',avoid:'不换商品'}};
 const signature=createHash('sha256').update(JSON.stringify({creative:draft.creative,businessScope:recognitionState.businessScope,profile})).digest('hex');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-layout-repair-')),previous=process.env.DASHSCOPE_API_KEY;let calls=0;
 process.env.DASHSCOPE_API_KEY='offline-placeholder';
 try{
  const inputs=[];for(let i=1;i<=4;i++){const file=`input-${i}.jpg`;await sharp({create:{width:100,height:100,channels:3,background:'#eee'}}).jpeg().toFile(path.join(dir,file));inputs.push({file});}
  for(const [stage,response] of [['content',value],['design',latest]]){fs.writeFileSync(path.join(dir,stage+'-call.json'),JSON.stringify({status:'completed',finishReason:'stop'}));fs.writeFileSync(path.join(dir,stage+'-response.txt'),JSON.stringify(response));}
  fs.writeFileSync(path.join(dir,'design-input.json'),JSON.stringify({draft:draft.creative,draftSignature:signature}));
  const run={folder:dir,state:{inputs,recognition:recognitionState,planningRequestAttempts:3,imageGenerationCallsByThisTool:0}};
  const save=(folder,state)=>fs.writeFileSync(path.join(folder,'state.json'),JSON.stringify(state));
  const options={reuse:true,setStage:()=>{},fetcher:async(_url,init)=>{
   calls++;const request=JSON.parse(init.body),input=JSON.parse(request.input.messages[1].content[0].text);
   assert.equal(input.draft,undefined);assert.equal(input.revisionSummary,undefined);assert.equal(input.concept,latest.concept);
   assert.equal(input.layout.minimumAddedHeight,context.minimumAddedHeight);assert.equal(input.existingModules.length,value.content.modules.length);
   assert.equal(input.productAttachments.length,4);assert.ok(input.componentOptions.some(e=>e.type==='carousel.large'));
   if(failFirst&&calls===2){
    assert.match(input.validationFeedback.error,/少于4800/);
    assert.deepEqual(input.currentAdditions,layoutInsertions(value,context,{short:true}).insertions);
   }
   if(calls===1)assert.equal(run.state.plan,undefined);
   const patch=layoutInsertions(value,context,{short:failFirst&&calls===1});
   const response=input.currentAdditions?{edits:[{insertionIndex:0,moduleIndex:0,modules:patch.insertions[0].modules}]}:patch;
   return new Response(JSON.stringify({output:{choices:[{message:{content:[{text:JSON.stringify(response)}]},finish_reason:'stop'}]}}),{status:200});
  }};
  if(failFirst){
   await assert.rejects(()=>planCampaign(run,profile,save,options),/少于4800/);
   assert.equal(calls,1);assert.equal(run.state.plan,undefined);assert.ok(!fs.existsSync(path.join(dir,'design-attempt-2-call.json')));
  }
  await planCampaign(run,profile,save,options);
  const expectedCalls=failFirst?2:1;assert.equal(calls,expectedCalls);assert.equal(run.state.planningRequestAttempts,3+expectedCalls);
  assert.equal(run.state.imageGenerationCallsByThisTool,0);assert.ok(run.state.plan);
  assert.ok(fs.existsSync(path.join(dir,'layout-repair-call.json')));assert.ok(!fs.existsSync(path.join(dir,'design-attempt-2-call.json')));
  await planCampaign(run,profile,save,options);assert.equal(calls,expectedCalls);
  // Changing the saved final invalidates the old addition cache, even when its
  // module count and the initial draft's signature have stayed the same.
  latest.concept='更新后的最新整店主题';fs.writeFileSync(path.join(dir,'design-response.txt'),JSON.stringify(latest));
  await planCampaign(run,profile,save,options);assert.equal(calls,expectedCalls+1);
  assert.equal(fs.readFileSync(path.join(dir,'content-response.txt'),'utf8'),JSON.stringify(value));
 }finally{
  if(previous===undefined)delete process.env.DASHSCOPE_API_KEY;else process.env.DASHSCOPE_API_KEY=previous;
  const relative=path.relative(os.tmpdir(),dir);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));fs.rmSync(dir,{recursive:true,force:true});
 }
});
test('six/nine-item showcase aliases preserve every image in the supported three-column variant',()=>{
 const {normalizeLayoutResponse,applyLayoutRepair}=require('./studio-layout-repair.cjs');
 const {value,draft,context}=shortEditorialFixture();
 for(const [name,count] of [['showcase.six',6],['showcase.nine',9]]){
  const response={insertions:[{afterModuleIndex:1,modules:[{
   ...structuredClone(value.content.modules[5]),type:name,
   visuals:Array.from({length:count},(_,i)=>{const v=structuredClone(value.content.modules[1].visuals[0]);v.subject='新增款式展示'+i;v.visualPlan.picture='不同的新增构图'+i+'，保持已选商品的外观与真实连接。';return v;}),
  }]}]},before=structuredClone(response);
  const normalized=normalizeLayoutResponse(response,context);
  assert.equal(normalized.insertions[0].modules[0].type,'showcase.three');
  assert.deepEqual(normalized.insertions[0].modules[0].visuals,response.insertions[0].modules[0].visuals);
  const repaired=applyLayoutRepair(draft.creative,context,response);
  assert.equal(repaired.content.modules[2].type,'showcase.three');assert.equal(repaired.content.modules[2].visuals.length,count);
  assert.deepEqual(response,before);
  const mismatch=structuredClone(response);mismatch.insertions[0].modules[0].visuals.pop();
  assert.equal(normalizeLayoutResponse(mismatch,context).insertions[0].modules[0].type,name);
  assert.throws(()=>applyLayoutRepair(draft.creative,context,mismatch),/不支持模块类型/);
 }
});
test('layout validation reports unsupported type and total image budget together in readable feedback',()=>{
 const {applyLayoutRepair}=require('./studio-layout-repair.cjs');
 const {value,draft,context}=shortEditorialFixture(),response=layoutInsertions(value,context);
 response.insertions[0].modules[0].type='poster.unknown';
 const total=response.insertions.flatMap(p=>p.modules).reduce((n,m)=>n+m.visuals.length,0);
 try{
  applyLayoutRepair(draft.creative,{...context,remainingImages:1},response);assert.fail('Expected validation failure');
 }catch(error){
  assert.equal(error.code,'STUDIO_LAYOUT_REPAIR');assert.match(error.message,/poster.unknown/);assert.match(error.message,/新增图片合计/);
  assert.equal(error.repairFeedback.actualImages,total);assert.equal(error.repairFeedback.maxImages,1);
  assert.ok(error.repairFeedback.issues.length>=2);assert.doesNotMatch(error.message,/"code":|"values":/);
 }
});
test('addition edits preserve untouched modules and original anchors without mutating saved responses',()=>{
 const {reviseLayoutAdditions}=require('./studio-layout-repair.cjs');
 const previous=[{afterModuleIndex:1,modules:[{type:'poster.single',visuals:[{subject:'A'}]},{type:'poster.single',visuals:[{subject:'B'}]}]},
  {afterModuleIndex:7,modules:[{type:'showcase.three',visuals:[{subject:'C'}]}]}],before=structuredClone(previous);
 const replacement={type:'poster.two',visuals:[{subject:'D'},{subject:'E'}]};
 const result=reviseLayoutAdditions(previous,{edits:[{insertionIndex:0,moduleIndex:0,modules:[]},{insertionIndex:1,moduleIndex:0,modules:[replacement]}]});
 assert.deepEqual(result.insertions,[{afterModuleIndex:1,modules:[previous[0].modules[1]]},{afterModuleIndex:7,modules:[replacement]}]);
 assert.deepEqual(previous,before);
 for(const edits of [
  [],[{insertionIndex:99,moduleIndex:0,modules:[]}],
  [{insertionIndex:0,moduleIndex:99,modules:[]}],
  [{insertionIndex:0,moduleIndex:0,modules:[]},{insertionIndex:0,moduleIndex:0,modules:[]}],
  [{insertionIndex:0,moduleIndex:0,modules:[previous[0].modules[0]]}],
  [{insertionIndex:0,moduleIndex:0,modules:[],afterModuleIndex:10}],
 ])assert.throws(()=>reviseLayoutAdditions(previous,{edits}),/新增模块修订未完成/);
});
test('budget choices precompute valid geometry and retain only explicitly selected existing visuals',()=>{
 const {layoutBudgetOptions,applyLayoutBudgetChoice}=require('./studio-layout-repair.cjs');
 const {value,context}=shortEditorialFixture(),sample=value.content.modules[1].visuals[0];
 const additions=['poster.combo3','showcase.three','poster.single'].map((type,i)=>({afterModuleIndex:i+1,modules:[{
  type,chapter:'新增章节'+i,message:'原章节',transition:'原衔接',
  visuals:Array.from({length:[3,6,1][i]},(_,j)=>({...structuredClone(sample),subject:'新增图片'+i+'-'+j})),
 }]}));
 const limited={...context,remainingImages:9,currentHeight:3900,minimumFinalHeight:4800},before=structuredClone(additions);
 const options=layoutBudgetOptions(limited,additions);assert.ok(options.length);
 for(const option of options){
  const choice={optionId:option.id,visualIds:option.visualChoices.slice(0,option.retainImages).map(v=>v.id),message:'调整后内容',transition:'调整后衔接'};
  const result=applyLayoutBudgetChoice(additions,options,choice),modules=result.insertions.flatMap(p=>p.modules);
  assert.ok(modules.reduce((n,m)=>n+m.visuals.length,0)<=9);
  assert.ok(3900+require('./studio-layout.cjs').measureStudioModules(modules).height>=4800);
  assert.equal(3900+require('./studio-layout.cjs').measureStudioModules(modules).height,option.finalHeight);
  const kept=modules.flatMap(m=>m.visuals);assert.ok(kept.every(v=>additions.some(p=>p.modules[0].visuals.some(old=>JSON.stringify(old)===JSON.stringify(v)))));
 }
 const partial=options.find(o=>o.retainImages>0);assert.ok(partial);
 assert.throws(()=>applyLayoutBudgetChoice(additions,options,{optionId:'unknown',visualIds:[]}),/不在/);
 assert.throws(()=>applyLayoutBudgetChoice(additions,options,{optionId:partial.id,visualIds:Array(partial.retainImages).fill('visual-1'),message:'说明',transition:''}),/不同画面/);
 assert.deepEqual(additions,before);
 assert.deepEqual(layoutBudgetOptions({...limited,remainingImages:10},additions),[]);
 assert.deepEqual(layoutBudgetOptions({...limited,minimumFinalHeight:100000},additions),[]);
});
module.exports={fixture,finished,recognition,editorialFixture};

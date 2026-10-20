// Browser interaction tests use local UI and intercepted plan requests only.
// No planner/image provider is contacted and no generated shop is evaluated.
require('./test-network-guard.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {spawn}=require('child_process'),{once}=require('events'),{chromium}=require('playwright-core');
test('desktop and mobile studio explain input, preserve selections, and replace uploads, restore saved images and submit each chosen contract once',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-ui-'));
 const child=spawn(process.execPath,['--require','./test-network-guard.cjs','server.cjs'],{cwd:__dirname,windowsHide:true,env:{...process.env,PLANNER_PORT:'0',PLANNER_OUTPUT_DIR:root,DASHSCOPE_API_KEY:'',ARK_API_KEY:''},stdio:['ignore','pipe','pipe']});
 let browser;
 try{
  const address=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('UI server timeout')),10000);child.stdout.on('data',b=>{const m=b.toString().match(/http:\/\/127.0.0.1:\d+/);if(m){clearTimeout(timeout);resolve(m[0]);}});child.once('error',reject);});
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1050},locale:'zh-CN'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/config',async route=>{const response=await route.fetch();const config=await response.json();await route.fulfill({json:{...config,configured:true}});});
  let submitted=[];const id='11111111-1111-1111-1111-111111111111';
  await page.route('**/api/plan',async route=>{submitted.push(route.request().postDataJSON());await route.fulfill({status:202,json:{id,status:'needs-input',createdAt:new Date().toISOString(),workflow:{stage:'needs-input',label:'离线交互测试：请求已截获，未调用模型。'},filledAssets:[],batches:[]}});});
  await page.goto(address);await page.waitForFunction(()=>document.querySelectorAll('[name=module]').length===6);
  assert.equal(await page.locator('[name=module]:checked').count(),2);assert.equal(await page.locator('[name=module][value=signboard]').isDisabled(),true);
  await page.locator('#plan').click();assert.match(await page.locator('#form-error').innerText(),/上传至少一张/);assert.equal(submitted.length,0);
  await page.locator('#generation-mode').selectOption('jewelry');assert.equal(await page.locator('[name=style]').count(),4);await page.locator('[name=style][value=soft-gold]').check();
  const photo=fs.readFileSync(path.join(__dirname,'visual-references','studio-bags-page.png'));
  await page.locator('#screenshot').setInputFiles({name:'商品.png',mimeType:'image/png',buffer:photo});await page.waitForFunction(()=>document.querySelectorAll('.input-item').length===1);
  await page.locator('#module-settings > summary').click();await page.locator('[name=module][value=navigation]').check();await page.locator('[name=module][value=navigation]').uncheck();await page.locator('#preserve-products').check();await page.locator('#shop-name').fill('测试店铺');
  await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/plan')&&r.status()===202),page.locator('#plan').click()]);await page.waitForFunction(()=>document.querySelector('#result-badge').textContent==='需要补图'&&!document.querySelector('#plan').disabled);
  assert.equal(submitted.length,1);assert.equal(submitted[0].generationMode,'jewelry');assert.equal(submitted[0].options.styleId,'soft-gold');assert.equal(submitted[0].options.preserveProducts,true);assert.equal(submitted[0].options.modules.includes('navigation'),false);assert.equal(submitted[0].images.length,1);
  await page.locator('#clear-images').click();assert.equal(await page.locator('.input-item').count(),0);assert.equal(await page.locator('[name=style][value=soft-gold]').isChecked(),true);
  await page.locator('#screenshot').setInputFiles({name:'替换商品.png',mimeType:'image/png',buffer:photo});await page.waitForFunction(()=>document.querySelectorAll('.input-item').length===1);
  await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/plan')&&r.status()===202),page.locator('#plan').click()]);await page.waitForFunction(()=>document.querySelector('#result-badge').textContent==='需要补图'&&!document.querySelector('#plan').disabled);assert.equal(submitted.length,2);assert.equal(submitted[1].images[0].name,'替换商品.png');
  const savedProfile=require('./visual-profile.cjs').createVisualProfile('jewelry',{styleId:'soft-gold',preserveProducts:true});
  await page.route('**/api/runs/'+id,route=>route.fulfill({json:{id,status:'needs-input',generationMode:'jewelry',visualProfile:savedProfile,inputs:[{file:'input-1.jpg',name:'已保存商品.png',width:1550,height:1678,bytes:photo.length}],filledAssets:[],batches:[],workflow:{stage:'needs-input',label:'本地保存的测试任务'}}}));
  await page.route('**/runs/'+id+'/input-1.jpg',route=>route.fulfill({body:photo,contentType:'image/png'}));
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.input-item').length===1&&document.querySelector('#result-badge').textContent==='需要补图');assert.doesNotMatch(await page.locator('#input-list').innerText(),/NaN|undefined/);
  await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/plan')&&r.status()===202),page.locator('#plan').click()]);await page.waitForFunction(()=>document.querySelector('#result-badge').textContent==='需要补图'&&!document.querySelector('#plan').disabled);assert.equal(submitted.length,3);assert.match(submitted[2].images[0].data,/^data:image\/png;base64,/);
  const modules=Array.from({length:20},(_,i)=>({id:'chapter-'+i,type:'poster.single',purpose:'本地滚动校准 '+i,narrative:{chapter:'章节 '+i}}));
  await page.route('**/api/runs/'+id,route=>route.fulfill({json:{id,status:'ready',generationMode:'jewelry',visualProfile:savedProfile,inputs:[],plan:{shop:{name:'长页交互测试'},modules,assets:[{id:'calibration'}]},filledAssets:['calibration'],batches:[],preview:'/offline-scroll.html',layout:{width:483,height:5200}}}));
  await page.route('**/offline-scroll.html*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0}section{height:260px}</style>'+modules.map(m=>`<section id="${m.id}">${m.purpose}</section>`).join('')}));
  await page.reload();await page.frameLocator('#frame').locator('#chapter-19').waitFor();assert.match(await page.locator('#page-size').innerText(),/20 个模块 · 5200 px/);assert.equal(await page.locator('#download-actions').isVisible(),true);
  await page.locator('#page-outline button').nth(15).click();await page.waitForFunction(()=>document.querySelector('#preview-canvas').scrollTop>3000);assert.equal(await page.locator('#page-outline button').count(),20);
  await page.locator('#new-project').click();assert.equal(await page.locator('.input-item').count(),0);assert.equal(await page.locator('#preserve-products').isChecked(),false);assert.equal(await page.locator('[name=module]:checked').count(),2);
  await page.locator('#generation-mode').selectOption('bags');assert.equal(await page.locator('[name=style][value=soft-gold]').count(),0);assert.equal(await page.locator('[name=style][value=auto]').isChecked(),true);
  const proof=path.join(__dirname,'output','studio-ui-proof');fs.mkdirSync(proof,{recursive:true});await page.screenshot({path:path.join(proof,'desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);assert.equal(await page.locator('.create-bar').evaluate(e=>getComputedStyle(e).position),'static');await page.screenshot({path:path.join(proof,'mobile.png'),fullPage:true});
  await page.locator('#preserve-products').focus();await page.keyboard.press('Space');assert.equal(await page.locator('#preserve-products').isChecked(),true);assert.deepEqual(errors,[]);assert.equal(submitted.length,3);
 }finally{if(browser)await browser.close();if(child.exitCode===null){child.kill();await once(child,'exit');}if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe test cleanup');fs.rmSync(root,{recursive:true,force:true});}
});

import fs from 'node:fs/promises';
const out='output/wego-external-capture-20260915/formats';
await fs.mkdir(out,{recursive:true});
const targets=await(await fetch('http://127.0.0.1:19348/json/list')).json();
const target=targets.find(t=>t.type==='page'&&t.url.includes('szwego.com'));
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const pending=new Map();
ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
function call(method,params={}){return new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}));})}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function capture(name){
 const data=await evaluate(`(()=>{const props=['display','position','width','height','padding','margin','gap','border','border-radius','font-size','line-height','aspect-ratio','object-fit','grid-template-columns','flex-direction','overflow'];function walk(e){let r=e.getBoundingClientRect(),s=getComputedStyle(e);return{tag:e.tagName,class:e.className,id:e.id,text:[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim(),rect:{x:r.x,y:r.y,width:r.width,height:r.height},style:Object.fromEntries(props.map(k=>[k,s.getPropertyValue(k)])),src:e.getAttribute('src'),children:[...e.children].filter(n=>!['SCRIPT','STYLE','NOSCRIPT'].includes(n.tagName)).map(walk)}}return{url:location.href,title:document.title,text:document.body.innerText,tree:walk(document.body)}})()`);
 await fs.writeFile(out+'/'+name+'.json',JSON.stringify(data,null,2));
 const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(out+'/'+name+'.png',Buffer.from(shot.data,'base64'));
 console.log(name, data.text.slice(0,250));
}
const mode=process.argv[2];
try{
 if(mode==='capture')await capture(process.argv[3]);
 if(mode==='styles'){
  await evaluate(`document.querySelector('.native_select_title').click()`);await sleep(800);
  const names=await evaluate(`[...document.querySelectorAll('.weui_actionsheet_menu .native_select_item')].filter(e=>e.getBoundingClientRect().height>0).map(e=>e.textContent.trim())`);
  console.log('STYLES',names);
  for(const name of names){
   await evaluate(`(()=>{const e=[...document.querySelectorAll('.weui_actionsheet_menu .native_select_item')].find(e=>e.textContent.trim()===${JSON.stringify(name)}&&e.getBoundingClientRect().height>0);if(!e)throw Error('Option missing');e.click()})()`);await sleep(900);
   await capture(process.argv[3]+'-'+name);
   await evaluate(`document.querySelector('.native_select_title').click()`);await sleep(600);
  }
  await evaluate(`(()=>{const e=[...document.querySelectorAll('.weui_actionsheet_menu .native_select_item')].find(e=>e.textContent.trim()===${JSON.stringify(names[0])}&&e.getBoundingClientRect().height>0);if(e)e.click()})()`);
 }
}finally{ws.close();setTimeout(()=>process.exit(),100)}



import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const out = path.resolve('output/wego-external-capture-20260915');
await fs.mkdir(out, { recursive: true });
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'wego-ui-browser-'));
const port = 19348;
const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1',
  `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--new-window', 'https://www.szwego.com/'
], { stdio: 'ignore', windowsHide: true });
child.on('error', e => console.error(e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 60; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
  if (target) break;
  await sleep(500);
}
if (!target) throw new Error('Chrome debugging connection unavailable');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0, count = 0, currentUrl = '', lastSnapshot = '';
const calls = new Map(), requests = new Map();
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { calls.delete(id); reject(new Error(`${method} timed out`)); }, 12000);
    calls.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const isDecorate = () => currentUrl.includes('/album/decorate/');
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, /^(cookie|authorization|access_token|refresh_token|token|password|sessionid)$/i.test(k) ? '[REDACTED]' : clean(v)]));
  return value;
}
function safeUrl(raw) { const u = new URL(raw); for (const k of [...u.searchParams.keys()]) if (/token|auth|session|ticket|code/i.test(k)) u.searchParams.set(k, '[REDACTED]'); return u.href; }
async function record(event) {
  if (event.method === 'Page.frameNavigated' && !event.params.frame.parentId) currentUrl = event.params.frame.url;
  if (event.method === 'Page.navigatedWithinDocument') currentUrl = event.params.url;
  if (event.method === 'Network.responseReceived') {
    const { response:r, requestId, type } = event.params;
    if ((isDecorate() || /decorat|template/i.test(r.url)) && ['XHR','Fetch','Stylesheet'].includes(type) && /^https?:/.test(r.url)) requests.set(requestId, { url:safeUrl(r.url), status:r.status, mimeType:r.mimeType, type, pageUrl:currentUrl });
  }
  if (event.method === 'Network.loadingFinished' && requests.has(event.params.requestId)) {
    const id = event.params.requestId, metadata = requests.get(id); requests.delete(id);
    try {
      const data = await call('Network.getResponseBody', {requestId:id});
      let body = data.base64Encoded ? Buffer.from(data.body,'base64').toString('utf8') : data.body;
      try { body = clean(JSON.parse(body)); } catch {}
      const name = `response-${String(++count).padStart(5,'0')}.json`;
      await fs.writeFile(path.join(out,name), JSON.stringify({...metadata, body}, null, 2));
      await fs.appendFile(path.join(out,'index.jsonl'), JSON.stringify({file:name,...metadata})+'\n');
    } catch(e) { await fs.appendFile(path.join(out,'errors.log'), e.message+'\n'); }
  }
}
ws.onmessage = ({data}) => {
  const message = JSON.parse(data);
  if (message.id) { const pending = calls.get(message.id); if (!pending) return; clearTimeout(pending.timer); calls.delete(message.id); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result); }
  else record(message).catch(e => console.error(e.message));
};
await call('Page.enable');
await call('Runtime.enable');
await call('Network.enable', {maxTotalBufferSize:50000000, maxResourceBufferSize:10000000});
const expr = `(() => {
 const props=['display','position','width','height','color','background-color','font-family','font-size','font-weight','line-height','padding','margin','gap','border','border-radius','box-shadow','grid-template-columns','flex-direction','align-items','justify-content'];
 function walk(el) { const s=getComputedStyle(el), r=el.getBoundingClientRect(); return {tag:el.tagName.toLowerCase(),id:el.id,className:typeof el.className==='string'?el.className:'',text:[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim(),attrs:Object.fromEntries([...el.attributes].filter(a=>['src','href','alt','placeholder','type','role','aria-label'].includes(a.name)).map(a=>[a.name,a.value])),rect:{x:r.x,y:r.y,width:r.width,height:r.height},style:Object.fromEntries(props.map(p=>[p,s.getPropertyValue(p)])),children:[...el.children].filter(e=>!['SCRIPT','STYLE','NOSCRIPT'].includes(e.tagName)).map(walk)}; }
 const clone=document.documentElement.cloneNode(true); clone.querySelectorAll('script').forEach(e=>e.remove()); clone.querySelectorAll('input').forEach(e=>e.removeAttribute('value'));
 return {url:location.href,title:document.title,html:clone.outerHTML,structure:walk(document.body),stylesheets:[...document.styleSheets].map(s=>{try{return {href:s.href,rules:[...s.cssRules].map(r=>r.cssText)}}catch{return {href:s.href,crossOrigin:true}}}),images:[...document.images].map(e=>({src:e.currentSrc||e.src,alt:e.alt,width:e.naturalWidth,height:e.naturalHeight}))};
})()`;
console.log('READY: dedicated Chrome opened; waiting for user login. Capture directory: '+out);
await fs.writeFile(path.join(out,'status.json'), JSON.stringify({status:'waiting-for-login',port,out}));
let busy=false;
const timer=setInterval(async()=>{
 if(busy)return; busy=true;
 try {
  const state=await call('Runtime.evaluate',{expression:'JSON.stringify({url:location.href,title:document.title})',returnByValue:true});
  const info=JSON.parse(state.result.value); currentUrl=info.url;
  await fs.writeFile(path.join(out,'status.json'),JSON.stringify({...info,responses:count,updatedAt:new Date().toISOString()}));
  const commandPath=path.join(out,'command.json');
  try { const command=JSON.parse(await fs.readFile(commandPath,'utf8')); await fs.unlink(commandPath); if(command.action==='navigate' && new URL(command.url).hostname==='www.szwego.com') await call('Page.navigate',{url:command.url}); if(command.action==='snapshot')lastSnapshot=''; } catch(e) { if(e.code!=='ENOENT')console.error(e.message); }
  if(isDecorate() && currentUrl!==lastSnapshot) {
   const result=await call('Runtime.evaluate',{expression:expr,returnByValue:true});
   if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);
   const data=result.result.value; const prefix='page-'+Date.now();
   await fs.writeFile(path.join(out,prefix+'.html'),data.html); delete data.html;
   await fs.writeFile(path.join(out,prefix+'.json'),JSON.stringify(data,null,2));
   lastSnapshot=currentUrl; console.log('CAPTURED '+info.title+' '+prefix);
  }
 }catch(e){ console.error(e.message); }finally{busy=false;}
},3000);
ws.onclose=()=>{clearInterval(timer);process.exit(0);};
setTimeout(()=>{clearInterval(timer);ws.close();},120*60*1000);


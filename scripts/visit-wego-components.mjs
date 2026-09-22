const targets=await(await fetch('http://127.0.0.1:19347/json/list')).json();
const target=targets.find(t=>t.type==='page'&&t.url.includes('szwego.com'));
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const pending=new Map();
ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
function evaluate(expression){return new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));})}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(const [index,label] of [[0,'店铺招牌'],[2,'导航'],[3,'海报'],[4,'轮播图'],[5,'商品橱窗'],[7,'全部商品']]){
 await evaluate('history.back()');
 let ready=false;
 for(let t=0;t<20;t++){await sleep(500);const r=await evaluate(`JSON.stringify({main:location.hash.includes('decorate_main'),label:document.querySelectorAll('.componentName')[${index}]?.textContent})`);const state=JSON.parse(r.result.value);if(state.main&&state.label===label){ready=true;break}}
 if(!ready)throw Error('Main page not ready; stopped without changes');
 await evaluate(`document.querySelectorAll('.componentName')[${index}].click()`);
 await sleep(4500);
 const r=await evaluate('JSON.stringify({url:location.href,title:document.title,text:document.body.innerText.slice(0,180)})');console.log(r.result.value);
 if(!JSON.parse(r.result.value).url.includes('decorate_template_edit'))break;
}
ws.close();setTimeout(()=>process.exit(),100);

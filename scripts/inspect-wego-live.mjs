const targets=await(await fetch('http://127.0.0.1:19347/json/list')).json();
const target=targets.find(t=>t.type==='page'&&t.url.includes('szwego.com'));
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const pending=new Map();
ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
function call(method,params){return new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}));})}
const expression=process.argv[2]||'document.body.innerText';
const r=await call('Runtime.evaluate',{expression,returnByValue:true});console.log(JSON.stringify(r));ws.close();
setTimeout(()=>process.exit(),100);

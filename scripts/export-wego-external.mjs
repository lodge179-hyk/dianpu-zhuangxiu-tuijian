import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('output/wego-external-capture-20260915'), dest=path.join(root,'export');
await fs.mkdir(dest,{recursive:true});
const files=await fs.readdir(root);
const endpoints=[]; const configs=[];
function decode(v){if(typeof v==='string' && /^[\[{]/.test(v.trim())){try{return decode(JSON.parse(v))}catch{}} if(Array.isArray(v))return v.map(decode);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,decode(x)]));return v;}
for(const file of files.filter(f=>/^response-.*\.json$/.test(f))){const r=JSON.parse(await fs.readFile(path.join(root,file),'utf8'));if(new URL(r.url).pathname.includes('/decorate/')){endpoints.push({file,url:r.url,status:r.status});configs.push({source:r.url,response:decode(r.body)});}}
await fs.writeFile(path.join(dest,'decoration-config.json'),JSON.stringify(configs,null,2));
await fs.writeFile(path.join(dest,'endpoints.json'),JSON.stringify(endpoints,null,2));
const pages=[];let nodeCount=0;const css=new Set();const remote=new Set();
for(const file of files.filter(f=>/^page-.*\.json$/.test(f))){const p=JSON.parse(await fs.readFile(path.join(root,file),'utf8'));if(!p.structure)continue;function count(e){nodeCount++;e.children?.forEach(count)}count(p.structure);p.stylesheets?.forEach(s=>{s.rules?.forEach(r=>css.add(r));if(s.href)remote.add(s.href)});pages.push({file,title:p.title,url:p.url});}
await fs.writeFile(path.join(dest,'captured-styles.css'),[...css].join('\n\n'));
const downloads=[];
for(const [i,url]of [...remote].entries()){try{const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(String(r.status));const name=`external-${i+1}.css`;await fs.writeFile(path.join(dest,name),await r.text());downloads.push({url,file:name,status:r.status});}catch(e){downloads.push({url,error:e.message})}}
const summary={pages,domNodes:nodeCount,uniqueCssRules:css.size,decorationResponses:endpoints.length,stylesheets:downloads};
await fs.writeFile(path.join(dest,'manifest.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify({pages:pages.map(p=>p.title),domNodes:nodeCount,cssRules:css.size,decorationResponses:endpoints.length,externalCSS:downloads.length}));


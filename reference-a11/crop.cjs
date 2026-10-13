const fs=require('fs'),path=require('path'),sharp=require('sharp');
const dir=__dirname;
const definitions=[
 {id:'01-banner',label:'01 横幅',ratio:[3,1],subject:'大衣、包和鞋的横向组合',status:'局部构图可接受，用户确认保留',usable:true},
 {id:'02-sweatshirt',label:'02 卫衣',ratio:[1,1],subject:'炭灰色卫衣',status:'主体完整，待用户检查',usable:true},
 {id:'03-tote',label:'03 手提包',ratio:[1,1],subject:'棕色手提包',status:'主体完整，待用户检查',usable:true},
 {id:'04-shoes',label:'04 运动鞋',ratio:[1,1],subject:'白蓝色运动鞋',status:'主体完整，待用户检查',usable:true},
 {id:'05-coat',label:'05 大衣',ratio:[3,4],subject:'悬挂的燕麦色长大衣',status:'主体完整，待用户检查',usable:true},
 {id:'06-outfit',label:'06 针织搭配',ratio:[3,4],subject:'米白针织衫与炭灰长裤',status:'主体完整，待用户检查',usable:true}
];
function runs(values){const out=[];let start=null;for(let i=0;i<=values.length;i++){if(i<values.length&&values[i]){if(start===null)start=i;}else if(start!==null){if(i-start>5)out.push([start,i]);start=null;}}return out;}
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;');
function svg(w,h,content){return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><style>text{font-family:'Microsoft YaHei',Arial,sans-serif}</style>${content}</svg>`);}
async function main(){
 const source=path.join(dir,'source-sheet.png');
 const {data,info}=await sharp(source).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const {width:W,height:H,channels}=info;
 function separator(x,y){const p=(y*W+x)*channels;return data[p]>170&&data[p+2]>170&&data[p+1]<130&&data[p]-data[p+1]>75&&data[p+2]-data[p+1]>75;}
 const rows=runs(Array.from({length:H},(_,y)=>{let n=0;for(let x=0;x<W;x++)if(!separator(x,y))n++;return n/W>.12;}));
 if(rows.length!==3)throw Error('Expected three isolated photo rows; found '+rows.length);
 const boxes=[];
 rows.forEach(([y0,y1],r)=>{const cols=runs(Array.from({length:W},(_,x)=>{let n=0;for(let y=y0;y<y1;y++)if(!separator(x,y))n++;return n/(y1-y0)>.97;}));if(cols.length!==[1,3,2][r])throw Error('Unexpected photo count in row '+r);for(const [x0,x1]of cols)boxes.push({left:x0+1,top:y0+1,width:x1-x0-2,height:y1-y0-2});});
 fs.mkdirSync(path.join(dir,'crops'),{recursive:true});fs.mkdirSync(path.join(dir,'detected-panels'),{recursive:true});
 const assets=[];
 for(let i=0;i<boxes.length;i++){
  const box=boxes[i],d=definitions[i];
  const native='detected-panels/'+d.id+'.png';await sharp(source).extract(box).png().toFile(path.join(dir,native));
  // Crop a small amount to an exact target ratio; never stretch or invent pixels.
  const unit=Math.floor(Math.min(box.width/d.ratio[0],box.height/d.ratio[1]));
  const width=unit*d.ratio[0],height=unit*d.ratio[1],rect={left:box.left+Math.floor((box.width-width)/2),top:box.top+Math.floor((box.height-height)/2),width,height};
  const removedArea=1-width*height/(box.width*box.height);if(removedArea>.08)throw Error('Aspect adjustment removes over 8%: '+d.id);
  let separatorPixels=0;for(let y=rect.top;y<rect.top+rect.height;y++)for(let x=rect.left;x<rect.left+rect.width;x++)if(separator(x,y))separatorPixels++;
  if(separatorPixels)throw Error('Separator remains in '+d.id);
  const file='crops/'+d.id+'.png';await sharp(source).extract(rect).png().toFile(path.join(dir,file));
  assets.push({...d,file,detectedPanel:native,detectedRect:box,finalRect:rect,dimensions:[width,height],sourceAspect:box.width/box.height,targetAspect:d.ratio[0]/d.ratio[1],removedAreaPercent:+(removedArea*100).toFixed(3),separatorPixels,upscaled:false,subjectAssessment:'Assistant visual observation, not automated verification or user acceptance'});
 }
 const composite=[];const cellW=480,cellH=700,gap=24,margin=28,header=112,boardW=margin*2+cellW*2+gap,boardH=header+margin+3*cellH+2*gap;
 composite.push({input:svg(boardW,header,`<text x="28" y="38" font-size="25" fill="#18202c">一图生成 → 裁剪结果</text><text x="28" y="68" font-size="15" fill="#526171">1 次生图 · 6 张裁剪素材 · 横图 / 方图 / 竖图 · 未做风格确认</text><text x="28" y="94" font-size="14" fill="#526171">此图为缩放展示，独立 PNG 保留原始像素；局部构图不要求商品完整露出。</text>`),left:0,top:0});
 for(let i=0;i<assets.length;i++){
  const a=assets[i],x=margin+(i%2)*(cellW+gap),y=header+Math.floor(i/2)*(cellH+gap);
  composite.push({input:svg(cellW,cellH,`<rect width="${cellW}" height="${cellH}" rx="8" fill="white"/><text x="18" y="30" font-size="20" fill="#17212e">${esc(a.label)}</text><text x="18" y="55" font-size="13" fill="#657181">${a.dimensions.join(' × ')} px · ${a.ratio.join(':')} · 未放大</text><text x="18" y="${cellH-24}" font-size="14" fill="${a.usable?'#416955':'#a44828'}">${esc(a.status)}</text>`),left:x,top:y});
  const thumb=await sharp(path.join(dir,a.file)).resize({width:444,height:570,fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});composite.push({input:thumb.data,left:x+Math.floor((cellW-thumb.info.width)/2),top:y+76+Math.floor((570-thumb.info.height)/2)});
 }
 await sharp({create:{width:boardW,height:boardH,channels:3,background:'#edf0f3'}}).composite(composite).png().toFile(path.join(dir,'裁剪结果总览.png'));
 const report={source:'source-sheet.png',sourceDimensions:[W,H],expectedRows:[1,3,2],detectedRows:rows,assets,automaticChecks:{detectedPanels:6,exactAspectRatios:true,separatorPixels:0,noUpscaling:true},visualFindings:['01 大衣下沿未完整露出属于原始构图，用户已明确表示可接受；不再按缺陷处理。','其余 5 张经目视检查主体完整，最终效果由用户检验。','方图原始像素约 325–338，未验证大尺寸海报使用效果。'],userClarification:{comment:'下沿被截断我觉得没问题啊',rule:'局部构图可接受，不要求所有商品完整露出；裁剪关注重要内容误切、邻图串入与分隔色残留。',acceptedAspect:'01 banner partial coat framing',wholeSetStyleAccepted:false},newImageGenerationCalls:1,croppingMethod:'Detect actual solid-magenta separator bands; trim one edge pixel; center-crop minimally to target ratio; no model used during cropping',deferred:['Style selection','HTML integration','Customer download feature']};
 fs.writeFileSync(path.join(dir,'crop-report.json'),JSON.stringify(report,null,2));
 const run=JSON.parse(fs.readFileSync(path.join(dir,'run.json'),'utf8'));Object.assign(run,{status:'generation-and-cropping-complete',croppedAssets:6,visuallyCompleteSubjects:5,acceptedPartialCompositions:1,sourceFramingIssues:0,successCriteria:['Six independent photos; partial product framing is acceptable per user clarification','No adjacent-panel fragments or visible separator strips','Record actual dimensions and ratio errors without hidden stretching'],report:'crop-report.json',preview:'裁剪结果总览.png',htmlIntegrated:false,downloadFeatureImplemented:false,styleApproved:false});fs.writeFileSync(path.join(dir,'run.json'),JSON.stringify(run,null,2));
 console.log(JSON.stringify({source:[W,H],assets:assets.map(a=>({id:a.id,dimensions:a.dimensions,removedAreaPercent:a.removedAreaPercent,separatorPixels:a.separatorPixels,usable:a.usable})),preview:'裁剪结果总览.png'}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});

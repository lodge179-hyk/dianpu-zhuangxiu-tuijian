import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {validateAnalysis,layout,cropProducts,render} from '../scripts/decoration-assisted/core.mjs';

test('拒绝无法定位的商品，不猜测、不继续生图',()=>{
  assert.throws(()=>validateAnalysis({products:[]}));
  assert.throws(()=>validateAnalysis({products:[{box:{x:.9,y:0,w:.2,h:.2}}]}));
  assert.throws(()=>validateAnalysis({products:[{box:{x:0,y:0,w:NaN,h:.2}}]}));
});
test('增加海报只延长页面，不缩放已有模块；所有小组件有唯一名称且在父区域内',()=>{
  const short=layout(3,1),long=layout(3,3);
  assert.equal(long.height-short.height,550);
  assert.equal(new Set(long.nodes.map(n=>n.id)).size,long.nodes.length);
  for(const n of long.nodes){
    const p=n.parent?long.nodes.find(x=>x.id===n.parent):{x:0,y:0,w:long.width,h:long.height};
    assert.ok(p && n.x>=p.x-.001 && n.y>=p.y-.001 && n.x+n.w<=p.x+p.w+.001 && n.y+n.h<=p.y+p.h+.001,n.id);
  }
  for(const n of short.nodes.filter(n=>n.id.startsWith('shop_header')||n.id.startsWith('category_navigation'))){assert.deepEqual(long.nodes.find(x=>x.id===n.id),n);}
  assert.equal(long.nodes.find(n=>n.id==='product_showcase.card_1.image').w,111);
});
test('真实像素裁切、长图输出、特殊文字安全和源文件保留',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'decoration-check-'));
  try{
    const source=await sharp({create:{width:400,height:800,channels:3,background:'#306030'}}).png().toBuffer();
    const data=validateAnalysis({shopName:'A&B<店>',products:[{name:'测试商品',category:'测试',box:{x:0,y:0,w:1,h:.5}}]});
    await cropProducts(source,data,dir);
    await sharp(source).resize(800,600).toFile(path.join(dir,'banner.png'));
    const spec=await render(data,dir,3),meta=await sharp(path.join(dir,'preview.png')).metadata();
    assert.equal(meta.width,1095);assert.equal(meta.height,spec.height*3);assert.ok(meta.height>4000);
    const svg=await readFile(path.join(dir,'preview.svg'),'utf8');assert.ok(svg.includes('A&amp;B&lt;店&gt;'));
    assert.equal((await sharp(path.join(dir,'product-0.png')).metadata()).width,400);
  }finally{await rm(dir,{recursive:true,force:true});}
});

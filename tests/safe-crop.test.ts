import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { adaptOriginal, protectedCrop } from "../server/safe-crop";

const view = (box: {left:number;top:number;width:number;height:number}) => ({image:"source",confidence:.95,box});
test("无可信保护区域不裁切；同尺寸完整保留可直接使用", () => {
  assert.equal(protectedCrop({width:600,height:1000},{width:100,height:100}),undefined);
  assert.deepEqual(protectedCrop({width:600,height:600},{width:100,height:100}),{left:0,top:0,width:600,height:600});
});
test("裁切覆盖边缘保护区域，不能为了满铺切掉鞋底", () => {
  const crop=protectedCrop({width:600,height:1000},{width:100,height:100},view({left:.2,top:.65,width:.6,height:.3}))!;
  assert.ok(crop.top+crop.height>=950);assert.ok(crop.top<=650);
  assert.equal(protectedCrop({width:600,height:1000},{width:100,height:100},view({left:.2,top:.05,width:.6,height:.9})),undefined);
});
test("圆形导航额外检查四角，保护区域不能被圆形遮罩切掉", () => {
  assert.equal(protectedCrop({width:600,height:600},{width:100,height:100},view({left:0,top:0,width:1,height:1}),true),undefined);
  assert.ok(protectedCrop({width:600,height:600},{width:100,height:100},view({left:.3,top:.3,width:.4,height:.4}),true));
});
test("优先安全的其他角度；全部不安全时保留原始比例并标记风险",async()=>{
  const portrait=await sharp({create:{width:60,height:100,channels:3,background:"#256b3e"}}).png().toBuffer();
  const square=await sharp({create:{width:100,height:100,channels:3,background:"#376b4e"}}).png().toBuffer();
  const selected=await adaptOriginal([{name:"portrait",bytes:portrait},{name:"square",bytes:square}],{width:100,height:100});
  assert.equal(selected.adaptation.sourceFilename,"square");assert.equal(selected.adaptation.verdict,"pass");
  const risk=await adaptOriginal([{name:"portrait",bytes:portrait}],{width:100,height:100});
  const meta=await sharp(risk.bytes).metadata();assert.equal(meta.width,60);assert.equal(meta.height,100);assert.equal(risk.adaptation.mode,"preserved");assert.equal(risk.adaptation.verdict,"risk");
});

import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

test("恢复验证文件后才切换版本，缺失文件不改变任务", async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),"restore-qa-")); process.env.MVP_DATA_DIR=root;
 const {taskSchema}=await import("../lib/mvp-contract");
 const store=await import("../server/task-store"); const {restoreAsset}=await import("../server/queue");
 try {
 const task=taskSchema.parse({id:"restore",revision:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:"completed",progress:100,brief:"商品装修测试目标",visualDescription:"自然柔光",products:[1,2,3].map(i=>({id:"p"+i,name:"商品"+i,isHero:i===1,images:[i+".jpg"]})),assets:[{id:"a",moduleId:"sign",productId:"p1",role:"hero",ratio:"1:1",route:"direct",status:"ready",verdict:"pass",initialVerdict:"reject",currentVersion:2,previousVersion:1}]});
 await store.createTask(task);
 await assert.rejects(restoreAsset(task.id,"a",0),/缺失或损坏/);
 assert.equal((await store.readTask(task.id)).revision,0);
 const dir=path.join(store.assetRoot,"a"); await mkdir(dir,{recursive:true});
 await writeFile(path.join(dir,"1.jpg"),await sharp({create:{width:32,height:32,channels:3,background:"red"}}).jpeg().toBuffer());
 const result=await restoreAsset(task.id,"a",0);
 assert.equal(result.assets[0].currentVersion,1); assert.equal(result.assets[0].previousVersion,2);
 assert.equal(result.assets[0].verdict,"risk"); assert.equal(result.assets[0].approvedRisk,false);
 assert.equal(result.assets[0].initialVerdict,"reject"); assert.equal(result.assetEvents?.at(-1)?.kind,"restored");
 } finally {await rm(root,{recursive:true,force:true});}
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MvpTask } from "../lib/mvp-contract";

test("任务存储持久化且拒绝过期 revision，拒绝后服务锁仍可继续使用", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "weigou-mvp-")); process.env.MVP_DATA_DIR = directory;
  const store = await import(`../server/task-store.ts?test=${Date.now()}`);
  const now = new Date().toISOString(); const task: MvpTask = { id: "one", revision: 0, createdAt: now, updatedAt: now, status: "draft", progress: 0, brief: "测试经营目标内容", visualDescription: "自然光低饱和", products: [1, 2, 3].map((number) => ({ id: `p${number}`, name: `商品${number}`, isHero: number === 1, images: [`${number}.jpg`] })), styleReferences: [], productAnalyses: [], plans: [], assets: [], modelCalls: [] };
  try {
    await store.createTask(task); const updated = await store.updateTask(task.id, (current: MvpTask) => ({ ...current, progress: 10 }), 0); assert.equal(updated.revision, 1);
    await assert.rejects(store.updateTask(task.id, (current: MvpTask) => current, 0), (error: { statusCode?: number }) => error.statusCode === 409);
    const recovered = await store.updateTask(task.id, (current: MvpTask) => ({ ...current, progress: 20 }), 1); assert.equal(recovered.revision, 2); assert.equal((await store.readTask(task.id)).progress, 20);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

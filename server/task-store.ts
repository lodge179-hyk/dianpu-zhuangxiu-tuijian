import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { auditTaskUpdate } from "./task-audit";
import { taskSchema, type MvpTask } from "../lib/mvp-contract";

const root = path.resolve(process.env.MVP_DATA_DIR ?? "./data");
const locks = new Map<string, Promise<unknown>>();
const taskFile = (id: string) => path.join(root, "tasks", `${id}.json`);
export const uploadRoot = path.join(root, "uploads");
export const assetRoot = path.join(root, "assets");

export async function initializeStore() { await Promise.all([mkdir(path.join(root, "tasks"), { recursive: true }), mkdir(uploadRoot, { recursive: true }), mkdir(assetRoot, { recursive: true })]); }
export async function readTask(id: string) { return taskSchema.parse(JSON.parse(await readFile(taskFile(id), "utf8"))); }
async function atomicWrite(task: MvpTask) {
  const target = taskFile(task.id); const temp = `${target}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(task, null, 2), "utf8");
  try {
    for (let attempt = 0; ; attempt++) {
      try { await rename(temp, target); break; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '') || attempt >= 7) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
  } catch (error) { await rm(temp, { force: true }).catch(() => undefined); throw error; }
}
export async function createTask(task: MvpTask) { await initializeStore(); const parsed = taskSchema.parse(task); await atomicWrite(parsed); return parsed; }
export async function listTasks() { await initializeStore(); const files = (await readdir(path.join(root, "tasks"))).filter((name) => name.endsWith(".json")); const tasks = await Promise.all(files.map(async (name) => taskSchema.parse(JSON.parse(await readFile(path.join(root, "tasks", name), "utf8"))))); return tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
export async function updateTask(id: string, updater: (task: MvpTask) => MvpTask | Promise<MvpTask>, expectedRevision?: number, review?: {verdict:"decline";note?:string}) {
  const prior = locks.get(id) ?? Promise.resolve();
  const next = prior.then(async () => {
    const current = await readTask(id);
    if (expectedRevision !== undefined && current.revision !== expectedRevision) throw Object.assign(new Error("任务已在其他位置更新，请刷新后重试"), { statusCode: 409 });
    const candidate = await updater(structuredClone(current));
    const at = new Date().toISOString();
    const updated = taskSchema.parse({ ...auditTaskUpdate(current, candidate, at, review), revision: current.revision + 1, updatedAt: at });
    await atomicWrite(updated);
    return updated;
  });
  const tracked = next.then(() => undefined, () => undefined).finally(() => { if (locks.get(id) === tracked) locks.delete(id); });
  locks.set(id, tracked);
  return next;
}

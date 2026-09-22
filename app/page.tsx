"use client";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { ChevronRight, CirclePause, ImagePlus, LayoutTemplate, LoaderCircle, Play, Plus, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import type { MvpTask } from "@/lib/mvp-contract";
import MvpTaskPreview from "@/components/mvp-task-preview";
type DraftProduct = {
    id: string;
    name: string;
    price: string;
    isHero: boolean;
    files: File[];
};
const serviceUrl = process.env.NEXT_PUBLIC_MVP_SERVICE_URL || "/mvp-service";
const blankProduct = (hero = false, id = crypto.randomUUID()): DraftProduct => ({ id, name: "", price: "", isHero: hero, files: [] });
const statusText: Record<MvpTask["status"], string> = { draft: "待开始", queued: "排队中", analyzing: "分析商品", planning: "规划结构", generating: "准备素材", checking: "检查结果", pausing: "即将暂停", paused: "已暂停", partial_failed: "部分待处理", failed: "生成失败", completed: "已完成" };
function LocalImage({ file }: { file: File }) { const [source, setSource] = useState(""); useEffect(() => { const url = URL.createObjectURL(file); setSource(url); return () => URL.revokeObjectURL(url); }, [file]); return source ? <img src={source} alt={file.name}/> : null; }
export default function Home() {
    const [products, setProducts] = useState<DraftProduct[]>(() => [blankProduct(true, "draft-1"), blankProduct(false, "draft-2"), blankProduct(false, "draft-3")]);
    const [brief, setBrief] = useState("");
    const [visual, setVisual] = useState("");
    const [testCategory, setTestCategory] = useState("");
    const [styles, setStyles] = useState<File[]>([]);
    const [tasks, setTasks] = useState<MvpTask[]>([]);
    const [current, setCurrent] = useState<MvpTask>();
    const [notice, setNotice] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const imageCount = useMemo(() => products.reduce((sum, product) => sum + product.files.length, 0), [products]);
    const valid = products.length >= 3 && products.length <= 12 && products.every((product) => product.name.trim() && product.files.length >= 1 && product.files.length <= 3) && products.filter((product) => product.isHero).length === 1 && imageCount <= 24 && brief.trim().length >= 6 && visual.trim().length >= 3;
    async function loadTasks() { try {
        const response = await fetch(`${serviceUrl}/tasks`);
        if (!response.ok)
            throw new Error();
        const value = await response.json() as {
            tasks: MvpTask[];
        };
        setTasks(value.tasks);
    }
    catch {
        setNotice("本地生成服务尚未启动，请运行 MVP 本地服务。");
    } }
    useEffect(() => { void loadTasks(); }, []);
    useEffect(() => { if (!current || ["draft", "completed", "partial_failed", "failed", "paused"].includes(current.status))
        return; const timer = window.setInterval(async () => { const response = await fetch(`${serviceUrl}/tasks/${current.id}`); if (response.ok) {
        const value = await response.json() as MvpTask;
        setCurrent(value);
        setTasks((old) => [value, ...old.filter((task) => task.id !== value.id)]);
    } }, 2000); return () => window.clearInterval(timer); }, [current]);
    const patchProduct = (id: string, patch: Partial<DraftProduct>) => setProducts((old) => old.map((product) => product.id === id ? { ...product, ...patch } : product));
    const addFiles = (id: string, event: ChangeEvent<HTMLInputElement>) => { const chosen = Array.from(event.target.files ?? []).filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 8 * 1024 * 1024); setProducts((old) => old.map((product) => product.id === id ? { ...product, files: [...product.files, ...chosen].slice(0, 3) } : product)); event.target.value = ""; };
    async function submit() { if (!valid)
        return; setSubmitting(true); setNotice(""); try {
        const form = new FormData();
        const productPayload = products.map((product) => ({ id: product.id, name: product.name, price: product.price || undefined, isHero: product.isHero, images: product.files.map((_, index) => `product-${product.id}-${index}`) }));
        products.forEach((product) => product.files.forEach((file, index) => form.append(`product-${product.id}-${index}`, file)));
        styles.forEach((file, index) => form.append(`style-${index}`, file));
        form.append("metadata", JSON.stringify({ brief, visualDescription: visual, testCategory: testCategory.trim() || undefined, products: productPayload, styleReferences: styles.map((_, index) => `style-${index}`) }));
        let response = await fetch(`${serviceUrl}/tasks`, { method: "POST", body: form });
        let payload = await response.json() as MvpTask | {
            error: string;
        };
        if (!response.ok || !("id" in payload))
            throw new Error("error" in payload ? payload.error : "任务创建失败");
        let task = payload;
        response = await fetch(`${serviceUrl}/tasks/${task.id}/run`, { method: "POST", headers: { "Content-Type": "application/json", "If-Match": String(task.revision) }, body: JSON.stringify({ revision: task.revision }) });
        payload = await response.json() as MvpTask | {
            error: string;
        };
        if (!response.ok || !("id" in payload))
            throw new Error("error" in payload ? payload.error : "任务启动失败");
        task = payload;
        setCurrent(task);
        setTasks((old) => [task, ...old]);
    }
    catch (error) {
        setNotice(error instanceof Error ? error.message : "任务创建失败");
    }
    finally {
        setSubmitting(false);
    } }
    async function action(name: "pause" | "resume") { if (!current)
        return; const response = await fetch(`${serviceUrl}/tasks/${current.id}/${name}`, { method: "POST", headers: { "Content-Type": "application/json", "If-Match": String(current.revision) }, body: JSON.stringify({ revision: current.revision }) }); const value = await response.json() as MvpTask | {
        error: string;
    }; if (response.ok && "id" in value)
        setCurrent(value);
    else
        setNotice(("error" in value ? value.error : undefined) ?? "操作失败"); }
    return <main className="mvp-workspace"><header className="mvp-top"><div className="mvp-brand"><span><LayoutTemplate size={18}/></span><div><strong>店铺装修生成</strong><small>微购原生格式 · 本机封闭测试</small></div></div><nav><a href="/metrics">测试统计</a><a href="/formats">格式验证</a><a href="/recomposition">合成验证</a></nav><div className="saved"><i />已保存到此电脑</div></header><div className="mvp-grid"><aside className="task-sidebar"><div className="side-title"><span>任务记录</span><button onClick={() => { setCurrent(undefined); setNotice(""); }}><Plus size={15}/>新任务</button></div>{tasks.length === 0 ? <p className="no-task">还没有生成记录</p> : tasks.map((task) => <button className={`task-row ${current?.id === task.id ? "active" : ""}`} key={task.id} onClick={() => setCurrent(task)}><span><strong>{task.products.find((product) => product.isHero)?.name}</strong><small>{new Date(task.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></span><i>{statusText[task.status]}</i></button>)}</aside>{!current ? <section className="create-panel"><header><span>新建装修任务</span><h1>先把商品整理清楚，再生成三套完整首页</h1><p>每件商品单独成组，系统按微购槽位比例准备素材，并检查商品身份；风险结果需人工确认。</p></header><div className="input-section"><div className="input-heading"><div><b>01</b><span><strong>商品素材</strong><small>3～12件商品，每件1～3张图</small></span></div><em>{products.length}件 · {imageCount}/24张</em></div><div className="product-list">{products.map((product, index) => <article className={product.isHero ? "hero-product" : ""} key={product.id}><div className="product-number">{String(index + 1).padStart(2, "0")}</div><div className="product-fields"><input value={product.name} onChange={(event) => patchProduct(product.id, { name: event.target.value })} placeholder="商品名称（必填）"/><input value={product.price} onChange={(event) => patchProduct(product.id, { price: event.target.value })} placeholder="价格（选填）"/><label className="hero-choice"><input type="radio" checked={product.isHero} onChange={() => setProducts((old) => old.map((item) => ({ ...item, isHero: item.id === product.id })))}/><span>{product.isHero ? "主推商品" : "设为主推"}</span></label></div><div className="mini-images">{product.files.map((file, fileIndex) => <figure key={`${file.name}-${fileIndex}`}><LocalImage file={file}/><button onClick={() => patchProduct(product.id, { files: product.files.filter((_, i) => i !== fileIndex) })}><Trash2 size={12}/></button></figure>)}{product.files.length < 3 && <label><ImagePlus size={17}/><span>加图片</span><input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(event) => addFiles(product.id, event)}/></label>}</div>{products.length > 3 && <button className="remove-product" onClick={() => setProducts((old) => old.filter((item) => item.id !== product.id))}><Trash2 size={14}/></button>}</article>)}</div>{products.length < 12 && <button className="add-product" onClick={() => setProducts((old) => [...old, blankProduct()])}><Plus size={15}/>添加一件商品</button>}</div><div className="test-category-field"><label>商品品类（选填，用于任务统计）</label><input value={testCategory} onChange={(event) => setTestCategory(event.target.value)} maxLength={50} placeholder="例如：女装、鞋靴、食品包装"/></div><div className="brief-grid"><section><div className="field-label"><b>02</b><span><strong>经营目标</strong><small>主推什么、希望顾客先看到什么</small></span></div><textarea value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="例如：夏季女装上新，主推白色罗纹短袖，希望先建立清透氛围，再引导顾客快速选色。"/></section><section><div className="field-label"><b>03</b><span><strong>视觉描述</strong><small>颜色、光线、材质与画面气质</small></span></div><textarea value={visual} onChange={(event) => setVisual(event.target.value)} placeholder="例如：自然窗光、低饱和白粉配色、干净轻盈、保留衣服真实纹理。"/></section></div><div className="style-upload"><div><b>04</b><span><strong>风格参考图</strong><small>选填，最多3张，不计入商品图数量</small></span></div><label><ImagePlus size={17}/>选择参考图<input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(event) => setStyles(Array.from(event.target.files ?? []).slice(0, 3))}/></label><em>{styles.length}/3</em></div>{notice && <p className="notice">{notice}</p>}<button className="submit-task" disabled={!valid || submitting} onClick={submit}>{submitting ? <LoaderCircle className="spin"/> : <Sparkles size={17}/>}生成三套装修方案<ChevronRight size={17}/></button></section> : <section className="task-detail"><header className="detail-head"><div><span>{current.products.find((product) => product.isHero)?.name}</span><h1>{statusText[current.status]}</h1><p>{current.currentStep ?? current.brief}</p>{current.error && <p className="notice">{current.error}</p>}</div><div className="task-actions">{["queued", "analyzing", "planning", "generating", "checking", "pausing"].includes(current.status) && <button onClick={() => action("pause")} disabled={current.status === "pausing"}><CirclePause size={16}/>暂停生成</button>}{current.status === "paused" && <button onClick={() => action("resume")}><Play size={16}/>继续生成</button>}<button onClick={() => setCurrent(undefined)}><RotateCcw size={16}/>新建任务</button></div></header><div className="progress-line"><i style={{ width: `${current.progress}%` }}/><span>{current.progress}%</span></div><MvpTaskPreview task={current} onUpdate={(value) => { setCurrent(value); setTasks((old) => [value, ...old.filter((item) => item.id !== value.id)]); }} onNotice={setNotice}/></section>}</div></main>;
}

# 当前实施说明

后续执行以 MVP_DEFINITION.md 与 EXECUTION_PLAN.md 为准。下文保留历史交接；其中“选择与导出”、逐素材暂停、原图直接通过等描述已由新实施规则替代。单列修复已由用户认可。

# 店铺装修推荐 MVP — Astra 会话交接

更新时间：2026-09-11

## 1. 用户最终目标

做一个不同于“织境”的独立装修生成产品：用户上传商品图并填写经营目标、视觉描述，系统自动分析商品、规划装修模块、生成所需图片，并拼接为三套接近微购相册真实装修格式的完整首页，供用户比较、选择和导出。

用户可以接受“第二档”视觉还原：不要求像素级复刻微购编辑器，但模块结构、比例、间距、铺图规则和整体观感必须接近微购实际装修，不能只是概念稿。

## 2. 已由用户确认的产品与 UI 规则

- 店铺招牌唯一置顶；正文包含 3–8 个模块。
- 允许同类模块重复。
- 模块左上角、右上角不得出现标题、“全部”、跳转按钮等额外文字。
- 任何模块右上角不得出现心形点赞/收藏图标。
- 海报和轮播图直接铺满模块，不留上下左右空白。
- 同一海报模块内图片之间仅有 1px 白线。
- 海报与轮播紧邻时，模块之间也只有 1px 白线；其他模块可因自身结构产生留白。
- 海报组合图的槽位本身不得变形；每个槽位使用 `object-fit: cover`，组合布局承担裁切。
- 单列商品橱窗应参考 MVP 前已经验收过的 `/formats` UI，不应出现竖图缩窄居中及大面积左右白边。
- 所有 6 类、22 种装修格式结构已经通过人工验收：3 种招牌、3 种轮播、2 种导航、4 种商品橱窗、7 种海报、3 种公告文本。
- 新模块内容与视觉验证通过；三套完整首页重新合成均被用户判定“愿意采用”。
- 产品流程验证通过：上传商品图 → 填写装修需求 → 等待生成 → 比较三套方案 → 选择与导出。

## 3. 当前 MVP 已实现

### 前端

- 本地工作台：首页 `http://localhost:5173/`。
- 新建任务：3–12 件商品，每件 1–3 张，最多 24 张；指定一个主推商品。
- 输入经营目标、视觉描述、可选风格参考图和测试品类。
- 展示任务历史、实时进度、暂停/继续、三案切换。
- 每套方案展示完整手机首页、方案逻辑、模块清单、模型调用次数和估算费用。
- 素材支持：风险放行、人工不合格、重新生成、手工换图、恢复上一版本。
- 方案选择受素材质量门禁约束。

### 服务与模型编排

- 本地任务服务：`http://127.0.0.1:5174`。
- 真实商品分析、三案规划、图片生成、视觉质检均已接入方舟。
- 本地 `.env.local` 已配置且被 Git 忽略；不要输出密钥。
- 商品分析与视觉质检使用最低推理强度，避免 JSON 输出不完整。
- Windows 原子 JSON 写入对 `EPERM/EACCES/EBUSY` 有退避重试。
- 生图尺寸满足 Seedream：短边至少 1024、32 倍数、最长边不超过 4096、总面积不超过 4,624,220。
- 生图只发送主参考图，避免多参考图诱发内部拼贴/分屏。
- 质检是一张主参考图对一张结果图，明确拒绝宫格、拼贴、分屏、画中画和多联图。
- 身份敏感商品连续两次无法保留品牌/包装身份时，自动回退原商品图。
- 账户余额错误有熔断：任务进入可恢复暂停，不继续浪费调用。

## 4. 已完成的真实模型验证

真实任务 ID：`b0e21e30-83e7-4fd0-bf41-52f7367c37fe`

- 三套方案、15 个去重素材。
- 最终 15/15 素材 ready/pass，任务 completed。
- 原先 10 张内部拼贴的模型素材经单参考图补跑后，人工抽查均为单一连续画面。
- Saint Laurent 身份敏感素材两次失败后自动回退原图，品牌标识得到保留。
- 这次任务经历多轮协议故障和重跑，不能作为正常成本/耗时基线。

## 5. 自动验证状态

- `npm run test:mvp`：9/9 通过。
- `npx tsc --noEmit`：通过。
- `npm run build`：通过。
- 批量清单 `validation/batch-manifest.json` 的 check-only 曾通过 10/10。
- 尚未执行干净的 1 个基线任务与后续 10 个真实任务；原计划先过人工视觉门禁，再测正常耗时、首轮通过率和成本。

## 6. 当前最重要的未解决问题

用户反复反馈：第一套“氛围叙事型”里的单列商品橱窗视觉上仍然没有变化，仍不像 MVP 前的参考 UI。

最近一次修改：

- `components/mvp-task-preview.tsx` 增加按模块类型渲染的 `renderModule`，为招牌、轮播和公告补齐原生层。
- 删除模块 article 上由 `containerRatio` 强制设置的内联 `aspectRatio`。
- `app/mvp-actions.css` 被重写，使 MVP 预览规则尽量对齐 `app/formats/style.css`：
  - 单列橱窗 9px 外留白；
  - 内容图 1:1、`width:100%`、`object-fit:cover`；
  - 信息区位于图下；
  - 海报、导航、轮播、招牌和公告规则一并对齐。

浏览器隔离实测得到：

- `.type-showcase.variant-single` 模块宽 376px，高 406px，padding 9px；
- `.slot-grid` 宽 358px，高 387px；
- 商品图 358×358px，`object-fit: cover`；
- `.product-native` 宽 358px、高 29px、顶部 padding 4px。

服务返回的 `/app/mvp-actions.css` 已确认含新版规则；返回的组件源码也含 `renderModule` 并已移除内联 aspect ratio。技术上新代码已加载，但用户在 `http://localhost:5173/?ui=baseline-v2` 仍明确表示“模块还是没变化”。因此不能再把问题归因于缓存，也不能凭尺寸宣布正确。

### Astra 下一步建议

1. 直接查看用户当前界面截图，明确用户所谓“没变化”具体指：图片裁切、卡片宽度、商品信息样式、模块左右边界，还是对“单列”的理解不同。
2. 对照真实参考文件，而不只对照演示页 CSS：
   - `C:\Users\Administrator\Desktop\装修格式\商品橱窗\单列.png`
   - 以及 `C:\Users\Administrator\Desktop\装修格式\商品橱窗\单列\` 下的大图参考。
3. 将真实参考、`/formats` 渲染、MVP 当前渲染三者并排截图比较，测量边距、图片宽高、信息区位置和裁切区域。
4. 检查当前任务使用的资产是否本身已经是带白边/画布的图片。CSS 的 `cover` 只能裁切图像边缘，无法消除图片像素内部已有的白边；这可能是用户视觉上认为“没变化”的真正原因。
5. 如果是生成资产内部留白，应修正该素材的生成/适配管线或重新做 deterministic crop，而不是继续改外层 CSS。
6. UI 基线应抽成共享模块组件/样式，由 `/formats` 和 MVP 结果页真正共用，避免再次出现两套相似但不同的 DOM/CSS。目前只是人工复制规则，还不是真正的共享实现。
7. 每次开发修改必须继续追加 `DEVELOPMENT_LOG.md`。

## 7. 当前方案结构

第一套“氛围叙事型”：

- `shopSign.default`
- `poster.combo1`
- `text.multiLine`
- `showcase.single` ← 当前争议模块
- `carousel.medium`
- `text.singleLine`
- `navigation.four`

第二套“快速选购型”：

- `shopSign.minimal`
- `poster.single`
- `navigation.five`
- `showcase.triple`
- `text.link`
- `carousel.small`

第三套“商品聚焦型”：

- `shopSign.classic`
- `showcase.slider`
- `text.multiLine`
- `poster.double`
- `showcase.double`
- `carousel.large`
- `text.singleLine`
- `navigation.four`

## 8. 关键文件

- `components/mvp-task-preview.tsx` — 当前 MVP 手机预览渲染。
- `app/mvp-actions.css` — 当前 MVP 模块及素材审核样式。
- `app/globals.css` — 工作台和手机预览基础布局。
- `app/formats/page.tsx`、`app/formats/style.css` — MVP 前人工验收参考页面。
- `lib/store-formats.ts` — 6 类 22 种格式注册表和槽位比例。
- `server/queue.ts` — 生成、质检、重试、回退与余额熔断。
- `server/analyzer.ts`、`server/planner.ts`、`server/task-store.ts`。
- `DEVELOPMENT_LOG.md` — 全部开发记录。
- `validation/batch-manifest.json`、`scripts/run-validation-batch.mjs`。
- `tests/model-pipeline.test.ts` 等测试文件。

## 9. 本地运行

项目路径：`H:\店铺装修推荐`

启动前先确认 5173/5174 未被旧进程占用，然后运行：

```powershell
C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-2\npm.cmd run dev:mvp
```

健康检查：

- 首页：`http://localhost:5173/`
- 服务：`http://127.0.0.1:5174/health`

不要在项目目录内放 Chrome `--user-data-dir`。此前 `.chrome-qa` 触发 Vite 持续监听和大量 HMR，已停止诊断 Chrome 并删除该临时目录。

## 10. 对下一会话的明确要求

- 不要继续告诉用户“代码已生效所以应该正确”；用户已明确否定当前视觉结果。
- 先取得视觉证据，再判断是 UI 容器问题还是图片像素内部留白问题。
- 修复应以真实微购参考图片和用户已通过的 MVP 前 UI 为准。
- 不要新产生付费模型调用，除非确认问题位于生成资产且需要重生成，并先说明会产生调用。
- 保持本地服务运行，修改后让用户直接复验。

## 11. Astra 接手后的更新（2026-09-11）

已确认并修复第 6 节的问题：白边由 queue.ts 的 original/contain 适配写入图片，而非缓存。真实任务争议资产已升级到版本 3（版本 2 可恢复），模型调用维持 127。四种商品橱窗已抽为 StoreShowcase，验收页与 MVP 真正共用，其他五类模块尚未整体抽取。本地对照：`http://localhost:5173/validation/showcase-comparison.html`。10/10 测试、类型检查、构建通过；详细证据见 DEVELOPMENT_LOG.md 最新条目。等待用户复验视觉结果，不应继续将旧版本 2 的补白归因于 CSS。

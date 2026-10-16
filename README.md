# 微购相册店铺装修推荐验证项目

接手当前项目请先读 [项目目标与架构交接](AGENT_HANDOFF.md)（更新于 2026-10-16）。当前开发主线是 `experiments/store-decoration/planning/`，本机运行于 5184，包含通用、珠宝、数码与鞋履模式。

下文保留各历史阶段的记录；旧的“当前版本”、启动入口和待办状态需结合日期理解。最新架构、工作副本路径与协作约束以交接文档及实际代码为准。

当前目标：帮助不懂装修的客户看懂店铺的整体装修效果，再逐步提供可使用的装修素材。

## 分支实验：AI 规划模块与素材批次

`codex/store-planning-workflow` 增加独立的[装修规划入口](experiments/store-decoration/planning/README.md)：上传截图由 AI 安排模块、素材复用及最多两张生图总图；也可导入其他 AI 的方案。生成总图后上传，程序检测边界、裁剪并填入已有固定组件。

在 `experiments/store-decoration/planning/` 执行 `npm ci`、`npm start`，打开 `http://127.0.0.1:5182`。可先使用“查看已存素材示例”，无需模型配置。截图规划读取本机配置，生图仍由执行 AI 完成。本分支尚未合并；A13 原预览及历史应用保持原样，实际效果由用户检验。

## 当前版本：固定组件＋批量生图裁剪＋完整长页（2026-10-13）

版本标签：`v0.2.0-preview.1`。当前用户认可的演示保存在 [experiments/store-decoration](experiments/store-decoration/README.md)。克隆仓库后，直接打开其中的 [完整长页预览](experiments/store-decoration/a13-complete-store/完整长页-批量素材预览.html)，无需 API Key 或启动服务。

- 23 种固定模块样式；完整长页展示 22 个模块实例、19 种样式，覆盖招牌、导航、公告、海报、轮播和商品橱窗。
- 两次素材总图生成，程序检测边界、裁剪并复用素材，填入固定 HTML 组件。UI 不再由生图模型重新绘制。
- 当前示例的清晰度、比例和整体效果已获用户正向反馈；风格未定稿，AI 模块选择规则、截图到完整店铺的自主流程及客户下载功能尚待推进。
- 截图中的小商品图不作为必须可复用的素材来源。本例商品、名称和价格为装修演示内容。
- 这是可查看和回退的实验版本，还没有接入下方历史应用入口。最新演示以本节为准。

版本范围和回退方式见 [CHANGELOG.md](CHANGELOG.md)。原始 `output/`、本地环境文件及缓存继续被忽略；仅将经过筛选的演示快照放入受版本控制的目录。

## 历史应用入口：确认布局 v4（2026-10-12）

- 启动：`npm run dev:assisted`，访问 http://127.0.0.1:5181 。沿用本机 `.env.local`，不修改或上传密钥。
- 输入只有一张截图，不需要用户选择风格、模块或填写商品资料。支持 PNG/JPG/WebP，最多30MB；大图在内部规范化处理，原文件保留。
- 按 [当前页面规格](scripts/decoration-mvp/current-page-spec.md) 与 [验收规则](scripts/decoration-mvp/layout-acceptance.md) 固定结构：双绿三角招牌及平台操作栏 → 会员权益/积分商城 → 四个等大圆导航 → 4:3贴边直角轮播 → 三列竖海报 → 三列方形商品橱窗及名称、购物车。
- 应用从截图理解店铺、选品并决定风格；AI 只在指定装修区域内设计视觉内容。不得改变已确认的模块顺序、列数、控件、间距或图片比例。导航文字在图下，轮播指示点在图内，轮播与海报及三张海报之间仅细白线。
- 每个模块与内部小组件都有实际使用的布局边界；模型内部商品位置仍属于提示约束，不宣称像素级保证。未知价格留空，平台固定权益栏不代表识别到商家的额外促销承诺。
- 输出完整 PNG，以及轮播主视觉、三列海报和商品橱窗分区图。界面保留方案摘要、耗时、刷新恢复、原图对照、下载和历史记录。
- v3 的紧凑头部、推荐卡片与双列目录不符合已确认 UI，已经停用；历史记录保留并明确标记。若已有素材重新组合成 v4，会保留来源，不冒充重新生图。
- 生图失败会明确标注原素材替代或具体失败原因，不假报 AI 成功，不自动多次付费重试。
- 边界：不自动发布；低清素材与图内覆盖图标未必能恢复，生成内容仍可能改动商品外观。平台未确认的精确像素仍按参考比例近似。本轮不运行测试、浏览器验收或模型调用，由用户试用。

源代码在 `scripts/decoration-assisted/`，任务保存在已忽略的 `output/decoration-assisted/`。以下为历史模块化MVP与底层工程说明。

## 本地 MVP 启动

1. 将 `.env.example` 复制为 `.env.local`，填写方舟 API Key、视觉模型和 Seedream 模型；不要提交该文件。
2. 运行 `npm run dev:mvp`，它会同时启动 5173 端口的工作台和 5174 端口的本地任务服务。
3. 打开 `http://localhost:5173/`。任务、上传图片和生成结果保存在本机 `data/`。

未配置模型时可以验证上传、规划、队列、暂停恢复和界面；模型生成槽位会标记为风险，不能在未确认时正式选择方案。

## 首轮真实任务

- `npm run validate:batch -- --check-only`：只检查 10 个任务清单和本地图片，不调用模型、不产生费用。
- `npm run validate:batch -- --confirm-costs --budget=<已明确额度> --state=validation/batches/technical.json`：模型配置完成后按顺序执行 10 个真实任务；该命令会产生真实模型费用。
- 任务清单位于 `validation/batch-manifest.json`，当前覆盖女装、美妆礼盒、鞋靴、二手机车和跨品类难例。
- 批量生成后仍需在首页逐项处理风险并选择愿意采用的方案，最终结果在 `/metrics` 查看。

- [开发日志](./DEVELOPMENT_LOG.md)
- [可行性验证计划](./VALIDATION_PLAN.md)
- [可行性结论与 MVP 定义](./FEASIBILITY_CONCLUSION.md)
- [历史模块化 MVP 实施定义](./MVP_DEFINITION.md)

## 当前验收状态

- 本地上传、任务持久化、固定三案规划、素材队列、暂停继续、风险放行、换图/恢复及方案选择链路已实现。
- 未配置模型时，生成类素材只作为本地构图预览并标为风险，不会冒充真实模型验收结果。
- 真实生图、视觉质检以及 10 个真实任务门槛，需要在本机 `.env.local` 配置完成后执行。

## 工程运行环境

以下为底层 Vinext/Sites 工程说明；当前 MVP 不启用云端账号、D1、R2 或部署能力。

A clean full-stack starter running on [vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`
- Windows, macOS, or Linux; Git is required only for publishing, and Bash is not required for initialization or the project commands

## Sites Lifecycle

The bundled Sites initializer copies this starter into the project and runs its locked dependency install before returning the checkout. Edit the source under `app/`, use `npm run dev` for the Codex local preview, and run the project validation before hosting. The remote Sites builder also runs `npm run build` against the pushed commit. Do not rerun the dependency install unless dependencies are absent or the lockfile changed.

This starter does not use `wrangler.jsonc`.

`install:ci` runs `npm ci` once against this checkout's bundled lockfile, explicitly targeting the project and disabling parent-workspace discovery. It includes dev and optional dependencies required for builds and previews even when production/omit settings would exclude them. It defaults Sharp to prebuilt binaries unless the caller explicitly configures Sharp or a source build. It uses `--prefer-offline --no-audit --no-fund`, reuses the configured npm cache, and leaves network concurrency, retries, timeouts, and lifecycle-script policy to npm's configuration. Retain the installer session until it finishes; do not overlap installers for the same checkout.

`scripts/sites-env.mjs` preserves the caller's HOME, npm cache, proxy, XDG, and temporary-directory configuration while defaulting Wrangler and Miniflare state to the checkout. If npm reports an unwritable cache, select a writable path with `npm_config_cache` for that install. The `dev` and `start` scripts also keep Wrangler logs inside the checkout. Generated `.sites-runtime/` and `.wrangler/` directories are disposable and ignored by Git.

`npm run dev` uses `vinext dev` for the live Vite preview with HMR, starting at port 5173. Vinext records the running server in ignored `.vinext/` state and rejects another start for the same checkout while that process is alive; reuse its printed URL. It recovers stale state after a stopped process. Pass `--port <port>` or `--hostname <host>` after `npm run dev --` when needed; keep Codex previews on loopback. Like the Sites package, this relies on Vinext's advisory lock; exactly simultaneous starts can race.

The bundled Sites Vite plugin simulates ChatGPT sign-in only for loopback development requests. Visit `/signin-with-chatgpt?return_to=/` to sign in as `local_seedy` (`seedy@sites.test`, display name `Seedy`) and `/signout-with-chatgpt?return_to=/` to sign out. The development cookie preserves that identity across server restarts. This does not exercise real ChatGPT OAuth and is not included in production builds; hosted authentication remains dispatch-owned.

The Worker uses `vinext/server/fetch-handler`, including Vinext's config-aware image handling. After building, `npm start` runs that Worker locally through Wrangler on `127.0.0.1`, sharing `.wrangler/state` with dev preview and local D1 migrations; it does not deploy the site or simulate sign-in. Use the URL printed by the server. Pass `npm start -- --port <port>` to select a different built-preview port.

Local previews use Miniflare's placeholder `Request.cf` metadata without a network lookup. Set `CLOUDFLARE_CF_FETCH_ENABLED=true` to opt into fetching preview metadata; this setting does not change hosted request metadata.

Local tool usage metrics are disabled by default. Set `WRANGLER_SEND_METRICS=true` to opt in.

## Included Shape

- edit site code under `app/`
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` starts intentionally empty
- `@cloudflare/workers-types` provides Worker types; `cloudflare-env.d.ts` declares optional `DB`/`BUCKET` bindings—update these declarations if binding names change
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Use it as the durable user key; use email and name for display or contact purposes.

SIWC-authenticated workspace sites may also receive `oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty `name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by `oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use the returned `userId` as the stable user key for user-owned records; do not use email as a durable identifier.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send anonymous visitors through Sign in with ChatGPT.
- In a Server Component, start sign-in with `<a href={chatGPTSignInPath(returnTo)} target="_top">`. The auth helper module is server-only; do not import it into a Client Component.
- Do not use `fetch`, XHR, a client-side router, or a framework link that can prefetch the sign-in route. SIWC must start as a top-level navigation.
- Never request the AuthAPI authorization endpoint directly. The dispatch-owned `/signin-with-chatgpt` route must start the SIWC flow.
- Use `chatGPTSignOutPath(returnTo)` for browser sign-out links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the OAuth cookies, and identity header injection. Do not implement app routes for those reserved paths. Routes that do not import and call the helper remain anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the Sites hosting platform's access policy controls for workspace-wide restrictions, or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write actions tied to the current ChatGPT user. Leave public content anonymous.

## Local D1 migrations

For a D1-backed local preview, generate SQL with `npm run db:generate`. Build once through the Sites skill's build entrypoint (or `npm run build` for standalone use) to generate `dist/server/wrangler.json`, rebuilding if bindings change. From the project root, apply each pending migration in order:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_example.sql
```

Replace the filename with the pending migration and `DB` with your D1 binding name if different. Use `.wrangler/state`, not `.wrangler/state/v3`; Wrangler adds the versioned directories. Do not replay migrations already applied locally. This updates only the preview database; publishing applies production migrations separately.

## Diagnostic Commands

- `npm run install:ci`: perform the one locked dependency install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build the deployable Sites artifact
- `npm run start`: preview the built Worker locally with D1/R2 support
- `npm run db:generate`: generate Drizzle migrations after schema changes

When using the Sites plugin, follow its skill instructions for installation, builds, and publishing. These npm commands remain available for standalone use.

Like the Sites package, `npm run build` runs `vinext build` directly; it does not require a host `timeout` command.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)

## 当前稳定性测试

- 完整预检：`npm run validate:batch -- --check-only`，逐张解码并检查输入契约，无模型调用。
- 独立基线：`npm run validate:batch -- --baseline --limit=1 --confirm-costs --state=validation/batches/baseline.json`。这是一个单独授权的真实样本，会产生费用；未得到基线执行授权时只运行预检。
- 十任务：先确定预算并配置服务的 MVP_PRICING_FILE，再使用上面的预算命令。该表中每个数值是每次相应请求的保守预算上界；成功调用展示估算，失败/未知调用仍预留预算，不把未知实际费用当零。
- 中断后使用完全相同的清单、预算和state路径；输入SHA256不一致会拒绝继续。任务暂停需明确添加 --resume，不会自行恢复。
- 默认30分钟单任务监测上限。暂停、失败、服务断开会停止批次；幂等创建标记防止重开产生重复任务。
- 当前现有素材包含混合难例，不能宣称完成三个真实店铺品类商业验证。
- 进度与剩余要求：EXECUTION_PLAN.md；每次实施记录：DEVELOPMENT_LOG.md。

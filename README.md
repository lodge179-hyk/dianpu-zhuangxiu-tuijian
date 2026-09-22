# 微购相册店铺装修推荐验证项目

当前项目用于验证：根据用户商品图片和经营描述，自动规划可在微购复刻的店铺首页，并逐步生成对应装修素材。

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
- [当前 MVP 唯一实施定义](./MVP_DEFINITION.md)

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

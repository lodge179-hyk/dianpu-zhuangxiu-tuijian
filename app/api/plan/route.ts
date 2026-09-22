import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * The validation prototype used this endpoint for layout-only planning.
 * Keeping a clear tombstone prevents old bookmarks or cached clients from
 * silently creating plans that violate the current 6-category/22-format MVP.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "旧版规划接口已停用，请从首页创建完整 MVP 任务。",
      replacement: "/mvp-service/tasks",
    },
    { status: 410 },
  );
}

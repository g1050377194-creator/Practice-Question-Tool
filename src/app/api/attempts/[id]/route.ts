import { isSessionId, jsonError } from "@/lib/api-guards";
import { examDatabase, readAttempt } from "@/lib/server-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: RouteContext<"/api/attempts/[id]">) {
  const { id } = await ctx.params;
  if (!isSessionId(id)) return jsonError("找不到这次记录。", 404);
  try {
    const detail = readAttempt(examDatabase(), id);
    if (!detail) return jsonError("找不到这次记录。", 404);
    return Response.json(detail);
  } catch {
    return jsonError("这次记录暂时读不出来。", 500);
  }
}

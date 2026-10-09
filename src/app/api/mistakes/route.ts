import { isSubject, jsonError } from "@/lib/api-guards";
import { clearMistakes, dismissMistake, examDatabase, listMistakes } from "@/lib/server-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return Response.json({ mistakes: listMistakes(examDatabase()) });
  } catch {
    return jsonError("错题库暂时读不出来。", 500);
  }
}

export function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const questionId = params.get("questionId");
  const subject = params.get("subject");
  try {
    if (questionId) {
      if (questionId.length === 0 || questionId.length > 200) {
        return jsonError("题目编号无效。", 400);
      }
      dismissMistake(examDatabase(), questionId);
      return Response.json({ ok: true });
    }
    if (!isSubject(subject)) return jsonError("请指定科目。", 400);
    clearMistakes(examDatabase(), subject);
    return Response.json({ ok: true });
  } catch {
    return jsonError("错题库没有更新。", 500);
  }
}

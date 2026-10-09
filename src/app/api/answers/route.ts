import { isSessionId, jsonError, readAnswerList } from "@/lib/api-guards";
import { normalizeSelected } from "@/lib/grade";
import { examDatabase, recordAnswers } from "@/lib/server-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: {
    sessionId?: unknown;
    questionId?: unknown;
    selected?: unknown;
    answers?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("没有收到作答内容。", 400);
  }
  if (!isSessionId(body.sessionId)) return jsonError("这次练习的编号无效。", 400);

  let answers = body.answers === undefined ? null : readAnswerList(body.answers);
  if (body.answers === undefined) {
    if (typeof body.questionId !== "string" || body.questionId.length === 0 || body.questionId.length > 200) {
      return jsonError("题目编号无效。", 400);
    }
    const selected = normalizeSelected(body.selected);
    if (selected === null) return jsonError("选项格式无效。", 400);
    answers = [{ questionId: body.questionId, selected }];
  }
  if (!answers) return jsonError("作答列表无效。", 400);

  try {
    recordAnswers(examDatabase(), body.sessionId, answers);
  } catch {
    return jsonError("这道题没有写入错题库。", 500);
  }
  return Response.json({ ok: true });
}

import {
  isFilter,
  isSessionId,
  isSource,
  isSubject,
  jsonError,
  readIdList,
  readSelections,
} from "@/lib/api-guards";
import { examDatabase, finishAttempt, listAttempts } from "@/lib/server-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return Response.json({ attempts: listAttempts(examDatabase()) });
  } catch {
    return jsonError("历史记录暂时读不出来。", 500);
  }
}

export async function POST(request: Request) {
  let body: {
    sessionId?: unknown;
    subject?: unknown;
    filter?: unknown;
    source?: unknown;
    startedAt?: unknown;
    questionIds?: unknown;
    selections?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("没有收到这次练习的成绩。", 400);
  }
  if (!isSessionId(body.sessionId)) return jsonError("这次练习的编号无效。", 400);
  if (!isSubject(body.subject)) return jsonError("科目无效。", 400);
  if (!isFilter(body.filter)) return jsonError("题型范围无效。", 400);
  if (!isSource(body.source)) return jsonError("练习来源无效。", 400);
  if (typeof body.startedAt !== "number" || !Number.isFinite(body.startedAt)) {
    return jsonError("练习时间无效。", 400);
  }
  const questionIds = readIdList(body.questionIds);
  const selections = readSelections(body.selections);
  if (!questionIds || !selections) return jsonError("试卷内容无效。", 400);

  try {
    const attempt = finishAttempt(examDatabase(), {
      sessionId: body.sessionId,
      subject: body.subject,
      filter: body.filter,
      source: body.source,
      startedAt: body.startedAt,
      questionIds,
      selections,
    });
    return Response.json(attempt);
  } catch {
    return jsonError("这次成绩没有写入数据库。", 500);
  }
}

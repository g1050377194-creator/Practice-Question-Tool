import {
  isBankMeta,
  isQuestion,
  isSubject,
  jsonError,
} from "@/lib/api-guards";
import { clearSubject, examDatabase, readBanks, replaceBank } from "@/lib/server-db";
import type { Question } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return Response.json({ banks: readBanks(examDatabase()) });
  } catch {
    return jsonError("题库数据库暂时打不开。", 500);
  }
}

export async function PUT(request: Request) {
  let body: { meta?: unknown; questions?: unknown };
  try {
    body = (await request.json()) as { meta?: unknown; questions?: unknown };
  } catch {
    return jsonError("没有收到题库内容。", 400);
  }
  if (!isBankMeta(body.meta)) return jsonError("题库信息不完整。", 400);
  if (!Array.isArray(body.questions) || body.questions.length > 5000) {
    return jsonError("题目列表无法写入。", 400);
  }
  const questions: Question[] = [];
  for (const item of body.questions) {
    if (!isQuestion(item, body.meta.subject)) return jsonError("有一道题的格式无法写入。", 400);
    questions.push(item);
  }
  try {
    replaceBank(examDatabase(), body.meta, questions);
  } catch {
    return jsonError("题库没有写入数据库。", 500);
  }
  return Response.json({ ok: true });
}

export function DELETE(request: Request) {
  const subject = new URL(request.url).searchParams.get("subject");
  if (!isSubject(subject)) return jsonError("请指定要清空的科目。", 400);
  try {
    clearSubject(examDatabase(), subject);
  } catch {
    return jsonError("题库没有清掉。", 500);
  }
  return Response.json({ ok: true });
}

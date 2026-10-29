import { jsonError, readMistakeBackup } from "@/lib/api-guards";
import { examDatabase, importMistakeBackup } from "@/lib/server-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_BYTES) {
    return jsonError("错题库文件超过 20MB。", 413);
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return jsonError("没有收到错题库文件。", 400);
  }
  if (text.length > MAX_BYTES) return jsonError("错题库文件超过 20MB。", 413);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return jsonError("这个文件不是错题库备份。", 400);
  }
  const backup = readMistakeBackup(parsed);
  if (!backup) return jsonError("这个文件不是错题库备份。", 400);
  try {
    const result = importMistakeBackup(examDatabase(), backup);
    return Response.json(result);
  } catch {
    return jsonError("错题库没有导入。", 500);
  }
}

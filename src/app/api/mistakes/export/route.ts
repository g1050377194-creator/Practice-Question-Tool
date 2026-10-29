import { jsonError } from "@/lib/api-guards";
import { examDatabase, exportMistakeBackup } from "@/lib/server-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    const backup = exportMistakeBackup(examDatabase());
    const stamp = new Date(backup.exportedAt).toISOString().slice(0, 10);
    const filename = `mistakes-${stamp}.json`;
    return new Response(JSON.stringify(backup), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch {
    return jsonError("错题库没有导出。", 500);
  }
}

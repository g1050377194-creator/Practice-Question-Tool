import { itemsToPageText, pagesToDocument, type PdfTextItem } from "@/lib/pdf-layout";
import { parseQuestionBank } from "@/lib/parse-questions";
import type { SubjectId } from "@/lib/types";
import { extractTextItems } from "unpdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 80 * 1024 * 1024;

function isSubject(value: unknown): value is SubjectId {
  return value === "civil" || value === "management";
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "没有收到上传内容，请重新选择 PDF。" },
      { status: 400 },
    );
  }

  const subject = form.get("subject");
  const file = form.get("file");
  if (!isSubject(subject)) {
    return Response.json({ error: "请先选择科目：土建或管理。" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return Response.json({ error: "请上传 PDF 文件。" }, { status: 400 });
  }
  const name = file.name || "未命名.pdf";
  if (!name.toLowerCase().endsWith(".pdf") && file.type && file.type !== "application/pdf") {
    return Response.json({ error: "只接受 PDF 文件。" }, { status: 400 });
  }
  if (file.size <= 0) {
    return Response.json({ error: "这个 PDF 是空的。" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "PDF 超过 80MB，请先压缩或拆分后再上传。" }, { status: 400 });
  }

  let extracted: { items: PdfTextItem[][] };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await extractTextItems(bytes);
    extracted = { items: result.items as PdfTextItem[][] };
  } catch {
    return Response.json(
      { error: "无法读取这份 PDF。请确认文件没有加密、没有损坏。" },
      { status: 400 },
    );
  }

  const documentText = pagesToDocument(extracted.items.map((page) => itemsToPageText(page)));
  if (documentText.replace(/\s/g, "").length < 40) {
    return Response.json(
      {
        error:
          "这份 PDF 几乎抽不出文字，多半是扫描图片。请换可以复制文字的《600母题》PDF。",
      },
      { status: 422 },
    );
  }

  const parsed = parseQuestionBank(documentText, subject);
  if (parsed.questions.length === 0) {
    return Response.json(
      {
        error:
          "没有识别出单项或多项选择题。请确认 PDF 里有题号，以及 A、B、C、D 选项。",
        warnings: parsed.warnings,
      },
      { status: 422 },
    );
  }

  return Response.json({
    ...parsed,
    fileName: name,
  });
}

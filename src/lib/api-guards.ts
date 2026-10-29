import { normalizeSelected } from "@/lib/grade";
import type { BankMeta, Choice, MistakeBackup, MistakeRecord, ParseStats, Question, SubjectId } from "@/lib/types";

export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export function isSubject(value: unknown): value is SubjectId {
  return value === "civil" || value === "management";
}

export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9:_-]{8,80}$/.test(value);
}

export function isFilter(value: unknown): value is "all" | "single" | "multiple" {
  return value === "all" || value === "single" || value === "multiple";
}

export function isSource(value: unknown): value is "bank" | "mistakes" | "mixed" {
  return value === "bank" || value === "mistakes" || value === "mixed";
}

function isChoice(value: unknown): value is Choice {
  if (!value || typeof value !== "object") return false;
  const choice = value as Choice;
  return (
    typeof choice.key === "string" &&
    /^[A-E]$/.test(choice.key) &&
    typeof choice.text === "string" &&
    choice.text.length > 0 &&
    choice.text.length <= 4000
  );
}

export function isQuestion(value: unknown, subject: SubjectId): value is Question {
  if (!value || typeof value !== "object") return false;
  const question = value as Question;
  return (
    typeof question.id === "string" &&
    question.id.length > 0 &&
    question.id.length <= 200 &&
    question.subject === subject &&
    (question.type === "single" || question.type === "multiple") &&
    Number.isInteger(question.number) &&
    question.number >= 1 &&
    question.number <= 5000 &&
    Number.isInteger(question.order) &&
    question.order >= 0 &&
    typeof question.stem === "string" &&
    question.stem.length > 0 &&
    question.stem.length <= 8000 &&
    Array.isArray(question.options) &&
    question.options.length >= 2 &&
    question.options.length <= 8 &&
    question.options.every(isChoice) &&
    (question.answer === null ||
      (typeof question.answer === "string" && /^[A-E]{1,5}$/.test(question.answer))) &&
    (question.explanation === null ||
      (typeof question.explanation === "string" && question.explanation.length <= 20000))
  );
}

function isStats(value: unknown): value is ParseStats {
  if (!value || typeof value !== "object") return false;
  const stats = value as ParseStats;
  return (
    Number.isInteger(stats.total) &&
    Number.isInteger(stats.single) &&
    Number.isInteger(stats.multiple) &&
    Number.isInteger(stats.withAnswer) &&
    Number.isInteger(stats.withoutAnswer)
  );
}

export function isBankMeta(value: unknown): value is BankMeta {
  if (!value || typeof value !== "object") return false;
  const meta = value as BankMeta;
  return (
    isSubject(meta.subject) &&
    typeof meta.fileName === "string" &&
    meta.fileName.length > 0 &&
    meta.fileName.length <= 300 &&
    typeof meta.importedAt === "number" &&
    Number.isFinite(meta.importedAt) &&
    Array.isArray(meta.warnings) &&
    meta.warnings.every((warning) => typeof warning === "string" && warning.length <= 500) &&
    meta.warnings.length <= 50 &&
    isStats(meta.stats)
  );
}

export function readSelections(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const selections: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key.length === 0 || key.length > 200) return null;
    const selected = normalizeSelected(raw);
    if (selected === null) return null;
    selections[key] = selected;
  }
  return selections;
}

export function readAnswerList(
  value: unknown,
): { questionId: string; selected: string }[] | null {
  if (!Array.isArray(value) || value.length > 2000) return null;
  const answers: { questionId: string; selected: string }[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const row = item as { questionId?: unknown; selected?: unknown };
    if (typeof row.questionId !== "string" || row.questionId.length === 0 || row.questionId.length > 200) {
      return null;
    }
    const selected = normalizeSelected(row.selected);
    if (selected === null) return null;
    answers.push({ questionId: row.questionId, selected });
  }
  return answers;
}

export function readIdList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 2000) return null;
  if (
    !value.every((id) => typeof id === "string" && id.length > 0 && id.length <= 200)
  ) {
    return null;
  }
  return value;
}

export function readMistakeBackup(value: unknown): MistakeBackup | null {
  if (!value || typeof value !== "object") return null;
  const backup = value as { kind?: unknown; version?: unknown; exportedAt?: unknown; items?: unknown };
  if (backup.kind !== "erzao-mistakes" || backup.version !== 1) return null;
  if (!Array.isArray(backup.items) || backup.items.length > 2000) return null;
  const items: MistakeRecord[] = [];
  for (const raw of backup.items) {
    const item = readMistakeItem(raw);
    if (!item) return null;
    items.push(item);
  }
  return {
    kind: "erzao-mistakes",
    version: 1,
    exportedAt: typeof backup.exportedAt === "number" && Number.isFinite(backup.exportedAt) ? backup.exportedAt : Date.now(),
    items,
  };
}

function readMistakeItem(value: unknown): MistakeRecord | null {
  if (!value || typeof value !== "object") return null;
  const item = value as {
    question?: unknown;
    wrongCount?: unknown;
    correctStreak?: unknown;
    lastSelected?: unknown;
    lastWrongAt?: unknown;
    events?: unknown;
  };
  if (!item.question || typeof item.question !== "object") return null;
  const subject = (item.question as { subject?: unknown }).subject;
  if (subject !== "civil" && subject !== "management") return null;
  if (!isQuestion(item.question, subject)) return null;
  if (!Number.isInteger(item.wrongCount) || (item.wrongCount as number) < 1 || (item.wrongCount as number) > 100000) {
    return null;
  }
  if (!Number.isInteger(item.correctStreak) || (item.correctStreak as number) < 0 || (item.correctStreak as number) > 2) {
    return null;
  }
  const lastSelected = normalizeSelected(item.lastSelected);
  if (lastSelected === null) return null;
  if (typeof item.lastWrongAt !== "number" || !Number.isFinite(item.lastWrongAt)) return null;
  if (!Array.isArray(item.events) || item.events.length > 20) return null;
  const events: MistakeRecord["events"] = [];
  for (const rawEvent of item.events) {
    if (!rawEvent || typeof rawEvent !== "object") return null;
    const event = rawEvent as { selected?: unknown; createdAt?: unknown };
    const selected = normalizeSelected(event.selected);
    if (selected === null) return null;
    if (typeof event.createdAt !== "number" || !Number.isFinite(event.createdAt)) return null;
    events.push({ selected, createdAt: event.createdAt });
  }
  return {
    question: item.question,
    wrongCount: item.wrongCount as number,
    correctStreak: item.correctStreak as number,
    lastSelected,
    lastWrongAt: item.lastWrongAt,
    events,
  };
}

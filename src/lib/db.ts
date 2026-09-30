import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { BankMeta, Question, SubjectId } from "@/lib/types";

export type PracticeFilter = "all" | "single" | "multiple";

export type PracticeSession = {
  subject: SubjectId;
  filter: PracticeFilter;
  limit: number | "all";
  questionIds: string[];
  selections: Record<string, string>;
  revealed: string[];
  index: number;
  finished: boolean;
  review: boolean;
  startedAt: number;
};

interface ExamDB extends DBSchema {
  questions: {
    key: string;
    value: Question;
    indexes: { "by-subject": SubjectId };
  };
  meta: {
    key: SubjectId;
    value: BankMeta;
  };
  session: {
    key: string;
    value: PracticeSession;
  };
}

const DB_NAME = "erzao-600";
const DB_VERSION = 1;

let databasePromise: Promise<IDBPDatabase<ExamDB>> | null = null;

function database() {
  if (!databasePromise) {
    databasePromise = openDB<ExamDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const questions = db.createObjectStore("questions", { keyPath: "id" });
        questions.createIndex("by-subject", "subject");
        db.createObjectStore("meta");
        db.createObjectStore("session");
      },
    });
  }
  return databasePromise;
}

export async function readBank(subject: SubjectId): Promise<{
  meta: BankMeta | null;
  questions: Question[];
}> {
  const db = await database();
  const [meta, questions] = await Promise.all([
    db.get("meta", subject),
    db.getAllFromIndex("questions", "by-subject", subject),
  ]);
  questions.sort(
    (a, b) => (a.order ?? a.number) - (b.order ?? b.number) || a.number - b.number,
  );
  return { meta: meta ?? null, questions };
}

export async function writeBank(
  meta: BankMeta,
  questions: Question[],
): Promise<void> {
  const db = await database();
  const tx = db.transaction(["questions", "meta", "session"], "readwrite");
  const existing = await tx.objectStore("questions").index("by-subject").getAllKeys(meta.subject);
  await Promise.all(existing.map((key) => tx.objectStore("questions").delete(key)));
  await Promise.all(questions.map((question) => tx.objectStore("questions").put(question)));
  await tx.objectStore("meta").put(meta, meta.subject);
  const session = await tx.objectStore("session").get("current");
  if (session?.subject === meta.subject) await tx.objectStore("session").delete("current");
  await tx.done;
}

export async function clearBank(subject: SubjectId): Promise<void> {
  const db = await database();
  const tx = db.transaction(["questions", "meta", "session"], "readwrite");
  const existing = await tx.objectStore("questions").index("by-subject").getAllKeys(subject);
  await Promise.all(existing.map((key) => tx.objectStore("questions").delete(key)));
  await tx.objectStore("meta").delete(subject);
  const session = await tx.objectStore("session").get("current");
  if (session?.subject === subject) await tx.objectStore("session").delete("current");
  await tx.done;
}

export async function readSession(): Promise<PracticeSession | null> {
  const db = await database();
  return (await db.get("session", "current")) ?? null;
}

export async function writeSession(session: PracticeSession): Promise<void> {
  const db = await database();
  await db.put("session", session, "current");
}

export async function clearSession(): Promise<void> {
  const db = await database();
  await db.delete("session", "current");
}

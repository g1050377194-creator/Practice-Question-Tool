import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gradeAnswer, normalizeSelected, type Verdict } from "@/lib/grade";
import type {
  AttemptDetail,
  AttemptSummary,
  BankMeta,
  Choice,
  MistakeRecord,
  ParseStats,
  Question,
  QuestionType,
  SubjectId,
} from "@/lib/types";

export type ExamDB = DatabaseSync;

type GradedVerdict = Exclude<Verdict, "pending">;

type QuestionRow = {
  id: string;
  subject: SubjectId;
  type: QuestionType;
  number: number;
  sort_order: number;
  stem: string;
  options_json: string;
  answer: string | null;
  explanation: string | null;
};

type BankRow = {
  subject: SubjectId;
  file_name: string;
  imported_at: number;
  warnings_json: string;
  stats_json: string;
};

type AttemptRow = {
  id: string;
  subject: SubjectId;
  filter: AttemptSummary["filter"];
  source: AttemptSummary["source"];
  question_count: number;
  correct_count: number;
  wrong_count: number;
  ungraded_count: number;
  started_at: number;
  finished_at: number;
};

type AnswerRow = {
  question_id: string;
  number: number;
  type: QuestionType;
  stem: string;
  selected: string;
  answer: string | null;
  explanation: string | null;
  verdict: GradedVerdict;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS banks (
  subject TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  imported_at INTEGER NOT NULL,
  warnings_json TEXT NOT NULL,
  stats_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  type TEXT NOT NULL,
  number INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  stem TEXT NOT NULL,
  options_json TEXT NOT NULL,
  answer TEXT,
  explanation TEXT
);

CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject, sort_order);

CREATE TABLE IF NOT EXISTS mistakes (
  question_id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  wrong_count INTEGER NOT NULL,
  last_selected TEXT NOT NULL,
  last_wrong_at INTEGER NOT NULL,
  active INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mistakes_subject ON mistakes(subject, active, last_wrong_at);

CREATE TABLE IF NOT EXISTS mistake_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  selected TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mistake_events_question ON mistake_events(question_id, created_at);

CREATE TABLE IF NOT EXISTS answer_log (
  session_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  selected TEXT NOT NULL,
  verdict TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, question_id)
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  filter TEXT NOT NULL,
  source TEXT NOT NULL,
  question_count INTEGER NOT NULL,
  correct_count INTEGER NOT NULL,
  wrong_count INTEGER NOT NULL,
  ungraded_count INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempts_finished ON attempts(finished_at);

CREATE TABLE IF NOT EXISTS attempt_answers (
  attempt_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  number INTEGER NOT NULL,
  type TEXT NOT NULL,
  stem TEXT NOT NULL,
  selected TEXT NOT NULL,
  answer TEXT,
  explanation TEXT,
  verdict TEXT NOT NULL,
  PRIMARY KEY (attempt_id, question_id),
  FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE
);
`;

const DEFAULT_PATH = path.join(process.cwd(), "data", "erzao.sqlite");

let singleton: ExamDB | null = null;

function withTransaction<T>(db: ExamDB, run: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = run();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function openExamDatabase(filePath: string): ExamDB {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export function examDatabase(): ExamDB {
  if (!singleton) {
    singleton = openExamDatabase(process.env.ERZAO_DB_PATH ?? DEFAULT_PATH);
  }
  return singleton;
}

function emptyBanks(): Record<SubjectId, { meta: BankMeta | null; questions: Question[] }> {
  return {
    civil: { meta: null, questions: [] },
    management: { meta: null, questions: [] },
  };
}

function rowToQuestion(row: QuestionRow): Question {
  return {
    id: row.id,
    subject: row.subject,
    type: row.type,
    number: row.number,
    order: row.sort_order,
    stem: row.stem,
    options: JSON.parse(row.options_json) as Choice[],
    answer: row.answer,
    explanation: row.explanation,
  };
}

function readQuestion(db: ExamDB, id: string): Question | null {
  const row = db.prepare("SELECT * FROM questions WHERE id = ?").get(id) as QuestionRow | undefined;
  return row ? rowToQuestion(row) : null;
}

function applyLog(
  db: ExamDB,
  sessionId: string,
  question: Question,
  selected: string,
  verdict: GradedVerdict,
  now: number,
): void {
  const inserted = db
    .prepare(
      `INSERT INTO answer_log (session_id, question_id, selected, verdict, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id, question_id) DO NOTHING`,
    )
    .run(sessionId, question.id, selected, verdict, now);
  if (inserted.changes === 0) return;
  if (verdict === "wrong") {
    db.prepare(
      `INSERT INTO mistakes (question_id, subject, wrong_count, last_selected, last_wrong_at, active)
       VALUES (?, ?, 1, ?, ?, 1)
       ON CONFLICT(question_id) DO UPDATE SET
         subject = excluded.subject,
         wrong_count = wrong_count + 1,
         last_selected = excluded.last_selected,
         last_wrong_at = excluded.last_wrong_at,
         active = 1`,
    ).run(question.id, question.subject, selected, now);
    db.prepare(
      `INSERT INTO mistake_events (session_id, question_id, subject, selected, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(sessionId, question.id, question.subject, selected, now);
    return;
  }
  if (verdict === "correct") {
    db.prepare("UPDATE mistakes SET active = 0 WHERE question_id = ?").run(question.id);
  }
}

export function readBanks(db: ExamDB): Record<SubjectId, { meta: BankMeta | null; questions: Question[] }> {
  const banks = emptyBanks();
  const metas = db.prepare("SELECT * FROM banks").all() as BankRow[];
  for (const row of metas) {
    if (row.subject !== "civil" && row.subject !== "management") continue;
    banks[row.subject].meta = {
      subject: row.subject,
      fileName: row.file_name,
      importedAt: row.imported_at,
      warnings: JSON.parse(row.warnings_json) as string[],
      stats: JSON.parse(row.stats_json) as ParseStats,
    };
  }
  const questions = db
    .prepare("SELECT * FROM questions ORDER BY subject, sort_order, number")
    .all() as QuestionRow[];
  for (const row of questions) {
    if (row.subject !== "civil" && row.subject !== "management") continue;
    banks[row.subject].questions.push(rowToQuestion(row));
  }
  return banks;
}

export function replaceBank(db: ExamDB, meta: BankMeta, questions: Question[]): void {
  const insert = db.prepare(
    `INSERT INTO questions (
       id, subject, type, number, sort_order, stem, options_json, answer, explanation
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  withTransaction(db, () => {
    db.prepare("DELETE FROM questions WHERE subject = ?").run(meta.subject);
    for (const question of questions) {
      insert.run(
        question.id,
        meta.subject,
        question.type,
        question.number,
        question.order,
        question.stem,
        JSON.stringify(question.options),
        question.answer,
        question.explanation,
      );
    }
    db.prepare(
      `INSERT INTO banks (subject, file_name, imported_at, warnings_json, stats_json)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(subject) DO UPDATE SET
         file_name = excluded.file_name,
         imported_at = excluded.imported_at,
         warnings_json = excluded.warnings_json,
         stats_json = excluded.stats_json`,
    ).run(
      meta.subject,
      meta.fileName,
      meta.importedAt,
      JSON.stringify(meta.warnings),
      JSON.stringify(meta.stats),
    );
    db.prepare(
      `DELETE FROM mistake_events
       WHERE subject = ?
         AND question_id NOT IN (SELECT id FROM questions WHERE subject = ?)`,
    ).run(meta.subject, meta.subject);
    db.prepare(
      `DELETE FROM mistakes
       WHERE subject = ?
         AND question_id NOT IN (SELECT id FROM questions WHERE subject = ?)`,
    ).run(meta.subject, meta.subject);
  });
}

export function clearSubject(db: ExamDB, subject: SubjectId): void {
  withTransaction(db, () => {
    db.prepare("DELETE FROM questions WHERE subject = ?").run(subject);
    db.prepare("DELETE FROM banks WHERE subject = ?").run(subject);
    db.prepare("DELETE FROM mistake_events WHERE subject = ?").run(subject);
    db.prepare("DELETE FROM mistakes WHERE subject = ?").run(subject);
  });
}

export function listMistakes(db: ExamDB): Record<SubjectId, MistakeRecord[]> {
  const mistakes: Record<SubjectId, MistakeRecord[]> = { civil: [], management: [] };
  const rows = db
    .prepare(
      `SELECT m.wrong_count, m.last_selected, m.last_wrong_at, q.*
       FROM mistakes m
       JOIN questions q ON q.id = m.question_id
       WHERE m.active = 1
       ORDER BY m.last_wrong_at DESC`,
    )
    .all() as (QuestionRow & {
    wrong_count: number;
    last_selected: string;
    last_wrong_at: number;
  })[];
  const events = db
    .prepare(
      `SELECT question_id, selected, created_at
       FROM mistake_events
       ORDER BY created_at DESC`,
    )
    .all() as { question_id: string; selected: string; created_at: number }[];
  const history = new Map<string, { selected: string; createdAt: number }[]>();
  for (const event of events) {
    const list = history.get(event.question_id) ?? [];
    if (list.length >= 20) continue;
    list.push({ selected: event.selected, createdAt: event.created_at });
    history.set(event.question_id, list);
  }
  for (const row of rows) {
    const question = rowToQuestion(row);
    mistakes[question.subject].push({
      question,
      wrongCount: row.wrong_count,
      lastSelected: row.last_selected,
      lastWrongAt: row.last_wrong_at,
      events: history.get(question.id) ?? [],
    });
  }
  return mistakes;
}

export function dismissMistake(db: ExamDB, questionId: string): void {
  db.prepare("UPDATE mistakes SET active = 0 WHERE question_id = ?").run(questionId);
}

export function clearMistakes(db: ExamDB, subject: SubjectId): void {
  withTransaction(db, () => {
    db.prepare("DELETE FROM mistake_events WHERE subject = ?").run(subject);
    db.prepare("DELETE FROM mistakes WHERE subject = ?").run(subject);
  });
}

export function recordAnswers(
  db: ExamDB,
  sessionId: string,
  answers: { questionId: string; selected: string }[],
): void {
  withTransaction(db, () => {
    const now = Date.now();
    for (const item of answers) {
      const question = readQuestion(db, item.questionId);
      if (!question) continue;
      const selected = normalizeSelected(item.selected) ?? "";
      const verdict = gradeAnswer(question.answer, selected, true);
      if (verdict === "pending") continue;
      applyLog(db, sessionId, question, selected, verdict, now);
    }
  });
}

export type FinishAttemptInput = {
  sessionId: string;
  subject: SubjectId;
  filter: AttemptSummary["filter"];
  source: AttemptSummary["source"];
  startedAt: number;
  questionIds: string[];
  selections: Record<string, string>;
};

function mapAttempt(row: AttemptRow): AttemptSummary {
  return {
    id: row.id,
    subject: row.subject,
    filter: row.filter,
    source: row.source,
    questionCount: row.question_count,
    correctCount: row.correct_count,
    wrongCount: row.wrong_count,
    ungradedCount: row.ungraded_count,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function finishAttempt(db: ExamDB, input: FinishAttemptInput): AttemptSummary {
  return withTransaction(db, () => {
    const existing = db.prepare("SELECT * FROM attempts WHERE id = ?").get(input.sessionId) as
      | AttemptRow
      | undefined;
    if (existing) return mapAttempt(existing);

    const now = Date.now();
    let correct = 0;
    let wrong = 0;
    let ungraded = 0;
    const answers: {
      position: number;
      question: Question;
      selected: string;
      verdict: GradedVerdict;
    }[] = [];

    input.questionIds.forEach((id, position) => {
      const question = readQuestion(db, id);
      if (!question || question.subject !== input.subject) return;
      const selected = normalizeSelected(input.selections[id] ?? "") ?? "";
      const verdict = gradeAnswer(question.answer, selected, true);
      if (verdict === "pending") return;
      applyLog(db, input.sessionId, question, selected, verdict, now);
      if (verdict === "correct") correct += 1;
      else if (verdict === "wrong") wrong += 1;
      else ungraded += 1;
      answers.push({ position, question, selected, verdict });
    });

    db.prepare(
      `INSERT INTO attempts (
         id, subject, filter, source, question_count, correct_count, wrong_count,
         ungraded_count, started_at, finished_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.sessionId,
      input.subject,
      input.filter,
      input.source,
      answers.length,
      correct,
      wrong,
      ungraded,
      input.startedAt,
      now,
    );
    const insertAnswer = db.prepare(
      `INSERT INTO attempt_answers (
         attempt_id, question_id, position, number, type, stem, selected, answer, explanation, verdict
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of answers) {
      insertAnswer.run(
        input.sessionId,
        row.question.id,
        row.position,
        row.question.number,
        row.question.type,
        row.question.stem,
        row.selected,
        row.question.answer,
        row.question.explanation,
        row.verdict,
      );
    }
    return {
      id: input.sessionId,
      subject: input.subject,
      filter: input.filter,
      source: input.source,
      questionCount: answers.length,
      correctCount: correct,
      wrongCount: wrong,
      ungradedCount: ungraded,
      startedAt: input.startedAt,
      finishedAt: now,
    } satisfies AttemptSummary;
  });
}

export function listAttempts(db: ExamDB): AttemptSummary[] {
  const rows = db
    .prepare("SELECT * FROM attempts ORDER BY finished_at DESC LIMIT 200")
    .all() as AttemptRow[];
  return rows.map(mapAttempt);
}

export function readAttempt(db: ExamDB, id: string): AttemptDetail | null {
  const row = db.prepare("SELECT * FROM attempts WHERE id = ?").get(id) as AttemptRow | undefined;
  if (!row) return null;
  const answers = db
    .prepare("SELECT * FROM attempt_answers WHERE attempt_id = ? ORDER BY position")
    .all(id) as AnswerRow[];
  return {
    ...mapAttempt(row),
    answers: answers.map((answer) => ({
      questionId: answer.question_id,
      number: answer.number,
      type: answer.type,
      stem: answer.stem,
      selected: answer.selected,
      answer: answer.answer,
      explanation: answer.explanation,
      verdict: answer.verdict,
    })),
  };
}

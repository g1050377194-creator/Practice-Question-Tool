import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gradeAnswer } from "./grade";
import {
  clearSubject,
  finishAttempt,
  listAttempts,
  listMistakes,
  openExamDatabase,
  readBanks,
  recordAnswers,
  replaceBank,
  type ExamDB,
} from "./server-db";
import type { BankMeta, Question } from "./types";

function tempDatabase(): ExamDB {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erzao-db-"));
  return openExamDatabase(path.join(dir, "test.sqlite"));
}

function question(id: string, answer: string | null, number = 1): Question {
  return {
    id,
    subject: "civil",
    type: "single",
    number,
    order: number - 1,
    stem: `题干 ${number}`,
    options: [
      { key: "A", text: "甲" },
      { key: "B", text: "乙" },
    ],
    answer,
    explanation: "解析",
  };
}

function meta(): BankMeta {
  return {
    subject: "civil",
    fileName: "土建.pdf",
    importedAt: 1,
    warnings: [],
    stats: { total: 2, single: 2, multiple: 0, withAnswer: 2, withoutAnswer: 0 },
  };
}

test("有标准答案才计分，未作答算错", () => {
  assert.equal(gradeAnswer("A", "A", true), "correct");
  assert.equal(gradeAnswer("AB", "A", true), "wrong");
  assert.equal(gradeAnswer("A", "", true), "wrong");
  assert.equal(gradeAnswer(null, "A", true), "ungraded");
  assert.equal(gradeAnswer("A", "A", false), "pending");
});

test("答错进入错题库，做对后移出，再错会带着次数回来", () => {
  const db = tempDatabase();
  const first = question("civil:1:single:a:0", "A", 1);
  const second = question("civil:2:single:b:1", "B", 2);
  replaceBank(db, meta(), [first, second]);

  recordAnswers(db, "session-1", [{ questionId: first.id, selected: "B" }]);
  recordAnswers(db, "session-1", [{ questionId: first.id, selected: "B" }]);
  let mistakes = listMistakes(db).civil;
  assert.equal(mistakes.length, 1);
  assert.equal(mistakes[0]?.wrongCount, 1);
  assert.equal(mistakes[0]?.events.length, 1);
  assert.equal(mistakes[0]?.lastSelected, "B");

  recordAnswers(db, "session-2", [{ questionId: first.id, selected: "A" }]);
  assert.equal(listMistakes(db).civil.length, 0);

  recordAnswers(db, "session-3", [{ questionId: first.id, selected: "" }]);
  mistakes = listMistakes(db).civil;
  assert.equal(mistakes.length, 1);
  assert.equal(mistakes[0]?.wrongCount, 2);
  assert.equal(mistakes[0]?.events.length, 2);
  db.close();
});

test("交卷写入历史，已经记过的错题不会重复计数", () => {
  const db = tempDatabase();
  const first = question("civil:1:single:a:0", "A", 1);
  const second = question("civil:2:single:b:1", "B", 2);
  replaceBank(db, meta(), [first, second]);
  recordAnswers(db, "session-9", [{ questionId: first.id, selected: "B" }]);

  const attempt = finishAttempt(db, {
    sessionId: "session-9",
    subject: "civil",
    filter: "all",
    source: "bank",
    startedAt: 10,
    questionIds: [first.id, second.id],
    selections: { [first.id]: "B" },
  });
  assert.equal(attempt.correctCount, 0);
  assert.equal(attempt.wrongCount, 2);
  assert.equal(listMistakes(db).civil.length, 2);
  assert.equal(listMistakes(db).civil.find((item) => item.question.id === first.id)?.wrongCount, 1);

  finishAttempt(db, {
    sessionId: "session-9",
    subject: "civil",
    filter: "all",
    source: "bank",
    startedAt: 10,
    questionIds: [first.id, second.id],
    selections: { [first.id]: "B" },
  });
  assert.equal(listAttempts(db).length, 1);
  assert.equal(listMistakes(db).civil.find((item) => item.question.id === first.id)?.wrongCount, 1);
  db.close();
});

test("重新导入题库时，已经不在卷子里的错题会被清掉", () => {
  const db = tempDatabase();
  const first = question("civil:1:single:a:0", "A", 1);
  const second = question("civil:2:single:b:1", "B", 2);
  replaceBank(db, meta(), [first, second]);
  recordAnswers(db, "session-4", [
    { questionId: first.id, selected: "B" },
    { questionId: second.id, selected: "A" },
  ]);
  replaceBank(db, { ...meta(), stats: { ...meta().stats, total: 1 } }, [first]);
  const banks = readBanks(db);
  assert.equal(banks.civil.questions.length, 1);
  assert.deepEqual(
    listMistakes(db).civil.map((item) => item.question.id),
    [first.id],
  );
  clearSubject(db, "civil");
  assert.equal(readBanks(db).civil.questions.length, 0);
  assert.equal(listMistakes(db).civil.length, 0);
  db.close();
});

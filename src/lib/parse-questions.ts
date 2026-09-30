import type {
  Choice,
  ParseResult,
  Question,
  QuestionType,
  SubjectId,
} from "@/lib/types";

type SectionKind = "single" | "multiple" | "unknown";

type Draft = {
  number: number;
  sectionKind: SectionKind;
  stem: string;
  options: Choice[];
  answer: string | null;
  explanation: string | null;
};

type KeyEntry = {
  number: number;
  answer: string;
  explanation: string | null;
  kind: SectionKind;
};

const QUESTION_LEAD =
  /^(?:母题|变式题|变式|经典真题|真题)\s*(\d{1,4})\b\s*(.*)$/;
const CHAPTER_LEAD = /^第\s*(\d{1,4})\s*题\s*(.*)$/;
const NUMBERED_LEAD = /^(\d{1,4})\s*[.、)）]\s*(.*)$/;
const ANSWER_LETTERS = "[A-E](?:\\s*[、,，]?\\s*[A-E]){0,4}";
const ANSWER_LABEL =
  "(?:【\\s*)?(?:参\\s*考|正\\s*确)?\\s*答\\s*案\\s*(?:】)?\\s*[:：]?\\s*";

function normalizeDocument(input: string): string {
  return input
    .replace(/\u0000/g, "")
    .replace(/\u00a0|\u3000/g, " ")
    .replace(/\u200b/g, "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(/．/g, ".")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]*(\d{1,4})[ \t]*[.、)）][ \t]*/gm, "$1. ")
    .replace(/^[ \t]*([A-E])[ \t]*[.、)）:：][ \t]*/gm, "$1. ");
}

function isNoiseLine(line: string): boolean {
  const text = line.trim();
  if (!text) return true;
  if (/^\d{1,4}$/.test(text)) return true;
  if (/^第\s*\d+\s*页(?:\s*共\s*\d+\s*页)?$/.test(text)) return true;
  if (/^[-—–_]{2,}\s*\d+\s*[-—–_]{2,}$/.test(text)) return true;
  if (
    text.length < 32 &&
    /600\s*母题|二造土建|二造管理|二级造价工程师/.test(text) &&
    !/\d\s*[.、)]/.test(text)
  ) {
    return true;
  }
  return false;
}

function detectSection(line: string): SectionKind | null {
  const raw = line.trim();
  if (!raw || raw.length > 36 || parseStart(raw)) return null;
  const text = raw.replace(/\s/g, "");
  if (/[A-E][.、:：]/.test(text)) return null;
  if (/答案/.test(text)) return null;
  const multiple = /多项选择|多选题|多选/.test(text);
  const single = /单项选择|单选题|单选/.test(text);
  if (multiple && !single) return "multiple";
  if (single && !multiple) return "single";
  return null;
}

function isKeyHeader(line: string): boolean {
  const text = line.replace(/\s/g, "");
  return /^(?:【)?(?:参考答案及解析|参考答案与解析|答案及解析|答案与解析|参考答案|试题答案|答案部分)(?:】)?$/.test(
    text,
  );
}

function normalizeAnswer(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const letters = raw.toUpperCase().match(/[A-E]/g);
  if (!letters?.length) return null;
  return [...new Set(letters)].sort().join("");
}

function isAnswerRemainder(rest: string): boolean {
  const text = rest.trim();
  if (!text) return false;
  if (/^[A-E](?:\s*[、,，]?\s*[A-E]){0,4}\s*$/.test(text)) return true;
  if (/^[A-E](?:\s*[、,，]?\s*[A-E]){0,4}\s*(?:【\s*解\s*析|解\s*析)/.test(text)) {
    return true;
  }
  return false;
}

function parseStart(line: string): { number: number } | null {
  const text = line.trim();
  if (isAnswerKeyLine(text)) return null;
  const lead =
    text.match(QUESTION_LEAD) ?? text.match(CHAPTER_LEAD) ?? text.match(NUMBERED_LEAD);
  if (!lead) return null;
  const number = Number(lead[1]);
  if (!Number.isFinite(number) || number < 1 || number > 2000) return null;
  if (isAnswerRemainder(lead[2] ?? "")) return null;
  return { number };
}

function isAnswerKeyLine(line: string): boolean {
  const text = line.trim();
  const answerBody = `(?:${ANSWER_LABEL})?${ANSWER_LETTERS}`;
  if (
    new RegExp(
      `^\\d{1,4}\\s*[.、)）]\\s*${answerBody}\\s*(?:【\\s*(?:解\\s*析|详\\s*解)\\s*】.*|(?:解\\s*析|详\\s*解)\\s*[:：].*)?$`,
    ).test(text)
  ) {
    return true;
  }
  if (
    new RegExp(
      `^(?:\\d{1,4}\\s*[.、)）]?\\s*[A-E]{1,5}\\s+){1,}\\d{1,4}\\s*[.、)）]?\\s*[A-E]{1,5}\\s*$`,
    ).test(text)
  ) {
    return true;
  }
  return false;
}

function isStartOfKeyRun(lines: string[], index: number): boolean {
  const current = lines[index]?.trim() ?? "";
  if (
    /^(?:\d{1,4}\s*[.、)）]?\s*[A-E]{1,5}\s+){1,}\d{1,4}\s*[.、)）]?\s*[A-E]{1,5}\s*$/.test(
      current,
    )
  ) {
    return true;
  }
  if (!isAnswerKeyLine(current)) return false;
  let answerish = 0;
  let optionish = 0;
  const end = Math.min(lines.length, index + 10);
  for (let cursor = index; cursor < end; cursor += 1) {
    const line = lines[cursor]?.trim() ?? "";
    if (!line) continue;
    if (isAnswerKeyLine(line)) answerish += 1;
    if (/^[A-E][.、．:：]/.test(line)) optionish += 1;
    if (detectSection(line) && cursor !== index) break;
  }
  return answerish >= 2 && optionish === 0;
}

function explodeInlineOptions(text: string): string {
  const lines = text.split("\n");
  const output: string[] = [];
  for (const line of lines) {
    const matches = [...line.matchAll(/(?:^|\s)([A-E])[.、．:：]\s*/g)];
    const ordered = matches.filter((match, index) => {
      if (index === 0) return true;
      return match[1] > matches[index - 1][1];
    });
    if (ordered.length < 2 || !ordered.some((match) => match[1] === "A")) {
      output.push(line);
      continue;
    }
    const first = ordered[0];
    const head = line.slice(0, first.index).trim();
    if (head) output.push(head);
    for (let index = 0; index < ordered.length; index += 1) {
      const current = ordered[index];
      const start = (current.index ?? 0) + current[0].length;
      const end =
        index + 1 < ordered.length ? (ordered[index + 1].index ?? line.length) : line.length;
      output.push(`${current[1]}.${line.slice(start, end).trim()}`);
    }
  }
  return output.join("\n");
}

function collectOptionKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const line of explodeInlineOptions(text).split("\n")) {
    const option = optionFromLine(line.trim());
    if (option) keys.add(option.key);
  }
  return keys;
}

function hasOptionSet(text: string): boolean {
  const keys = collectOptionKeys(text);
  return keys.has("A") && keys.has("B") && keys.size >= 3;
}

function nextBoundary(lines: string[], from: number): number {
  for (let index = from + 1; index < lines.length; index += 1) {
    if (isKeyHeader(lines[index]) || isStartOfKeyRun(lines, index)) return index;
    if (parseStart(lines[index])) return index;
    if (detectSection(lines[index]) && hasQuestionSoon(lines, index + 1)) return index;
  }
  return lines.length;
}

function hasQuestionSoon(lines: string[], from: number): boolean {
  const end = Math.min(lines.length, from + 8);
  for (let index = from; index < end; index += 1) {
    if (parseStart(lines[index]) && hasOptionSet(lines.slice(index, nextRawStart(lines, index)).join("\n"))) {
      return true;
    }
  }
  return false;
}

function nextRawStart(lines: string[], from: number): number {
  for (let index = from + 1; index < lines.length; index += 1) {
    if (parseStart(lines[index]) || isKeyHeader(lines[index]) || detectSection(lines[index])) {
      return index;
    }
  }
  return lines.length;
}

function hasOptionSetAhead(lines: string[], index: number): boolean {
  const end = nextBoundary(lines, index);
  return hasOptionSet(lines.slice(index, end).join("\n"));
}

function joinWrapped(text: string): string {
  const parts = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  let out = "";
  for (const part of parts) {
    if (!out) {
      out = part;
      continue;
    }
    const prev = out.at(-1);
    const next = part.at(0);
    const cjk = (char: string | undefined) => !!char && /[\u4e00-\u9fff]/.test(char);
    if (cjk(prev) && cjk(next)) out += part;
    else if (prev && next && /[A-Za-z0-9]/.test(prev) && /[A-Za-z0-9]/.test(next)) {
      out += ` ${part}`;
    } else out += part;
  }
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

function extractAnswerAndExplanation(raw: string): {
  body: string;
  answer: string | null;
  explanation: string | null;
} {
  let body = raw;
  let explanation: string | null = null;
  const explanationMatch =
    body.match(/【\s*(?:解\s*析|详\s*解|思\s*路\s*点\s*拨|名\s*师\s*点\s*拨)\s*】\s*[:：]?/) ??
    body.match(/(?:^|\n)\s*(?:解\s*析|详\s*解)\s*[:：]/);
  if (explanationMatch?.index !== undefined) {
    explanation = body.slice(explanationMatch.index + explanationMatch[0].length).trim();
    body = body.slice(0, explanationMatch.index).trim();
  }

  const answerMatch =
    body.match(new RegExp(`【\\s*(?:参\\s*考|正\\s*确)?\\s*答\\s*案\\s*】\\s*[:：]?\\s*(${ANSWER_LETTERS})`, "i")) ??
    body.match(
      new RegExp(
        `(?:^|\\n)\\s*(?:(?:参\\s*考|正\\s*确)\\s*)?答\\s*案\\s*[:：]?\\s*(${ANSWER_LETTERS})\\s*(?=\\n|$)`,
        "i",
      ),
    );
  let answer = answerMatch ? normalizeAnswer(answerMatch[1]) : null;
  if (answerMatch?.index !== undefined) {
    body = body.slice(0, answerMatch.index).trim();
  }

  if (!answer && explanation) {
    const buried = explanation.match(
      /(?:故选|应选|答案选|正确选项为?|答案是|答案为|答案)\s*[:：]?\s*([A-E](?:\s*[、,，]?\s*[A-E]){0,4})/i,
    );
    if (buried) answer = normalizeAnswer(buried[1]);
  }

  if (explanation) {
    explanation = explanation
      .replace(
        /^(?:【\s*(?:解\s*析|详\s*解|思\s*路\s*点\s*拨|名\s*师\s*点\s*拨)\s*】|(?:解\s*析|详\s*解))\s*[:：]?\s*/,
        "",
      )
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!explanation) explanation = null;
    else explanation = joinWrapped(explanation);
  }

  return { body, answer, explanation };
}

function optionFromLine(line: string): { key: string; text: string } | null {
  const trimmed = line.trim();
  const marked = trimmed.match(/^([A-E])[.、:：)）]\s*(.*)$/);
  if (marked) return { key: marked[1], text: marked[2].trim() };
  const wrapped = trimmed.match(/^[（(]([A-E])[）)]\s*(.*)$/);
  if (wrapped) return { key: wrapped[1], text: wrapped[2].trim() };
  const bare = trimmed.match(/^([A-E])$/);
  if (bare) return { key: bare[1], text: "" };
  const spaced = trimmed.match(/^([A-E])\s+(.+)$/);
  if (spaced && /[\u4e00-\u9fff]/.test(spaced[2])) {
    return { key: spaced[1], text: spaced[2].trim() };
  }
  return null;
}

function parseBlock(raw: string, sectionKind: SectionKind, number: number): Draft | null {
  const extracted = extractAnswerAndExplanation(raw);
  const lines = explodeInlineOptions(extracted.body).split("\n");
  const stemLines: string[] = [];
  const options: Choice[] = [];
  let started = false;
  let current: Choice | null = null;

  const pushCurrent = () => {
    if (!current) return;
    const text = joinWrapped(current.text);
    if (text) options.push({ key: current.key, text });
    current = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || detectSection(trimmed) || isKeyHeader(trimmed)) continue;
    const option = optionFromLine(trimmed);
    if (option && (!started ? option.key === "A" : option.key > (current?.key ?? "A"))) {
      started = true;
      pushCurrent();
      current = option;
      continue;
    }
    if (started && current) current.text = `${current.text}\n${trimmed}`;
    else stemLines.push(trimmed);
  }
  pushCurrent();

  const unique: Choice[] = [];
  for (const option of options) {
    if (unique.some((item) => item.key === option.key)) continue;
    unique.push(option);
  }
  if (unique.length < 3 || !unique.some((item) => item.key === "A")) return null;

  let stem = joinWrapped(stemLines.join("\n"));
  stem = stem
    .replace(/^(?:母题|变式题|变式|经典真题|真题)\s*\d+\s*/, "")
    .replace(/^第\s*\d{1,4}\s*题\s*/, "")
    .replace(/^\d{1,4}\s*[.、)）]\s*/, "")
    .trim();
  if (stem.length < 4) return null;

  let answer = extracted.answer;
  if (!answer) {
    const blank = stem.match(/[（(]\s*([A-E]{1,5})\s*[）)]\s*$/);
    if (blank) {
      answer = normalizeAnswer(blank[1]);
      stem = stem.replace(/[（(]\s*[A-E]{1,5}\s*[）)]\s*$/, "（ ）").trim();
    }
  }

  return {
    number,
    sectionKind,
    stem,
    options: unique,
    answer,
    explanation: extracted.explanation,
  };
}

function parseAnswerKey(lines: string[], outerKind: SectionKind): KeyEntry[] {
  const entries: KeyEntry[] = [];
  let headerKind: SectionKind | null = null;
  let current: KeyEntry | null = null;

  const flush = () => {
    if (!current) return;
    if (current.explanation) current.explanation = joinWrapped(current.explanation);
    entries.push(current);
    current = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || isKeyHeader(trimmed)) continue;
    const section = detectSection(trimmed);
    if (section) {
      flush();
      headerKind = section;
      continue;
    }

    const compact = [
      ...trimmed.matchAll(
        new RegExp(
          `(\\d{1,4})\\s*[.、)）]?\\s*(?:${ANSWER_LABEL})?(${ANSWER_LETTERS})(?=\\s+\\d|\\s*$)`,
          "g",
        ),
      ),
    ];
    if (compact.length >= 2 && compact.every((match) => normalizeAnswer(match[2]))) {
      flush();
      for (const match of compact) {
        const answer = normalizeAnswer(match[2]);
        if (!answer) continue;
        entries.push({
          number: Number(match[1]),
          answer,
          explanation: null,
          kind: entryKind(answer, headerKind, outerKind),
        });
      }
      continue;
    }

    const single = trimmed.match(
      new RegExp(
        `^(\\d{1,4})\\s*[.、)）]?\\s*(?:${ANSWER_LABEL})?(${ANSWER_LETTERS})\\s*(.*)$`,
      ),
    );
    if (single) {
      const answer = normalizeAnswer(single[2]);
      if (answer) {
        flush();
        const rest = single[3]
          .replace(/^【\s*(?:解\s*析|详\s*解)\s*】\s*/, "")
          .replace(/^(?:解\s*析|详\s*解)\s*[:：]\s*/, "")
          .trim();
        current = {
          number: Number(single[1]),
          answer,
          explanation: rest || null,
          kind: entryKind(answer, headerKind, outerKind),
        };
        continue;
      }
    }

    if (/^(?:【\s*(?:解\s*析|详\s*解|思\s*路\s*点\s*拨)\s*】|(?:解\s*析|详\s*解))\s*[:：]?/.test(trimmed)) {
      const text = trimmed
        .replace(
          /^(?:【\s*(?:解\s*析|详\s*解|思\s*路\s*点\s*拨)\s*】|(?:解\s*析|详\s*解))\s*[:：]?\s*/,
          "",
        )
        .trim();
      if (current && text) {
        current.explanation = [current.explanation, text].filter(Boolean).join("\n");
      }
      continue;
    }

    if (current) current.explanation = [current.explanation, trimmed].filter(Boolean).join("\n");
  }
  flush();
  return entries;
}

function entryKind(answer: string, headerKind: SectionKind | null, outerKind: SectionKind): SectionKind {
  if (headerKind) return headerKind;
  if (answer.length >= 2) return "multiple";
  if (answer.length === 1) return "single";
  return outerKind;
}

function kindsCompatible(entry: SectionKind, question: SectionKind): boolean {
  if (entry === "unknown" || question === "unknown") return true;
  return entry === question;
}

function applyEntries(questions: Draft[], entries: KeyEntry[]) {
  const unused = [...entries];
  for (const question of questions) {
    if (question.answer) continue;
    const index = unused.findIndex(
      (entry) => entry.number === question.number && kindsCompatible(entry.kind, question.sectionKind),
    );
    if (index < 0) continue;
    const [entry] = unused.splice(index, 1);
    question.answer = entry.answer;
    if (!question.explanation && entry.explanation) question.explanation = entry.explanation;
  }
}

function inferSection(draft: Draft): SectionKind {
  if (draft.sectionKind !== "unknown") return draft.sectionKind;
  if (draft.answer && draft.answer.length >= 2) return "multiple";
  if (draft.options.some((option) => option.key === "E")) return "multiple";
  return "single";
}

function inferType(draft: Draft): QuestionType {
  if (draft.answer && draft.answer.length >= 2) return "multiple";
  if (draft.sectionKind === "multiple") return "multiple";
  if (draft.sectionKind === "single" && !(draft.answer && draft.answer.length >= 2)) {
    return "single";
  }
  if (draft.options.some((option) => option.key === "E")) return "multiple";
  return "single";
}

function hashStem(stem: string): string {
  let hash = 5381;
  for (const char of stem) hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  return hash.toString(36);
}

function toQuestions(drafts: Draft[], subject: SubjectId): Question[] {
  const seen = new Set<string>();
  const questions: Question[] = [];
  drafts.forEach((draft, index) => {
    const type = inferType(draft);
    const id = `${subject}:${draft.number}:${type}:${hashStem(draft.stem)}:${index}`;
    const fingerprint = `${type}:${draft.stem.replace(/\s/g, "")}`;
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    questions.push({
      id,
      subject,
      type,
      number: draft.number,
      order: questions.length,
      stem: draft.stem,
      options: draft.options,
      answer: draft.answer,
      explanation: draft.explanation,
    });
  });
  return questions;
}

export function parseQuestionBank(raw: string, subject: SubjectId): ParseResult {
  const normalized = normalizeDocument(raw);
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !isNoiseLine(line));

  const drafts: Draft[] = [];
  let kind: SectionKind = "unknown";
  let skipped = 0;
  let index = 0;
  let scopeStart = 0;

  while (index < lines.length) {
    if (isKeyHeader(lines[index]) || isStartOfKeyRun(lines, index)) {
      const start = index;
      let cursor = isKeyHeader(lines[index]) ? index + 1 : index;
      const buffer: string[] = [];
      while (cursor < lines.length) {
        if (parseStart(lines[cursor]) && hasOptionSetAhead(lines, cursor)) break;
        if (
          cursor !== start &&
          detectSection(lines[cursor]) &&
          hasQuestionSoon(lines, cursor + 1) &&
          !isAnswerKeyLine(lines[cursor + 1] ?? "") &&
          !isAnswerKeyLine(lines[cursor + 2] ?? "")
        ) {
          break;
        }
        buffer.push(lines[cursor]);
        cursor += 1;
      }
      applyEntries(drafts.slice(scopeStart), parseAnswerKey(buffer, kind));
      scopeStart = drafts.length;
      index = cursor;
      continue;
    }

    const section = detectSection(lines[index]);
    if (section) {
      kind = section;
      index += 1;
      continue;
    }

    const start = parseStart(lines[index]);
    if (start && hasOptionSetAhead(lines, index)) {
      const end = nextBoundary(lines, index);
      const block = lines.slice(index, end).join("\n");
      const draft = parseBlock(block, kind, start.number);
      if (draft) {
        draft.sectionKind = inferSection(draft);
        drafts.push(draft);
      } else skipped += 1;
      index = end;
      continue;
    }

    if (start) skipped += 1;
    index += 1;
  }

  const questions = toQuestions(drafts, subject);
  const withAnswer = questions.filter((question) => question.answer).length;
  const withoutAnswer = questions.length - withAnswer;
  const warnings: string[] = [];
  if (withoutAnswer > 0) {
    warnings.push(
      `有 ${withoutAnswer} 道题在 PDF 里没对上答案，练习时会标明「本题 PDF 中未识别到答案」。`,
    );
  }
  if (skipped > 0) {
    warnings.push(`有 ${skipped} 处像题号但选项不完整，已跳过。`);
  }
  if (questions.length > 0 && questions.length < 8 && normalized.length > 8000) {
    warnings.push("抽到的题目偏少。扫描版 PDF 没有文字层，需要换成可以复制文字的《600母题》。");
  }

  return {
    subject,
    questions,
    warnings,
    stats: {
      total: questions.length,
      single: questions.filter((question) => question.type === "single").length,
      multiple: questions.filter((question) => question.type === "multiple").length,
      withAnswer,
      withoutAnswer,
    },
  };
}

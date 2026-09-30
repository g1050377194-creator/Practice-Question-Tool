export type SubjectId = "civil" | "management";

export type QuestionType = "single" | "multiple";

export type Choice = {
  key: string;
  text: string;
};

export type Question = {
  id: string;
  subject: SubjectId;
  type: QuestionType;
  number: number;
  /** PDF 中的出现顺序，刷新后仍按这个顺序练习。 */
  order: number;
  stem: string;
  options: Choice[];
  /** 归一化后的答案，如 "A" 或 "ABD"。PDF 里没识别到则为 null。 */
  answer: string | null;
  explanation: string | null;
};

export type ParseStats = {
  total: number;
  single: number;
  multiple: number;
  withAnswer: number;
  withoutAnswer: number;
};

export type ParseResult = {
  subject: SubjectId;
  questions: Question[];
  warnings: string[];
  stats: ParseStats;
};

export type BankMeta = {
  subject: SubjectId;
  fileName: string;
  importedAt: number;
  warnings: string[];
  stats: ParseStats;
};

export const SUBJECTS: {
  id: SubjectId;
  short: string;
  full: string;
  fileHint: string;
}[] = [
  {
    id: "civil",
    short: "土建",
    full: "土木建筑工程",
    fileHint: "2026二造土建《600母题》.pdf",
  },
  {
    id: "management",
    short: "管理",
    full: "建设工程造价管理",
    fileHint: "2026二造管理《600母题》.pdf",
  },
];

export function subjectLabel(id: SubjectId): string {
  return SUBJECTS.find((item) => item.id === id)?.full ?? id;
}

export function subjectShort(id: SubjectId): string {
  return SUBJECTS.find((item) => item.id === id)?.short ?? id;
}

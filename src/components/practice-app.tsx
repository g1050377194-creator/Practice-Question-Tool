"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HistoryPanel, MistakePanel } from "@/components/records-panels";
import {
  clearBank,
  clearSession,
  readBank,
  readSession,
  writeBank,
  writeSession,
  type PracticeFilter,
  type PracticeSession,
} from "@/lib/db";
import { gradeAnswer, type Verdict } from "@/lib/grade";
import {
  SUBJECTS,
  subjectLabel,
  subjectShort,
  type AttemptSummary,
  type BankMeta,
  type MistakeRecord,
  type ParseResult,
  type PracticeSource,
  type Question,
  type SubjectId,
} from "@/lib/types";
import { cn } from "cn";
import { BookOpen, Check, RotateCcw, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

type BankState = {
  meta: BankMeta | null;
  questions: Question[];
};

type LimitChoice = 10 | 20 | 50 | "all";

const LIMITS: LimitChoice[] = [10, 20, 50, "all"];

function emptyBanks(): Record<SubjectId, BankState> {
  return {
    civil: { meta: null, questions: [] },
    management: { meta: null, questions: [] },
  };
}

function shuffle<T>(list: T[]): T[] {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function formatWhen(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function verdictFor(
  question: Question,
  selected: string | undefined,
  revealed: boolean,
): Verdict {
  return gradeAnswer(question.answer, selected, revealed);
}

function restoreSession(saved: PracticeSession): PracticeSession {
  return {
    ...saved,
    sessionId: saved.sessionId || `legacy-${saved.startedAt}`,
    source: saved.source === "mistakes" ? "mistakes" : "bank",
  };
}

function typeLabel(type: Question["type"]): string {
  return type === "single" ? "单项选择题" : "多项选择题";
}

export function PracticeApp() {
  const [ready, setReady] = useState(false);
  const [banks, setBanks] = useState<Record<SubjectId, BankState>>(emptyBanks);
  const [subject, setSubject] = useState<SubjectId>("civil");
  const [filter, setFilter] = useState<PracticeFilter>("all");
  const [limit, setLimit] = useState<LimitChoice>(20);
  const [shuffleOn, setShuffleOn] = useState(false);
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [parsing, setParsing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [memoryOnly, setMemoryOnly] = useState(false);
  const [databaseDown, setDatabaseDown] = useState(false);
  const [homeTab, setHomeTab] = useState<"practice" | "mistakes" | "history">("practice");
  const [mistakes, setMistakes] = useState<Record<SubjectId, MistakeRecord[]>>({
    civil: [],
    management: [],
  });
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const [recordNote, setRecordNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let local = emptyBanks();
      let saved: PracticeSession | null = null;
      let idbFailed = false;
      try {
        const [civil, management, session] = await Promise.all([
          readBank("civil"),
          readBank("management"),
          readSession(),
        ]);
        local = { civil, management };
        saved = session;
      } catch {
        idbFailed = true;
      }

      let nextBanks = local;
      let serverOk = false;
      try {
        const response = await fetch("/api/banks");
        if (!response.ok) throw new Error("banks");
        const payload = (await response.json()) as { banks: Record<SubjectId, BankState> };
        nextBanks = payload.banks;
        serverOk = true;
        let migrated = false;
        for (const id of ["civil", "management"] as const) {
          const localBank = local[id];
          if (nextBanks[id].questions.length === 0 && localBank.meta && localBank.questions.length > 0) {
            const put = await fetch("/api/banks", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ meta: localBank.meta, questions: localBank.questions }),
            });
            if (put.ok) {
              nextBanks = { ...nextBanks, [id]: localBank };
              migrated = true;
            }
          }
        }
        if (!idbFailed) {
          await Promise.all(
            (["civil", "management"] as const).map(async (id) => {
              const stored = nextBanks[id];
              if (stored.meta && stored.questions.length > 0) {
                await writeBank(stored.meta, stored.questions, { keepSession: true });
              }
            }),
          );
        }
        const [mistakeResponse, attemptResponse] = await Promise.all([
          fetch("/api/mistakes"),
          fetch("/api/attempts"),
        ]);
        if (mistakeResponse.ok && attemptResponse.ok && !cancelled) {
          const mistakePayload = (await mistakeResponse.json()) as {
            mistakes: Record<SubjectId, MistakeRecord[]>;
          };
          const attemptPayload = (await attemptResponse.json()) as { attempts: AttemptSummary[] };
          setMistakes(mistakePayload.mistakes);
          setAttempts(attemptPayload.attempts);
        }
        if (!cancelled && migrated) setNotice("已把浏览器里的题库写入本机数据库。");
      } catch {
        if (!cancelled) {
          setDatabaseDown(true);
          setMemoryOnly(idbFailed);
          setError(
            idbFailed
              ? "浏览器打不开本地题库，本机数据库也没有连上。这次页面里仍可练习，但刷新后题目会丢失。"
              : "连不上本机数据库，先用浏览器里的题库。错题和历史要等服务恢复后才会继续记。",
          );
        }
      }

      if (cancelled) return;
      setBanks(nextBanks);
      if (saved) {
        const restored = restoreSession(saved);
        const stored = nextBanks[restored.subject];
        const ids = new Set(stored.questions.map((question) => question.id));
        if (restored.questionIds.length > 0 && restored.questionIds.every((id) => ids.has(id))) {
          setSession(restored);
          setSubject(restored.subject);
          setFilter(restored.filter);
          setLimit(
            restored.limit === 10 || restored.limit === 20 || restored.limit === 50 || restored.limit === "all"
              ? restored.limit
              : "all",
          );
        } else {
          await clearSession();
        }
      }
      if (!serverOk && idbFailed) setMemoryOnly(true);
      hydrated.current = true;
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    if (!session) {
      void clearSession().catch(() => setMemoryOnly(true));
      return;
    }
    void writeSession(session).catch(() => setMemoryOnly(true));
  }, [session]);

  const bank = banks[subject];
  const filtered = useMemo(
    () => bank.questions.filter((question) => filter === "all" || question.type === filter),
    [bank.questions, filter],
  );

  async function ingest(file: File) {
    setError(null);
    setNotice(null);
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type && file.type !== "application/pdf") {
      setError("只接受 PDF。请上传《600母题》文本版。");
      return;
    }
    if (file.size > 80 * 1024 * 1024) {
      setError("PDF 超过 80MB，请先压缩或拆分后再上传。");
      return;
    }
    if (bank.questions.length > 0) {
      const replace = window.confirm(
        `「${subjectShort(subject)}」里已有 ${bank.questions.length} 道题。用「${file.name}」替换吗？`,
      );
      if (!replace) return;
    }

    setParsing(true);
    try {
      const body = new FormData();
      body.set("subject", subject);
      body.set("file", file);
      const response = await fetch("/api/parse", { method: "POST", body });
      const payload = (await response.json()) as ParseResult & {
        fileName?: string;
        importedAt?: number;
        persisted?: boolean;
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? "解析失败，请换一份 PDF 再试。");
        return;
      }
      const meta: BankMeta = {
        subject,
        fileName: payload.fileName ?? file.name,
        importedAt: payload.importedAt ?? Date.now(),
        warnings: payload.warnings ?? [],
        stats: payload.stats,
      };
      try {
        await writeBank(meta, payload.questions);
      } catch {
        setMemoryOnly(true);
      }
      if (payload.persisted === false) {
        setDatabaseDown(true);
        setError("题目留在这台浏览器里了，但没有写入数据库。错题和历史要等数据库恢复后才会继续记。");
      } else {
        void refreshRecords();
      }
      setBanks((current) => ({ ...current, [subject]: { meta, questions: payload.questions } }));
      setNotice(
        `「${subjectShort(subject)}」已入库 ${payload.stats.total} 道题，其中单选 ${payload.stats.single} 道、多选 ${payload.stats.multiple} 道。`,
      );
      if (session?.subject === subject) setSession(null);
    } catch {
      setError("上传中断了。请确认开发服务还在运行，然后重新选择文件。");
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function beginPractice(
    nextSubject = subject,
    nextFilter = filter,
    nextLimit = limit,
    source: PracticeSource = "bank",
    presetIds?: string[],
  ) {
    const bankQuestions = banks[nextSubject].questions;
    let ordered: Question[] = [];
    if (presetIds) {
      const byId = new Map(bankQuestions.map((question) => [question.id, question]));
      ordered = presetIds
        .map((id) => byId.get(id))
        .filter((question): question is Question => Boolean(question));
      if (ordered.length === 0) {
        setError("错题库里的题目已经不在这科题库中。重新导入 PDF 后再练。");
        return;
      }
    } else {
      const pool = bankQuestions.filter((question) => nextFilter === "all" || question.type === nextFilter);
      if (pool.length === 0) {
        setError(
          bankQuestions.length === 0
            ? `「${subjectShort(nextSubject)}」还没有题目。先上传对应的《600母题》PDF。`
            : "这个题型下没有题目。可以改成「全部」再开始。",
        );
        return;
      }
      const picked = nextLimit === "all" ? pool : pool.slice(0, nextLimit);
      ordered = shuffleOn ? shuffle(picked) : picked;
    }
    setError(null);
    setNotice(null);
    setRecordNote(null);
    setSession({
      sessionId: crypto.randomUUID(),
      subject: nextSubject,
      filter: source === "mistakes" ? "all" : nextFilter,
      source,
      limit: source === "mistakes" ? "all" : nextLimit,
      questionIds: ordered.map((question) => question.id),
      selections: {},
      revealed: [],
      index: 0,
      finished: false,
      review: false,
      startedAt: Date.now(),
    });
  }

  async function refreshRecords() {
    try {
      const [mistakeResponse, attemptResponse] = await Promise.all([
        fetch("/api/mistakes"),
        fetch("/api/attempts"),
      ]);
      if (!mistakeResponse.ok || !attemptResponse.ok) throw new Error("records");
      const mistakePayload = (await mistakeResponse.json()) as {
        mistakes: Record<SubjectId, MistakeRecord[]>;
      };
      const attemptPayload = (await attemptResponse.json()) as { attempts: AttemptSummary[] };
      setMistakes(mistakePayload.mistakes);
      setAttempts(attemptPayload.attempts);
      setDatabaseDown(false);
    } catch {
      setDatabaseDown(true);
    }
  }

  async function recordSelection(current: PracticeSession, questionId: string, selected: string) {
    try {
      const response = await fetch("/api/answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: current.sessionId, questionId, selected }),
      });
      if (!response.ok) throw new Error("record");
      setRecordNote(null);
      setDatabaseDown(false);
    } catch {
      setDatabaseDown(true);
      setRecordNote("这道题先留在本次练习里，交卷时会写入错题库。");
    }
  }

  async function finishAndStore(snapshot: PracticeSession) {
    try {
      const response = await fetch("/api/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: snapshot.sessionId,
          subject: snapshot.subject,
          filter: snapshot.filter,
          source: snapshot.source ?? "bank",
          startedAt: snapshot.startedAt,
          questionIds: snapshot.questionIds,
          selections: snapshot.selections,
        }),
      });
      if (!response.ok) throw new Error("finish");
      setRecordNote(null);
      setDatabaseDown(false);
      await refreshRecords();
    } catch {
      setDatabaseDown(true);
      setRecordNote("这次成绩没能写入数据库。可以在小结里再保存一次。");
    }
  }

  async function flushRevealed(snapshot: PracticeSession) {
    const answers = snapshot.revealed.map((questionId) => ({
      questionId,
      selected: snapshot.selections[questionId] ?? "",
    }));
    if (answers.length === 0) return;
    try {
      const response = await fetch("/api/answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: snapshot.sessionId, answers }),
      });
      if (!response.ok) throw new Error("flush");
    } catch {
      setDatabaseDown(true);
    }
  }

  function leaveSession() {
    const current = session;
    setSession(null);
    if (!current || current.finished) {
      void refreshRecords();
      return;
    }
    void flushRevealed(current).finally(() => {
      void refreshRecords();
    });
  }

  async function dismissOneMistake(questionId: string) {
    try {
      const response = await fetch(`/api/mistakes?questionId=${encodeURIComponent(questionId)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("dismiss");
      setMistakes((current) => ({
        civil: current.civil.filter((item) => item.question.id !== questionId),
        management: current.management.filter((item) => item.question.id !== questionId),
      }));
    } catch {
      setError("这道题没能移出错题库。");
    }
  }

  async function clearMistakeBank() {
    const count = mistakes[subject].length;
    if (count === 0) return;
    const confirmed = window.confirm(
      `清空「${subjectShort(subject)}」的 ${count} 道错题？已交卷的历史记录仍保留。`,
    );
    if (!confirmed) return;
    try {
      const response = await fetch(`/api/mistakes?subject=${subject}`, { method: "DELETE" });
      if (!response.ok) throw new Error("clear");
      setMistakes((current) => ({ ...current, [subject]: [] }));
      setNotice(`已清空「${subjectShort(subject)}」错题库。`);
    } catch {
      setError("错题库没有清空。");
    }
  }

  async function removeBank() {
    if (bank.questions.length === 0) return;
    const confirmed = window.confirm(
      `清空「${subjectShort(subject)}」的 ${bank.questions.length} 道题？这一科的错题库也会一起清空，已交卷的历史记录仍保留。`,
    );
    if (!confirmed) return;
    try {
      const response = await fetch(`/api/banks?subject=${subject}`, { method: "DELETE" });
      if (!response.ok) throw new Error("delete");
    } catch {
      setDatabaseDown(true);
    }
    try {
      await clearBank(subject);
    } catch {
      setMemoryOnly(true);
    }
    setBanks((current) => ({ ...current, [subject]: { meta: null, questions: [] } }));
    setMistakes((current) => ({ ...current, [subject]: [] }));
    if (session?.subject === subject) setSession(null);
    setNotice(`已清空「${subjectShort(subject)}」题库。`);
  }

  if (!ready) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl items-center px-4 py-16">
        <p className="text-sm text-muted-foreground">正在打开本机数据库里的题库…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:py-10">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-medium tracking-wide text-primary">二级造价工程师 · 2026</p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-heading text-4xl leading-none sm:text-5xl">600 母题</h1>
          <Badge variant="outline">选择题</Badge>
        </div>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          刷土木建筑工程、建设工程造价管理的单项和多项选择题。把《600母题》PDF
          拖进页面即可抽题；做完能看对错、正确答案和解析。题库、错题和每次交卷的成绩记在运行这个页面的电脑上，换浏览器也能接着看。
        </p>
      </header>

      {memoryOnly ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="status">
          浏览器无法保存题库（可能是无痕模式或存储被禁用）。当前页面还能练习，刷新后需要重新上传。
        </p>
      ) : null}
      {databaseDown && !memoryOnly ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="status">
          本机数据库暂时连不上。当前题目还能做，错题和历史要等服务恢复后才会继续记。
        </p>
      ) : null}

      {session ? (
        <SessionView
          session={session}
          questions={banks[session.subject].questions}
          recordNote={recordNote}
          onChange={setSession}
          onExit={leaveSession}
          onRecord={(questionId, selected) => void recordSelection(session, questionId, selected)}
          onFinish={(snapshot) => void finishAndStore(snapshot)}
          onRetry={() =>
            setSession({
              ...session,
              sessionId: crypto.randomUUID(),
              selections: {},
              revealed: [],
              index: 0,
              finished: false,
              review: false,
              startedAt: Date.now(),
            })
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Tabs value={subject} onValueChange={(value) => {
            setSubject(value as SubjectId);
            setError(null);
            setNotice(null);
          }}>
            <TabsList className="grid h-auto w-full grid-cols-2">
              {SUBJECTS.map((item) => (
                <TabsTrigger key={item.id} value={item.id} className="h-auto px-2 py-2">
                  <span className="sm:hidden">{item.short}</span>
                  <span className="hidden sm:inline">{item.full}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Tabs value={homeTab} onValueChange={(value) => setHomeTab(value as "practice" | "mistakes" | "history")}>
            <TabsList className="h-auto w-full">
              <TabsTrigger value="practice" className="h-9 flex-1">练习</TabsTrigger>
              <TabsTrigger value="mistakes" className="h-9 flex-1">
                错题库{mistakes[subject].length > 0 ? ` ${mistakes[subject].length}` : ""}
              </TabsTrigger>
              <TabsTrigger value="history" className="h-9 flex-1">历史</TabsTrigger>
            </TabsList>
          </Tabs>
          {error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm" role="status">
              {notice}
            </p>
          ) : null}
          {homeTab === "practice" ? (
            <HomeView
              subject={subject}
              filter={filter}
              onFilter={setFilter}
              limit={limit}
              onLimit={setLimit}
              shuffleOn={shuffleOn}
              onShuffle={setShuffleOn}
              bank={bank}
              available={filtered.length}
              parsing={parsing}
              dragging={dragging}
              fileRef={fileRef}
              onBrowse={() => fileRef.current?.click()}
              onFile={(file) => void ingest(file)}
              onDrag={setDragging}
              onStart={() => beginPractice()}
              onClear={() => void removeBank()}
            />
          ) : null}
          {homeTab === "mistakes" ? (
            <MistakePanel
              subject={subject}
              mistakes={mistakes[subject]}
              onPractice={(questionIds) => beginPractice(subject, "all", "all", "mistakes", questionIds)}
              onDismiss={(questionId) => void dismissOneMistake(questionId)}
              onClear={() => void clearMistakeBank()}
            />
          ) : null}
          {homeTab === "history" ? <HistoryPanel subject={subject} attempts={attempts} /> : null}
        </div>
      )}
    </main>
  );
}

function HomeView({
  subject,
  filter,
  onFilter,
  limit,
  onLimit,
  shuffleOn,
  onShuffle,
  bank,
  available,
  parsing,
  dragging,
  fileRef,
  onBrowse,
  onFile,
  onDrag,
  onStart,
  onClear,
}: {
  subject: SubjectId;
  filter: PracticeFilter;
  onFilter: (filter: PracticeFilter) => void;
  limit: LimitChoice;
  onLimit: (limit: LimitChoice) => void;
  shuffleOn: boolean;
  onShuffle: (value: boolean) => void;
  bank: BankState;
  available: number;
  parsing: boolean;
  dragging: boolean;
  fileRef: RefObject<HTMLInputElement | null>;
  onBrowse: () => void;
  onFile: (file: File) => void;
  onDrag: (dragging: boolean) => void;
  onStart: () => void;
  onClear: () => void;
}) {
  const stats = bank.meta?.stats;
  const planned = limit === "all" ? available : Math.min(limit, available);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-5">
        <Card className="sm:col-span-2">
          <CardHeader>
            <CardTitle>{subjectLabel(subject)}</CardTitle>
            <CardDescription>
              {stats && bank.meta
                ? `${bank.meta.fileName} · ${formatWhen(bank.meta.importedAt)}`
                : "还没有这一科的题目"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {stats ? (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Stat label="题目" value={`${stats.total}`} />
                <Stat label="单选" value={`${stats.single}`} />
                <Stat label="多选" value={`${stats.multiple}`} />
                <Stat label="缺答案" value={`${stats.withoutAnswer}`} />
              </dl>
            ) : (
              <p className="text-sm leading-6 text-muted-foreground">
                题库是空的。把对应科目的 PDF 拖到右侧，例如「
                {SUBJECTS.find((item) => item.id === subject)?.fileHint}」。
              </p>
            )}
            <Button type="button" size="lg" className="h-11" disabled={available === 0 || parsing} onClick={onStart}>
              <BookOpen />
              开始练习{available > 0 ? `（${planned} 题）` : ""}
            </Button>
            {stats ? (
              <Button type="button" variant="ghost" onClick={onClear}>
                清空这一科
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <Card className="sm:col-span-3">
          <CardHeader>
            <CardTitle>上传 PDF</CardTitle>
            <CardDescription>文本型 PDF。扫描图片抽不出文字。单文件不超过 80MB。</CardDescription>
          </CardHeader>
          <CardContent>
            <button
              type="button"
              disabled={parsing}
              onClick={onBrowse}
              onDragOver={(event) => {
                event.preventDefault();
                onDrag(true);
              }}
              onDragLeave={() => onDrag(false)}
              onDrop={(event) => {
                event.preventDefault();
                onDrag(false);
                const file = event.dataTransfer.files[0];
                if (file) onFile(file);
              }}
              className={cn(
                "flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors",
                dragging ? "border-primary bg-primary/5" : "border-border bg-background",
                parsing && "opacity-70",
              )}
            >
              <Upload className="size-5 text-primary" />
              <span className="text-sm font-medium">
                {parsing ? "正在抽取文字并拆分选择题…" : "把 PDF 拖到这里，或点击选择文件"}
              </span>
              <span className="text-xs leading-5 text-muted-foreground">
                当前科目：{subjectLabel(subject)}。解析在本地服务完成，题目写入本机数据库。
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onFile(file);
              }}
            />
          </CardContent>
        </Card>
      </div>

      {bank.meta?.warnings?.length ? (
        <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
          {bank.meta.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>练习范围</CardTitle>
          <CardDescription>
            这一科现有 {bank.questions.length} 道题，当前范围 {available} 道，本次抽 {planned} 道。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Tabs value={filter} onValueChange={(value) => onFilter(value as PracticeFilter)}>
            <TabsList className="h-auto w-full">
              <TabsTrigger value="all" className="h-9 flex-1">全部题型</TabsTrigger>
              <TabsTrigger value="single" className="h-9 flex-1">只练单选</TabsTrigger>
              <TabsTrigger value="multiple" className="h-9 flex-1">只练多选</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex flex-col gap-2">
            <Label>题量</Label>
            <div className="grid grid-cols-4 gap-2">
              {LIMITS.map((choice) => (
                <Button
                  key={choice}
                  type="button"
                  variant={limit === choice ? "default" : "outline"}
                  className="h-10"
                  onClick={() => onLimit(choice)}
                >
                  {choice === "all" ? "全部" : `${choice} 题`}
                </Button>
              ))}
            </div>
          </div>
          <Label className="items-start gap-3 leading-6">
            <Checkbox checked={shuffleOn} onCheckedChange={(checked) => onShuffle(checked)} />
            <span>打乱顺序。不勾选时按 PDF 中的题号往下做。</span>
          </Label>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/70 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-heading text-2xl leading-tight">{value}</dd>
    </div>
  );
}

function SessionView({
  session,
  questions,
  recordNote,
  onChange,
  onExit,
  onRecord,
  onFinish,
  onRetry,
}: {
  session: PracticeSession;
  questions: Question[];
  recordNote: string | null;
  onChange: (session: PracticeSession) => void;
  onExit: () => void;
  onRecord: (questionId: string, selected: string) => void;
  onFinish: (session: PracticeSession) => void;
  onRetry: () => void;
}) {
  const byId = useMemo(() => new Map(questions.map((question) => [question.id, question])), [questions]);
  const paper = session.questionIds
    .map((id) => byId.get(id))
    .filter((question): question is Question => Boolean(question));
  const summary = summarize(paper, session);
  const active = session.review ? summary.wrongOnes : paper;
  const index = Math.min(session.index, Math.max(active.length - 1, 0));
  const question = active[index];

  if (session.finished && !session.review) {
    return (
      <SummaryView
        session={session}
        summary={summary}
        recordNote={recordNote}
        onReview={() => onChange({ ...session, review: true, index: 0 })}
        onExit={onExit}
        onRetry={onRetry}
        onSave={() => onFinish(session)}
      />
    );
  }

  if (!question) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>这组题暂时打不开</CardTitle>
          <CardDescription>题库可能已被替换。回到首页重新开始即可。</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" onClick={onExit}>
            返回题库
          </Button>
        </CardContent>
      </Card>
    );
  }

  const selected = session.selections[question.id] ?? "";
  const revealed = session.revealed.includes(question.id) || session.finished;
  const verdict = verdictFor(question, selected, revealed);
  const progress = active.length === 0 ? 0 : Math.round(((index + 1) / active.length) * 100);

  function updateSelection(next: string) {
    if (revealed) return;
    onChange({
      ...session,
      selections: { ...session.selections, [question.id]: next },
    });
  }

  function reveal() {
    if (!selected || revealed) return;
    onChange({
      ...session,
      revealed: session.revealed.includes(question.id)
        ? session.revealed
        : [...session.revealed, question.id],
    });
    onRecord(question.id, selected);
  }

  function move(delta: number) {
    onChange({
      ...session,
      index: Math.min(active.length - 1, Math.max(0, index + delta)),
    });
  }

  function handIn() {
    if (session.finished) {
      onChange({ ...session, review: false });
      return;
    }
    const snapshot: PracticeSession = {
      ...session,
      selections: { ...session.selections },
      revealed: [...session.revealed],
    };
    onChange({
      ...session,
      finished: true,
      review: false,
      revealed: [...session.questionIds],
    });
    onFinish(snapshot);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{subjectShort(session.subject)}</Badge>
          <Badge variant="outline">{session.review ? "错题回看" : typeLabel(question.type)}</Badge>
          {session.source === "mistakes" ? <Badge variant="outline">错题练习</Badge> : null}
        </div>
        <Button type="button" variant="ghost" onClick={onExit}>
          返回题库
        </Button>
      </div>

      <Progress value={progress}>
        <ProgressLabel>
          第 {index + 1} / {active.length} 题
        </ProgressLabel>
        <ProgressValue />
      </Progress>

      <Card>
        <CardHeader>
          <CardTitle className="text-base leading-7">
            <span className="mr-2 font-heading text-primary">{question.number}.</span>
            {question.stem}
          </CardTitle>
          <CardDescription>
            {question.type === "single"
              ? "单项选择，选出一个选项后提交。"
              : "多项选择，选全且不错才算对。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {question.type === "single" ? (
            <RadioGroup
              value={selected}
              onValueChange={(value) => updateSelection(String(value ?? ""))}
            >
              {question.options.map((option) => (
                <OptionRow
                  key={option.key}
                  optionKey={option.key}
                  text={option.text}
                  mode={optionMode(option.key, question, selected, revealed)}
                  control={<RadioGroupItem value={option.key} disabled={revealed} />}
                />
              ))}
            </RadioGroup>
          ) : (
            <div className="grid gap-2">
              {question.options.map((option) => {
                const checked = selected.includes(option.key);
                return (
                  <OptionRow
                    key={option.key}
                    optionKey={option.key}
                    text={option.text}
                    mode={optionMode(option.key, question, selected, revealed)}
                    control={
                      <Checkbox
                        checked={checked}
                        disabled={revealed}
                        onCheckedChange={(next) => {
                          const letters = new Set(selected.split("").filter(Boolean));
                          if (next) letters.add(option.key);
                          else letters.delete(option.key);
                          updateSelection([...letters].sort().join(""));
                        }}
                      />
                    }
                  />
                );
              })}
            </div>
          )}

          {revealed ? <ResultBanner question={question} selected={selected} verdict={verdict} /> : null}
        </CardContent>
      </Card>

      {recordNote ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="status">
          {recordNote}
        </p>
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0">
        <Button type="button" variant="outline" className="h-11" disabled={index === 0} onClick={() => move(-1)}>
          上一题
        </Button>
        {!revealed ? (
          <Button type="button" className="h-11 flex-1 sm:flex-none" disabled={!selected} onClick={reveal}>
            提交本题
          </Button>
        ) : index < active.length - 1 ? (
          <Button type="button" className="h-11 flex-1 sm:flex-none" onClick={() => move(1)}>
            下一题
          </Button>
        ) : (
          <Button type="button" className="h-11 flex-1 sm:flex-none" onClick={handIn}>
            {session.review ? "返回小结" : "查看本次小结"}
          </Button>
        )}
        {session.review && index < active.length - 1 ? (
          <Button type="button" variant="secondary" className="h-11" onClick={handIn}>
            返回小结
          </Button>
        ) : null}
        {!session.review ? (
          <Button type="button" variant="secondary" className="h-11" onClick={handIn}>
            交卷
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function optionMode(
  key: string,
  question: Question,
  selected: string,
  revealed: boolean,
): "idle" | "picked" | "right" | "missed" | "wrong" {
  const picked = selected.includes(key);
  if (!revealed || !question.answer) return picked ? "picked" : "idle";
  const right = question.answer.includes(key);
  if (right && picked) return "right";
  if (right) return "missed";
  if (picked) return "wrong";
  return "idle";
}

function OptionRow({
  optionKey,
  text,
  mode,
  control,
}: {
  optionKey: string;
  text: string;
  mode: "idle" | "picked" | "right" | "missed" | "wrong";
  control: ReactNode;
}) {
  return (
    <Label
      className={cn(
        "items-start gap-3 rounded-xl border px-3 py-3 text-sm leading-6 font-normal",
        mode === "idle" && "border-border bg-card",
        mode === "picked" && "border-primary bg-primary/5",
        mode === "right" && "border-emerald-700 bg-emerald-50",
        mode === "missed" && "border-emerald-700/70 bg-emerald-50/80",
        mode === "wrong" && "border-rose-700 bg-rose-50",
      )}
    >
      {control}
      <span className="font-heading text-base leading-6">{optionKey}</span>
      <span className="flex-1">{text}</span>
      {mode === "right" || mode === "missed" ? <Check className="mt-0.5 size-4 text-emerald-700" /> : null}
      {mode === "wrong" ? <X className="mt-0.5 size-4 text-rose-700" /> : null}
    </Label>
  );
}

function ResultBanner({
  question,
  selected,
  verdict,
}: {
  question: Question;
  selected: string;
  verdict: Verdict;
}) {
  const tone =
    verdict === "correct"
      ? "border-emerald-700/40 bg-emerald-50 text-emerald-950"
      : verdict === "wrong"
        ? "border-rose-700/40 bg-rose-50 text-rose-950"
        : "border-border bg-muted/50";
  const title =
    verdict === "correct" ? "回答正确" : verdict === "wrong" ? "回答错误" : "这道题 PDF 里没有标准答案，不计入得分";

  return (
    <div className={cn("flex flex-col gap-2 rounded-xl border px-3 py-3 text-sm leading-6", tone)}>
      <p className="font-medium">{title}</p>
      <p>你的选择：{selected || "未作答"}</p>
      <p>{question.answer ? `正确答案：${question.answer}` : "本题 PDF 中未识别到答案"}</p>
      <Separator />
      <p>{question.explanation ? `解析：${question.explanation}` : "本题 PDF 中未提供解析。"}</p>
    </div>
  );
}

type Summary = ReturnType<typeof summarize>;

function summarize(paper: Question[], session: PracticeSession) {
  let correct = 0;
  let wrong = 0;
  let ungraded = 0;
  const wrongOnes: Question[] = [];
  for (const question of paper) {
    const revealed = session.finished || session.revealed.includes(question.id);
    const result = verdictFor(question, session.selections[question.id], revealed);
    if (result === "correct") correct += 1;
    if (result === "wrong") {
      wrong += 1;
      wrongOnes.push(question);
    }
    if (result === "ungraded") ungraded += 1;
  }
  return { correct, wrong, ungraded, wrongOnes, graded: correct + wrong };
}

function SummaryView({
  session,
  summary,
  recordNote,
  onReview,
  onExit,
  onRetry,
  onSave,
}: {
  session: PracticeSession;
  summary: Summary;
  recordNote: string | null;
  onReview: () => void;
  onExit: () => void;
  onRetry: () => void;
  onSave: () => void;
}) {
  const accuracy = summary.graded === 0 ? null : (summary.correct / summary.graded) * 100;
  const filterText =
    session.filter === "all" ? "全部题型" : session.filter === "single" ? "只练单选" : "只练多选";
  const sourceText = session.source === "mistakes" ? "错题练习" : "题库练习";

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>本次小结</CardTitle>
          <CardDescription>
            {subjectLabel(session.subject)} · {sourceText} · {filterText} · {session.questionIds.length} 道
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="得分" value={`${summary.correct}/${summary.graded || 0}`} />
            <Stat label="正确率" value={accuracy === null ? "—" : formatPercent(accuracy)} />
            <Stat label="错题" value={`${summary.wrong}`} />
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            有标准答案的题才计入得分，未作答按错误计算。多选题必须与答案完全一致。答错和交卷时未作答的题会进入错题库，之后做对一次就移出。这次成绩会留在历史记录里。
            {summary.ungraded > 0
              ? ` 另有 ${summary.ungraded} 道题 PDF 中未识别到答案，没有算进正确率。`
              : ""}
          </p>
          {recordNote ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-destructive" role="status">{recordNote}</p>
              <Button type="button" variant="outline" onClick={onSave}>
                重新保存这次成绩
              </Button>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="h-11" disabled={summary.wrongOnes.length === 0} onClick={onReview}>
              回看错题
            </Button>
            <Button type="button" variant="outline" className="h-11" onClick={onRetry}>
              <RotateCcw />
              再练这组
            </Button>
            <Button type="button" variant="secondary" className="h-11" onClick={onExit}>
              返回题库
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>错题</CardTitle>
          <CardDescription>
            {summary.wrongOnes.length === 0 ? "这次没有错题。" : `共 ${summary.wrongOnes.length} 道，点进去可以对照解析。`}
          </CardDescription>
        </CardHeader>
        {summary.wrongOnes.length > 0 ? (
          <CardContent>
            <ScrollArea className="h-80">
              <ul className="flex flex-col gap-3 pr-3">
                {summary.wrongOnes.map((question) => (
                  <li key={question.id} className="rounded-lg border px-3 py-3 text-sm leading-6">
                    <p className="font-medium">
                      {question.number}. {question.stem}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      你的选择 {session.selections[question.id] || "未作答"} · 正确答案{" "}
                      {question.answer ?? "本题 PDF 中未识别到答案"}
                    </p>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}

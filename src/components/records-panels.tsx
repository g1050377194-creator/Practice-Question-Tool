"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { subjectLabel, type AttemptDetail, type AttemptSummary, type MistakeRecord, type SubjectId } from "@/lib/types";
import { useState } from "react";

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

function choiceText(selected: string): string {
  return selected || "未作答";
}

function filterText(filter: AttemptSummary["filter"]): string {
  if (filter === "single") return "只练单选";
  if (filter === "multiple") return "只练多选";
  return "全部题型";
}

export function MistakePanel({
  subject,
  mistakes,
  onPractice,
  onDismiss,
  onClear,
}: {
  subject: SubjectId;
  mistakes: MistakeRecord[];
  onPractice: (questionIds: string[]) => void;
  onDismiss: (questionId: string) => void;
  onClear: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const ids = mistakes.map((item) => item.question.id);

  return (
    <Card>
      <CardHeader>
        <CardTitle>错题库</CardTitle>
        <CardDescription>
          {mistakes.length === 0
            ? "答错，或交卷时还没做的题，会出现在这里。做对一次就移出。"
            : `${subjectLabel(subject)}有 ${mistakes.length} 道还没掌握。按最近答错的时间排列，做对一次就移出。`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="h-11" disabled={ids.length === 0} onClick={() => onPractice(ids)}>
            练习全部错题{ids.length > 0 ? `（${ids.length}）` : ""}
          </Button>
          {ids.length > 20 ? (
            <Button type="button" variant="outline" className="h-11" onClick={() => onPractice(ids.slice(0, 20))}>
              只练最近 20 道
            </Button>
          ) : null}
          {ids.length > 0 ? (
            <Button type="button" variant="ghost" className="h-11" onClick={onClear}>
              清空错题库
            </Button>
          ) : null}
        </div>
        {mistakes.length > 0 ? (
          <ScrollArea className="h-[32rem]">
            <ul className="flex flex-col gap-3 pr-3">
              {mistakes.map((item) => {
                const open = openId === item.question.id;
                return (
                  <li key={item.question.id} className="rounded-lg border px-3 py-3 text-sm leading-6">
                    <p className="font-medium">
                      {item.question.number}. {item.question.stem}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      上次选择 {choiceText(item.lastSelected)} · 正确答案 {item.question.answer ?? "本题没有标准答案"} ·
                      错过 {item.wrongCount} 次 · {formatWhen(item.lastWrongAt)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setOpenId(open ? null : item.question.id)}
                      >
                        {open ? "收起记录" : `答错记录（${item.events.length}）`}
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => onDismiss(item.question.id)}>
                        移出
                      </Button>
                    </div>
                    {open ? (
                      <ol className="mt-3 flex flex-col gap-2 border-t pt-3">
                        {item.events.map((event, index) => (
                          <li key={`${event.createdAt}-${event.selected}-${index}`}>
                            {formatWhen(event.createdAt)} 选择了 {choiceText(event.selected)}
                          </li>
                        ))}
                        {item.question.explanation ? (
                          <li className="text-muted-foreground">解析：{item.question.explanation}</li>
                        ) : null}
                      </ol>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function HistoryPanel({ subject, attempts }: { subject: SubjectId; attempts: AttemptSummary[] }) {
  const rows = attempts.filter((item) => item.subject === subject);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AttemptDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  async function toggle(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setLoading(true);
    setDetailError(null);
    try {
      const response = await fetch(`/api/attempts/${encodeURIComponent(id)}`);
      const payload = (await response.json()) as AttemptDetail & { error?: string };
      if (!response.ok) throw new Error(payload.error);
      setDetail(payload);
    } catch {
      setDetail(null);
      setDetailError("这次记录没有读出来。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>历史记录</CardTitle>
        <CardDescription>
          {rows.length === 0
            ? "交卷之后，每次练习的题量、得分和错题会留在这里。"
            : `${subjectLabel(subject)}最近 ${rows.length} 次交卷。`}
        </CardDescription>
      </CardHeader>
      {rows.length > 0 ? (
        <CardContent>
          <ScrollArea className="h-[32rem]">
            <ul className="flex flex-col gap-3 pr-3">
              {rows.map((item) => {
                const graded = item.correctCount + item.wrongCount;
                const accuracy = graded === 0 ? null : (item.correctCount / graded) * 100;
                const open = openId === item.id;
                const wrongOnes = detail?.id === item.id ? detail.answers.filter((answer) => answer.verdict === "wrong") : [];
                return (
                  <li key={item.id} className="rounded-lg border px-3 py-3 text-sm leading-6">
                    <p className="font-medium">
                      {formatWhen(item.finishedAt)} · {item.source === "mistakes" ? "错题练习" : "题库练习"} ·{" "}
                      {filterText(item.filter)}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {item.correctCount}/{graded} · {accuracy === null ? "没有可计分的题" : formatPercent(accuracy)} · 错{" "}
                      {item.wrongCount}
                      {item.ungradedCount > 0 ? ` · ${item.ungradedCount} 道没有标准答案` : ""}
                    </p>
                    <Button type="button" variant="outline" className="mt-2" onClick={() => void toggle(item.id)}>
                      {open ? "收起" : "查看错题"}
                    </Button>
                    {open ? (
                      <div className="mt-3 border-t pt-3">
                        {loading ? <p className="text-muted-foreground">正在读取这次记录…</p> : null}
                        {detailError ? <p className="text-destructive">{detailError}</p> : null}
                        {detail?.id === item.id && !loading ? (
                          wrongOnes.length === 0 ? (
                            <p className="text-muted-foreground">这次没有错题。</p>
                          ) : (
                            <ul className="flex flex-col gap-3">
                              {wrongOnes.map((answer) => (
                                <li key={answer.questionId}>
                                  <p className="font-medium">
                                    {answer.number}. {answer.stem}
                                  </p>
                                  <p className="text-muted-foreground">
                                    你的选择 {choiceText(answer.selected)} · 正确答案 {answer.answer ?? "本题没有标准答案"}
                                  </p>
                                </li>
                              ))}
                            </ul>
                          )
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        </CardContent>
      ) : null}
    </Card>
  );
}

export type Verdict = "pending" | "correct" | "wrong" | "ungraded";

export function gradeAnswer(
  answer: string | null,
  selected: string | undefined,
  revealed: boolean,
): Verdict {
  if (!revealed) return "pending";
  if (!answer) return "ungraded";
  return selected && selected === answer ? "correct" : "wrong";
}

export function normalizeSelected(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 12) return null;
  const upper = value.toUpperCase();
  if (!/^[A-E]*$/.test(upper)) return null;
  return [...new Set(upper)].sort().join("");
}

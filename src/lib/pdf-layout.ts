export type PdfTextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
};

function isCjk(char: string | undefined): boolean {
  return !!char && /[\u4e00-\u9fff]/.test(char);
}

/** 按纵坐标把同一行的文字拼起来，中文紧挨着不插空格。 */
export function joinLine(items: PdfTextItem[]): string {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  let out = "";
  let prev: PdfTextItem | null = null;

  for (const item of sorted) {
    const text = item.str.replace(/\s+/g, " ");
    if (!text) continue;
    if (!prev) {
      out += text;
      prev = item;
      continue;
    }

    const gap = item.x - (prev.x + Math.max(prev.width, 0));
    const size = Math.max(prev.fontSize || 10, item.fontSize || 10, 8);
    const overlap = gap < -size * 0.15;
    if (overlap && text.trim() === prev.str.trim()) continue;

    const prevChar = out.at(-1);
    const nextChar = text.trimStart().at(0);
    if (gap > size * 0.42 && !(isCjk(prevChar) && isCjk(nextChar) && gap < size * 0.8)) {
      out += " ";
    }
    out += text;
    prev = item;
  }

  return out.replace(/[ \t]{2,}/g, " ").trim();
}

function splitColumns(items: PdfTextItem[]): PdfTextItem[][] {
  if (items.length < 8) return [items];
  const minX = Math.min(...items.map((item) => item.x));
  const maxRight = Math.max(...items.map((item) => item.x + Math.max(item.width, 1)));
  const span = maxRight - minX;
  if (span < 360) return [items];

  // 按文字左边缘分栏。长句的几何中心会偏到页面右侧，拿中心分栏会把单栏拆碎。
  const bins = 36;
  const counts = new Array<number>(bins).fill(0);
  for (const item of items) {
    const index = Math.min(
      bins - 1,
      Math.max(0, Math.floor(((item.x - minX) / span) * bins)),
    );
    counts[index] += 1;
  }

  const lo = Math.floor(bins * 0.28);
  const hi = Math.floor(bins * 0.72);
  let valley = lo;
  let valleyCount = Number.POSITIVE_INFINITY;
  for (let index = lo; index <= hi; index += 1) {
    if (counts[index] < valleyCount) {
      valleyCount = counts[index];
      valley = index;
    }
  }

  const leftCount = counts.slice(0, valley).reduce((sum, count) => sum + count, 0);
  const rightCount = counts.slice(valley + 1).reduce((sum, count) => sum + count, 0);
  const total = leftCount + rightCount + counts[valley];
  if (
    valleyCount <= 1 &&
    leftCount >= 4 &&
    rightCount >= 4 &&
    leftCount > total * 0.25 &&
    rightCount > total * 0.25
  ) {
    const splitX = minX + ((valley + 0.5) / bins) * span;
    const left = items.filter((item) => item.x < splitX);
    const right = items.filter((item) => item.x >= splitX);
    if (left.length >= 4 && right.length >= 4) return [left, right];
  }

  return [items];
}

function columnToText(items: PdfTextItem[]): string {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfTextItem[][] = [];

  for (const item of sorted) {
    const current = lines.at(-1);
    const size = item.fontSize || item.height || 10;
    if (!current) {
      lines.push([item]);
      continue;
    }
    const yRef = current.reduce((sum, entry) => sum + entry.y, 0) / current.length;
    const tolerance = Math.max(2.2, size * 0.45);
    if (Math.abs(item.y - yRef) <= tolerance) current.push(item);
    else lines.push([item]);
  }

  return lines
    .map((line) => joinLine(line))
    .filter(Boolean)
    .join("\n");
}

export function itemsToPageText(items: PdfTextItem[]): string {
  const content = items.filter((item) => item.str && item.str.trim());
  if (!content.length) return "";
  return splitColumns(content)
    .map((column) => columnToText(column))
    .filter(Boolean)
    .join("\n");
}

function isRepeatedChrome(line: string): boolean {
  const text = line.trim();
  if (!text) return true;
  if (/^\d{1,4}$/.test(text)) return true;
  if (/^第\s*\d+\s*页(?:\s*共\s*\d+\s*页)?$/.test(text)) return true;
  if (/^[-—–_]{2,}\s*\d+\s*[-—–_]{2,}$/.test(text)) return true;
  return false;
}

/** 去掉每页重复的页眉页脚，再拼成一份文稿。 */
export function pagesToDocument(pages: string[]): string {
  const linePages = pages.map((page) =>
    page
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line) => line && !isRepeatedChrome(line)),
  );
  const populated = linePages.filter((lines) => lines.length > 0);
  if (populated.length < 3) {
    return populated.map((lines) => lines.join("\n")).join("\n\n");
  }

  const threshold = Math.ceil(populated.length * 0.45);
  const countEdges = (pick: (lines: string[]) => string | undefined) => {
    const freq = new Map<string, number>();
    for (const lines of populated) {
      const edge = pick(lines);
      if (!edge || edge.length > 48) continue;
      freq.set(edge, (freq.get(edge) ?? 0) + 1);
    }
    return new Set(
      [...freq.entries()].filter(([, count]) => count >= threshold).map(([line]) => line),
    );
  };

  const dropFirst = countEdges((lines) => lines[0]);
  const dropLast = countEdges((lines) => lines.at(-1));

  return linePages
    .map((lines) => {
      const copy = [...lines];
      if (copy.length && dropFirst.has(copy[0])) copy.shift();
      if (copy.length && dropLast.has(copy.at(-1) ?? "")) copy.pop();
      return copy.join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

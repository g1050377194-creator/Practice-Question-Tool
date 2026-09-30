import { readFileSync } from "node:fs";
import { extractTextItems } from "unpdf";
import { itemsToPageText, pagesToDocument } from "../src/lib/pdf-layout.ts";
import { parseQuestionBank } from "../src/lib/parse-questions.ts";

async function main() {
const bytes = new Uint8Array(readFileSync("/tmp/civil-600.pdf"));
const result = await extractTextItems(bytes);
console.log("pages", result.totalPages);
const first = result.items[0] ?? [];
console.log("item count", first.length);
console.log(JSON.stringify(first.slice(0, 15), null, 2));
const pages = result.items.map((page) => itemsToPageText(page));
console.log("---PAGE---");
console.log(pages.join("\n----PAGE----\n"));
console.log("---PARSE---");
const doc = pagesToDocument(pages);
const parsed = parseQuestionBank(doc, "civil");
console.log(parsed.stats);
console.log(parsed.warnings);
console.log(parsed.questions.map((question) => [question.number, question.answer, question.stem.slice(0, 24)]));
}

void main();

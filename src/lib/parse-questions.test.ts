import assert from "node:assert/strict";
import test from "node:test";
import { itemsToPageText, joinLine, pagesToDocument, type PdfTextItem } from "./pdf-layout";
import { parseQuestionBank } from "./parse-questions";

const inlinePaper = `
2026二造土建《600母题》
第一章 工程造价构成

一、单项选择题

1.从投资者的角度，工程造价是指（ ）。
A.建设项目总投资
B.建设工程总投资
C.建安工程价格
D.工程承发包价格
【答案】A
【解析】投资者角度的工程造价，是指建设一项工程预期开支或实际开支的全部固定资产投资费用。

2.下列费用中，属于建安工程费中措施项目费的是（ ）。
A.文明施工费
B.材料费
C.企业管理费
D.利润
答案：A
解析：文明施工费列入措施项目费。

二、多项选择题

1.工程造价的含义包括（ ）。
A.从投资者角度
B.从承包商角度
C.从设计单位角度
D.从咨询单位角度
E.仅指建安工程费
【答案】A、B
【解析】工程造价有两种含义，分别对应投资者和承包方。
`;

test("抽取题后答案与分节题型", () => {
  const result = parseQuestionBank(inlinePaper, "civil");
  assert.equal(result.stats.total, 3);
  assert.equal(result.stats.single, 2);
  assert.equal(result.stats.multiple, 1);
  assert.equal(result.stats.withoutAnswer, 0);
  assert.equal(result.questions[0]?.answer, "A");
  assert.match(result.questions[0]?.explanation ?? "", /固定资产投资/);
  assert.equal(result.questions[0]?.options.length, 4);
  assert.equal(result.questions[1]?.stem.includes("措施项目费"), true);
  assert.equal(result.questions[2]?.type, "multiple");
  assert.equal(result.questions[2]?.answer, "AB");
  assert.equal(result.questions[2]?.options[4]?.key, "E");
});

test("题目区和答案区分开时按题号回填", () => {
  const text = `
一、单项选择题

1.关于静态投资的说法，正确的是（ ）。
A.包含建设期利息
B.包含涨价预备费
C.不含建设期利息和涨价预备费
D.只含设备费

2.价值工程的核心是（ ）。
A.功能分析
B.成本分析
C.方案创造
D.对象选择

二、多项选择题

1.下列属于动态投资的有（ ）。
A.建设期利息
B.涨价预备费
C.基本预备费
D.设备购置费
E.建安工程费

参考答案及解析
一、单项选择题
1.C
【解析】静态投资不含建设期贷款利息和涨价预备费。
2.A
【解析】价值工程的核心是功能分析。
二、多项选择题
1.AB
【解析】动态投资包括涨价预备费和建设期利息。
`;
  const result = parseQuestionBank(text, "management");
  assert.equal(result.stats.total, 3);
  assert.deepEqual(
    result.questions.map((question) => question.answer),
    ["C", "A", "AB"],
  );
  assert.match(result.questions[0]?.explanation ?? "", /涨价预备费/);
  assert.equal(result.questions[2]?.type, "multiple");
  assert.equal(result.questions[0]?.subject, "management");
});

test("同一行选项、全角字符、缺失答案", () => {
  const text = `
１．工程定额按主编单位和使用范围分类，可分为（ ）。
Ａ．行业定额 Ｂ．企业定额 Ｃ．全国统一定额 Ｄ．补充定额
【答案】ＡＢＣ

2.暂列金额是指（ ）。
A.用于工程变更的暂定金额
B.用于利润
C.用于税金
D.用于规费
`;
  const result = parseQuestionBank(text, "civil");
  assert.equal(result.stats.total, 2);
  assert.equal(result.questions[0]?.answer, "ABC");
  assert.equal(result.questions[0]?.type, "multiple");
  assert.equal(result.questions[0]?.options.length, 4);
  assert.equal(result.questions[1]?.answer, null);
  assert.equal(result.stats.withoutAnswer, 1);
  assert.match(result.warnings.join(""), /未识别到答案/);
});

test("母题标题和章节答案区", () => {
  const text = `
母题1 从投资者的角度，工程造价是指（ ）。
A.建设一项工程预期开支或实际开支的全部固定资产投资费用
B.工程承发包价格
C.建安工程费
D.设备购置费
【答案】A
【解析】第一种含义是投资费用。

母题2 工程造价的第二种含义是（ ）。
A.建设工程总投资
B.工程承发包价格
C.流动资金
D.建设期利息

参考答案
2.B
【解析】第二种含义是工程发承包价格。
`;
  const result = parseQuestionBank(text, "civil");
  assert.equal(result.stats.total, 2);
  assert.match(result.questions[0]?.stem ?? "", /^从投资者/);
  assert.equal(result.questions[0]?.answer, "A");
  assert.equal(result.questions[1]?.answer, "B");
  assert.match(result.questions[1]?.explanation ?? "", /发承包/);
});

test("紧凑答案行 1.C 2.A", () => {
  const text = `
一、单项选择题
1.关于规费的说法，正确的是（ ）。
A.属于措施项目费
B.属于企业管理费
C.属于规费，由社会保险费和住房公积金组成
D.属于税金
2.安全文明施工费应计入（ ）。
A.措施项目费
B.分部分项工程费
C.其他项目费
D.规费

1.C 2.A
`;
  const result = parseQuestionBank(text, "civil");
  assert.deepEqual(
    result.questions.map((question) => [question.number, question.answer]),
    [
      [1, "C"],
      [2, "A"],
    ],
  );
});

test("按坐标还原行，双栏先左后右，单栏长短行不拆开", () => {
  const item = (str: string, x: number, y: number, width: number): PdfTextItem => ({
    str,
    x,
    y,
    width,
    height: 12,
    fontSize: 12,
  });
  const merged = joinLine([
    item("工程", 48, 700, 24),
    item("造价", 74, 700, 24),
  ]);
  assert.equal(merged, "工程造价");

  const columns: PdfTextItem[] = [];
  for (let index = 0; index < 5; index += 1) {
    columns.push(item(`左${index}栏题干内容`, 40, 700 - index * 18, 110));
    columns.push(item(`右${index}栏题干内容`, 340, 700 - index * 18, 110));
  }
  const page = itemsToPageText(columns);
  const leftLine = page.split("\n").find((line) => line.includes("左0"));
  assert.equal(leftLine?.includes("右"), false);
  assert.ok(page.indexOf("左4") < page.indexOf("右0"));

  const single: PdfTextItem[] = [];
  for (let index = 0; index < 4; index += 1) {
    single.push(item(`${index + 1}.C`, 48, 720 - index * 36, 24));
    single.push(item(`【解析】第${index + 1}题的说明文字比较长，会占满一行。`, 48, 702 - index * 36, 460));
  }
  const ordered = itemsToPageText(single);
  assert.ok(ordered.indexOf("1.C") < ordered.indexOf("第1题"));
  assert.ok(ordered.indexOf("第1题") < ordered.indexOf("2.C"));
  assert.ok(ordered.indexOf("2.C") < ordered.indexOf("第2题"));
});

test("参考答案、第N题、紧凑答案和详解", () => {
  const text = `
【母题精练·单选题】
第1题 下列费用属于措施项目费的是（ ）。
A
文明施工费
B.材料费
C.企业管理费
D.利润
【参考答案】A
【详解】文明施工费列入措施项目费。

【母题精练·多选题】
第2题 动态投资包括（ ）。
A.建设期利息
B.涨价预备费
C.基本预备费
D.设备购置费
E.建安工程费

【答案与解析】
1.答案：A
详解：已在题后给出。
2.答案：AB
【解析】动态投资含建设期利息和涨价预备费。
`;
  const result = parseQuestionBank(text, "civil");
  assert.equal(result.stats.total, 2);
  assert.equal(result.questions[0]?.type, "single");
  assert.equal(result.questions[0]?.answer, "A");
  assert.equal(result.questions[0]?.options[0]?.text.includes("文明施工费"), true);
  assert.match(result.questions[0]?.explanation ?? "", /措施项目费/);
  assert.equal(result.questions[1]?.type, "multiple");
  assert.equal(result.questions[1]?.answer, "AB");
  assert.match(result.questions[1]?.explanation ?? "", /涨价预备费/);
  assert.deepEqual(
    result.questions.map((question) => question.order),
    [0, 1],
  );
});

test("答案区写成 1A 2BCD", () => {
  const text = `
一、单项选择题
1.关于规费的说法，正确的是（ ）。
A.属于措施项目费
B.属于企业管理费
C.属于规费
D.属于税金
2.安全文明施工费应计入（ ）。
A.措施项目费
B.分部分项工程费
C.其他项目费
D.规费
1A 2A
`;
  const result = parseQuestionBank(text, "management");
  assert.deepEqual(
    result.questions.map((question) => question.answer),
    ["A", "A"],
  );
});

test("重复页眉只保留一次正文", () => {
  const page = (body: string) => `2026二造管理600母题\n${body}\n12`;
  const doc = pagesToDocument([
    page("1.第一页题干出现在这里"),
    page("2.第二页继续"),
    page("3.第三页仍在"),
  ]);
  assert.equal(doc.match(/2026二造管理600母题/g)?.length ?? 0, 0);
  assert.match(doc, /第一页题干/);
  assert.match(doc, /第三页仍在/);
});

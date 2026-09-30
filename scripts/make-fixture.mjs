import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const fontBytes = readFileSync("/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf");

const civil = `2026二造土建《600母题》
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
3.暂列金额是指（ ）。
A.用于工程变更的暂定金额
B.用于利润
C.用于税金
D.用于规费
二、多项选择题
1.工程造价的含义包括（ ）。
A.从投资者角度
B.从承包商角度
C.从设计单位角度
D.从咨询单位角度
E.仅指建安工程费
【答案】A、B
【解析】工程造价有两种含义，分别对应投资者和承包方。
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
参考答案及解析
一、单项选择题
1.C
【解析】静态投资不含建设期贷款利息和涨价预备费。
2.A
【解析】价值工程的核心是功能分析。
`;

const management = `2026二造管理《600母题》
一、单项选择题
母题1 从投资者的角度，工程造价是指（ ）。
A.建设一项工程预期开支或实际开支的全部固定资产投资费用
B.工程承发包价格
C.建安工程费
D.设备购置费
【答案】A
【解析】第一种含义是投资费用。
1.工程定额按主编单位和使用范围分类，可分为（ ）。
A.行业定额 B.企业定额 C.全国统一定额 D.补充定额
【答案】ABC
`;

async function build(text, outPath) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: false });
  const lines = text.trim().split("\n");
  let page = pdf.addPage([595, 842]);
  let y = 800;
  let pageNo = 1;
  const paintHeader = () => {
    page.drawText(String(pageNo), { x: 280, y: 820, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
  };
  paintHeader();
  for (const line of lines) {
    if (y < 64) {
      page = pdf.addPage([595, 842]);
      pageNo += 1;
      y = 800;
      paintHeader();
    }
    page.drawText(line, { x: 48, y, size: 11, font, color: rgb(0, 0, 0) });
    y -= 18;
  }
  writeFileSync(outPath, await pdf.save());
}

await build(civil, "/tmp/civil-600.pdf");
await build(management, "/tmp/management-600.pdf");
console.log("wrote fixtures");

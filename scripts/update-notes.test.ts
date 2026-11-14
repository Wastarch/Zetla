// M1-13 · 更新说明解析单测（Node 直接跑）：
//   node --experimental-strip-types scripts/update-notes.test.ts
import { countNoteLines, parseNotes } from "../src/modules/updater/notes.ts";

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log("  ✓ " + msg);
  } else {
    failed++;
    console.error("  ✗ " + msg);
  }
}

// ── 1) 空输入 ────────────────────────────────────────────────
console.log("\n== 1) 空输入 ==");
check(parseNotes(undefined).length === 0, "undefined → 空数组");
check(parseNotes("").length === 0, "空串 → 空数组");
check(parseNotes("   \n\t\n ").length === 0, "全空白 → 空数组");
check(parseNotes([]).length === 0, "空数组入参 → 空数组");

// ── 2) 段落 ──────────────────────────────────────────────────
console.log("\n== 2) 段落 ==");
const one = parseNotes("新增内置终端模块");
check(one.length === 1 && one[0].type === "para", "单行 → 1 个段落块");

const twoLines = parseNotes("第一行\n第二行");
check(
  twoLines.length === 1 && twoLines[0].type === "para" && twoLines[0].text.includes("\n"),
  "无标记的连续两行 → 同一段落（换行保留，不误判成列表）",
);

const twoParas = parseNotes("第一段\n\n第二段");
check(twoParas.length === 2, "空行分段 → 2 个段落块");

const padded = parseNotes("\n\n  正文  \n\n");
check(padded.length === 1 && padded[0].type === "para" && padded[0].text === "正文", "首尾空行与行尾空白被裁掉");

// ── 3) 标题 ──────────────────────────────────────────────────
console.log("\n== 3) 标题 ==");
const h = parseNotes("## 新增\n正文");
check(h.length === 2 && h[0].type === "heading" && h[0].text === "新增", "`## ` → 标题块");
check(
  parseNotes("# 标题 #").length === 1 && parseNotes("# 标题 #")[0].type === "heading",
  "ATX 闭合式 `# 标题 #` 也识别为标题",
);
const notHeading = parseNotes("#hashtag");
check(notHeading.length === 1 && notHeading[0].type === "para", "`#` 后无空格 → 按普通段落处理");
const deepHeading = parseNotes("###### 六级");
check(deepHeading[0].type === "heading" && deepHeading[0].text === "六级", "支持 h1–h6");

// ── 4) 无序列表 ──────────────────────────────────────────────
console.log("\n== 4) 无序列表 ==");
const bullets = parseNotes("- 甲\n- 乙\n* 丙\n• 丁\n+ 戊");
check(bullets.length === 1 && bullets[0].type === "list", "五种符号的连续条目 → 同一个列表块");
check(bullets[0].type === "list" && bullets[0].items.length === 5, "5 条并入同一列表");
check(bullets[0].type === "list" && bullets[0].ordered === false, "unordered 标记正确");

const star = parseNotes("*强调*");
check(star.length === 1 && star[0].type === "para", "`*强调*`（星号后无空格）不误判为列表");

// ── 5) 有序列表 ──────────────────────────────────────────────
console.log("\n== 5) 有序列表 ==");
const ordered = parseNotes("1. 一\n2) 二\n3、三");
check(ordered.length === 1 && ordered[0].type === "list" && ordered[0].ordered === true, "1./2)/3、 → 有序列表");
check(ordered[0].type === "list" && ordered[0].items.join() === "一,二,三", "有序列表条目文本正确");
check(ordered[0].type === "list" && ordered[0].items.length === 3, "3 条有序条目");

// ── 6) 混排 ──────────────────────────────────────────────────
console.log("\n== 6) 混排 ==");
const mixed = parseNotes("## 修复\n- 甲\n- 乙\n\n普通段落\n1. 一\n2. 二");
check(mixed.length === 4, "标题 / 列表 / 段落 / 列表 → 4 块");
check(
  mixed[0].type === "heading" && mixed[1].type === "list" && mixed[2].type === "para" && mixed[3].type === "list",
  "块类型顺序正确",
);
const switchKind = parseNotes("- 甲\n1. 一");
check(
  switchKind.length === 2 &&
    switchKind[0].type === "list" &&
    switchKind[1].type === "list" &&
    switchKind[0].ordered !== switchKind[1].ordered,
  "无序紧跟有序 → 拆成两个列表（不互相吞并）",
);
check(
  mixed[3].type === "list" && mixed[3].ordered === true,
  "混排中的有序列表标记正确",
);

// ── 7) 入参与换行归一 ────────────────────────────────────────
console.log("\n== 7) 入参与换行 ==");
const arr = parseNotes(["- 甲", "- 乙"]);
check(arr.length === 1 && arr[0].type === "list" && arr[0].items.length === 2, "字符串数组 → 逐行解析");
const crlf = parseNotes("- 甲\r\n- 乙");
check(crlf.length === 1 && crlf[0].type === "list" && crlf[0].items.length === 2, "CRLF 换行被归一");
const cr = parseNotes("- 甲\r- 乙");
check(cr.length === 1 && cr[0].type === "list" && cr[0].items.length === 2, "单独 CR 换行被归一");

// ── 8) 行数估算（决定是否折叠） ──────────────────────────────
console.log("\n== 8) 行数估算 ==");
check(countNoteLines([]) === 0, "空块 → 0 行");
check(countNoteLines(parseNotes("- 甲\n- 乙\n- 丙")) === 3, "3 条列表 → 3 行");
check(countNoteLines(parseNotes("## 标题")) === 2, "标题按 1.5 行 → ceil 2");
check(countNoteLines(parseNotes("字".repeat(46))) === 1, "46 字 → 1 行");
check(countNoteLines(parseNotes("字".repeat(47))) === 2, "47 字 → 2 行");
check(
  countNoteLines(parseNotes("## 新增\n- 甲\n- 乙\n- 丙\n- 丁\n- 戊")) === 7,
  "标题 + 5 条 → 7 行（> 6 触发折叠）",
);

// ── 汇总 ─────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "全部通过" : "存在失败"}：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);

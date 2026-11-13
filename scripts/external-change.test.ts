// 外部文件修改判断回归测试：
// node --experimental-strip-types scripts/external-change.test.ts
import {
  hasMeaningfulExternalChange,
  savedBaselineKey,
  type EditorDiskState,
} from "../src/project/externalChange.ts";

let passed = 0;
let failed = 0;

function check(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

const clean: EditorDiskState = {
  content: "原内容\n",
  savedContent: "原内容\n",
  encoding: "utf-8",
  eol: "lf",
};

console.log("\n== 外部文件修改提醒 ==");
check(
  hasMeaningfulExternalChange(
    { content: "外部新内容\n", encoding: "utf-8", eol: "lf" },
    clean,
  ),
  "干净缓冲遇到真实外部内容修改时提醒",
);

const dirty: EditorDiskState = {
  ...clean,
  content: "本地未保存内容\n",
};
check(
  hasMeaningfulExternalChange(
    { content: "外部另一版本\n", encoding: "utf-8", eol: "lf" },
    dirty,
  ),
  "本地未保存且外部产生第三个版本时提醒冲突",
);
check(
  !hasMeaningfulExternalChange(
    { content: "原内容\r\n", encoding: "UTF-8", eol: "crlf" },
    { ...dirty, eol: "crlf" },
  ),
  "延迟事件仍指向保存基线时不误报（兼容编辑器 LF 与磁盘 CRLF）",
);
check(
  !hasMeaningfulExternalChange(
    { content: "本地未保存内容\n", encoding: "utf-8", eol: "lf" },
    dirty,
  ),
  "磁盘已与当前编辑内容一致时不提示无意义重载",
);
check(
  hasMeaningfulExternalChange(
    { content: "原内容\r\n", encoding: "utf-8", eol: "crlf" },
    clean,
  ),
  "只有换行格式被外部修改时仍提醒",
);
check(
  hasMeaningfulExternalChange(
    { content: "原内容\n", encoding: "gbk", eol: "lf" },
    clean,
  ),
  "只有编码被外部修改时仍提醒",
);

const savedAfterEvent: EditorDiskState = {
  ...dirty,
  savedContent: dirty.content,
};
check(
  savedBaselineKey(dirty) !== savedBaselineKey(savedAfterEvent),
  "异步读取期间保存会改变基线，使旧事件可以被丢弃",
);

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);

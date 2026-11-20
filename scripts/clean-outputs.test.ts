// M1-41 · 手动清理确认文案纯逻辑单测
// 运行：node --experimental-strip-types scripts/clean-outputs.test.ts
// 约束：不 import store / editor / @/ 别名，纯函数直跑。
import { formatCleanMessage } from "../src/project/cleanOutputs.ts";

let failures = 0;
let total = 0;
function eq<T>(got: T, want: T, msg: string) {
  total++;
  console.log(
    (Object.is(got, want) ? "  ✓ " : "  ✗ ") +
      `${msg}（得到 ${String(got)}，期望 ${String(want)}）`,
  );
  if (!Object.is(got, want)) failures++;
}
function has(text: string, needle: string, msg: string) {
  eq(text.includes(needle), true, msg);
}

const three = formatCleanMessage(["build/main.pdf", "build/main.aux", "build/log/ch.log"], 3, "构建产物目录：build");
has(three, "共 3 个文件", "总数写入文案");
has(three, "build/main.pdf", "列出 PDF（新规则下算产物）");
has(three, "build/log/ch.log", "列出子目录内产物");
has(three, "构建产物目录：build", "范围写入文案");
eq(three.includes("还有"), false, "少量文件不显示省略摘要");

const many = Array.from({ length: 12 }, (_, i) => `build/f${i}.aux`);
const big = formatCleanMessage(many, 20, "构建产物目录：build");
has(big, "共 20 个文件", "大量文件用 total 而非清单长度");
has(big, "还有 8 个", "省略数量正确");
has(big, "build/f11.aux", "前 12 条完整列出");
eq(big.includes("build/f12.aux"), false, "超出 12 条不再列出");

const none = formatCleanMessage([], 0, "主文件所在目录");
has(none, "主文件所在目录", "无 outputDir 时显示主文件目录");

console.log(`\n${total - failures}/${total} passed`);
if (failures > 0) process.exit(1);

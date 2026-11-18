// 外部文件改动 → 标签自动重载的纯判断单测
// 运行：node --experimental-strip-types scripts/external-reload.test.ts
// 只 import 无 @/ 别名的纯逻辑模块（相对 import 带 .ts 后缀）
import {
  sameTextIgnoringEol,
  shouldReloadOnExternalChange,
  type ExternalReloadCandidate,
} from "../src/editor/externalReload.ts";

let failures = 0;
let total = 0;
function check(cond: boolean, msg: string) {
  total++;
  console.log((cond ? "  ✓ " : "  ✗ ") + msg);
  if (!cond) failures++;
}
function eq<T>(got: T, want: T, msg: string) {
  check(Object.is(got, want), `${msg}（得到 ${String(got)}，期望 ${String(want)}）`);
}

function buf(over: Partial<ExternalReloadCandidate> = {}): ExternalReloadCandidate {
  return {
    path: "E:/Project/Demo/main.tex",
    kind: "text",
    content: "abc\n",
    savedContent: "abc\n",
    ...over,
  };
}

// ── shouldReloadOnExternalChange ──────────────────────────────
console.log("\n[shouldReloadOnExternalChange]");
check(
  shouldReloadOnExternalChange(buf(), "E:/Project/Demo/main.tex"),
  "干净文本缓冲 + 同路径 → 重载",
);
check(
  shouldReloadOnExternalChange(buf(), "E:\\Project\\Demo\\main.tex"),
  "Rust 事件反斜杠写法与缓冲正斜杠写法视为同一文件",
);
check(
  shouldReloadOnExternalChange(buf(), "E:/Project/Demo/./figures/../main.tex"),
  "路径中的 . / .. 归一化后仍命中",
);
check(
  !shouldReloadOnExternalChange(buf(), "E:/Project/Demo/other.tex"),
  "不同文件不误重载",
);
check(
  !shouldReloadOnExternalChange(buf({ content: "abc\nEDIT" }), "E:/Project/Demo/main.tex"),
  "脏缓冲（有未保存改动）绝不自动覆盖",
);
check(
  !shouldReloadOnExternalChange(buf({ kind: "pdf" }), "E:/Project/Demo/main.tex"),
  "PDF 查看器缓冲不参与文本重载",
);
check(
  !shouldReloadOnExternalChange(buf({ kind: "image" }), "E:/Project/Demo/main.tex"),
  "图片查看器缓冲不参与文本重载",
);
check(
  !shouldReloadOnExternalChange(buf({ kind: "diagram" }), "E:/Project/Demo/main.tex"),
  "绘图伪缓冲不参与文本重载",
);

// ── sameTextIgnoringEol ───────────────────────────────────────
console.log("\n[sameTextIgnoringEol]");
check(sameTextIgnoringEol("a\nb\n", "a\r\nb\r\n"), "LF 与 CRLF 视为相同（自身保存回显不误判）");
check(sameTextIgnoringEol("a\r\nb", "a\r\nb"), "同为 CRLF 视为相同");
check(sameTextIgnoringEol("a\nb", "a\nb"), "同为 LF 视为相同");
check(!sameTextIgnoringEol("a\nb", "a\nc"), "真实内容变化必须识别");
check(!sameTextIgnoringEol("a\n", "a"), "行数变化必须识别");
eq("a\r\nb".replace(/\r\n/g, "\n"), "a\nb", "归一化口径与 CM 内部 LF 一致");

console.log(`\n${total - failures}/${total} 通过`);
process.exit(failures === 0 ? 0 : 1);

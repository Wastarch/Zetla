// M1-39 · 构建文件面板展示纯逻辑单测
// 运行：node --experimental-strip-types scripts/build-artifacts.test.ts
import type { BuildArtifact } from "../src/types/project.ts";
import {
  artifactKind,
  formatArtifactSize,
  formatArtifactTime,
  sortArtifacts,
} from "../src/outline/buildArtifacts.ts";

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

eq(artifactKind("main.PDF"), "pdf", "PDF 后缀大小写不敏感");
eq(artifactKind("main.log"), "log", ".log 归为日志");
eq(artifactKind("notes.blg"), "log", ".blg 归为日志");
eq(artifactKind("main.aux"), "aux", "其余产物归为辅助文件");
eq(formatArtifactSize(512), "512 B", "小文件显示 B");
eq(formatArtifactSize(1536), "1.5 KB", "KB 一位小数");
eq(formatArtifactSize(2 * 1024 * 1024), "2.0 MB", "MB 一位小数");
eq(formatArtifactSize(-1), "—", "非法大小兜底");

const now = new Date(2026, 10, 20, 20, 0, 0).getTime();
eq(
  formatArtifactTime(new Date(2026, 10, 20, 9, 5).getTime(), now),
  "09:05",
  "当天显示时分",
);
eq(
  formatArtifactTime(new Date(2026, 9, 1, 9, 5).getTime(), now),
  "10-01",
  "非当天显示月日",
);
eq(formatArtifactTime(0, now), "—", "缺失时间兜底");

const a = (name: string, modified: number): BuildArtifact => ({
  name,
  path: `/tmp/${name}`,
  size: 1,
  modified,
});
eq(
  JSON.stringify(
    sortArtifacts([a("old.log", 1), a("new.pdf", 3), a("mid.aux", 2)]).map((x) => x.name),
  ),
  JSON.stringify(["new.pdf", "mid.aux", "old.log"]),
  "按修改时间倒序",
);
eq(
  JSON.stringify(sortArtifacts([a("b.log", 5), a("a.log", 5)]).map((x) => x.name)),
  JSON.stringify(["a.log", "b.log"]),
  "同时间按文件名",
);
eq(
  JSON.stringify(
    sortArtifacts([a("old.pdf", 1), a("new.log", 3), a("mid.aux", 2)]).map((x) => x.name),
  ),
  JSON.stringify(["old.pdf", "new.log", "mid.aux"]),
  "M1-40：旧 PDF 仍置顶，其余按时间倒序",
);
eq(
  JSON.stringify(sortArtifacts([a("b.pdf", 1), a("a.pdf", 2)]).map((x) => x.name)),
  JSON.stringify(["a.pdf", "b.pdf"]),
  "M1-40：多个 PDF 之间仍按时间倒序",
);

console.log(`\n${failures === 0 ? "✅ ALL PASS" : "❌ FAILED"} — ${total - failures}/${total}`);
if (failures > 0) process.exit(1);

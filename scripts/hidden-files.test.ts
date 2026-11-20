// M1-38 · 项目树「显示隐藏文件」判据纯逻辑单测
// 运行：node --experimental-strip-types scripts/hidden-files.test.ts
// 与 Rust src-tauri/src/commands/project.rs 的 skip_name 同规则。
import { shouldSkipTreeName } from "../src/project/hiddenFiles.ts";

let failures = 0;
let total = 0;
function check(cond: boolean, msg: string) {
  total++;
  console.log((cond ? "  ✓ " : "  ✗ ") + msg);
  if (!cond) failures++;
}

check(shouldSkipTreeName("main.tex", false) === false, "普通文件默认显示");
check(shouldSkipTreeName(".hidden.tex", false) === true, "点号文件默认隐藏");
check(shouldSkipTreeName(".ltex", false) === true, "点号目录默认隐藏");
check(shouldSkipTreeName(".git", false) === true, ".git 默认口径隐藏");
check(shouldSkipTreeName("node_modules", false) === true, "重型目录默认口径隐藏");
check(shouldSkipTreeName(".hidden.tex", true) === false, "开启后点号文件显示");
check(shouldSkipTreeName(".ltex", true) === false, "开启后 .ltex 目录显示");
check(shouldSkipTreeName(".git", true) === false, "M1-40：开启后 .git 放行");
check(shouldSkipTreeName("node_modules", true) === false, "M1-40：开启后 node_modules 放行");
check(shouldSkipTreeName("dist", true) === false, "M1-40：开启后 dist 放行");
check(shouldSkipTreeName("target", true) === false, "M1-40：开启后 target 放行");
check(shouldSkipTreeName("build", true) === false, "M1-40：开启后 build 放行");
check(shouldSkipTreeName("out", true) === false, "M1-40：开启后 out 放行");
check(shouldSkipTreeName("__pycache__", true) === false, "M1-40：开启后 __pycache__ 放行");
check(shouldSkipTreeName("chapters", true) === false, "普通目录不受开关影响");
check(shouldSkipTreeName("Node_modules", true) === false, "白名单大小写敏感（与 Rust 一致）");

console.log(
  `\n${failures === 0 ? "✅ ALL PASS" : "❌ FAILED"} — ${total - failures}/${total}`,
);
if (failures > 0) process.exit(1);

// 验证 M1-14c 白屏根因与修复：
// 旧：latex() 自带 autocompletion({override}) + 额外再挂一个 autocompletion({override}) → 冲突抛错
// 新：latex({enableAutocomplete:false}) + 单一 autocompletion({override:[latex,cite]}) → 不冲突
import { EditorState } from "@codemirror/state";
import { latex, latexCompletionSource } from "codemirror-lang-latex";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { keymap } from "@codemirror/view";

let pass = 0;
let fail = 0;
function check(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    console.log("  ✓", msg);
  } else {
    fail++;
    console.log("  ✗", msg);
  }
}

// 旧组合：应抛 "Config merge conflict for field override"
console.log("== 旧组合（两个 override）==");
let threw = false;
try {
  EditorState.create({
    doc: "\\section{Test}",
    extensions: [
      latex({ autoCloseBrackets: true, autoCloseTags: true }), // enableAutocomplete 默认 true
      autocompletion({ override: [latexCompletionSource(true)] }),
    ],
  });
} catch (e: any) {
  threw = true;
  console.log("    抛出:", e.message);
}
check(threw, "旧组合抛出 Config merge conflict（复现白屏根因）");

// 新组合：不应抛错
console.log("\n== 新组合（单一 override）==");
let threwNew = false;
let errMsg = "";
try {
  EditorState.create({
    doc: "\\section{Test}",
    extensions: [
      latex({ autoCloseBrackets: true, autoCloseTags: true, enableAutocomplete: false }),
      autocompletion({
        override: [latexCompletionSource(true), latexCompletionSource(true)],
        defaultKeymap: true,
        activateOnTyping: true,
        icons: true,
      }),
      keymap.of(completionKeymap),
    ],
  });
} catch (e: any) {
  threwNew = true;
  errMsg = e.message;
}
check(!threwNew, "新组合不再抛错" + (threwNew ? "（实际：" + errMsg + "）" : ""));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);

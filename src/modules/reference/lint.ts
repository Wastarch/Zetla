// M1-14e · 校验 Linter（CM6 接线）—— 见 docs/开发计划.md M1-14e
// duplicateKeyLinter：.bib 内重复 key 告警（项目级判定，store.duplicateKeys）。
// missingCiteLinter：.tex 内 \cite{key} 引用缺失告警（key 不在 store.byKey 即标红）。
// 两类均只读 useReferenceStore 缓存，不重解 bib：
//   - duplicate 直接用 store 里已解析的 entries（按当前文件路径过滤）定位，零重新解析；
//   - missing 扫描当前 .tex 文档是必要的（store 不跟踪 tex 侧引用），但只读 store.byKey 判定。
import type { EditorView } from "@codemirror/view";
import type { Diagnostic } from "@codemirror/lint";
import { useReferenceStore } from "./useReferenceStore";
import {
  collectDuplicateKeyDiags,
  collectMissingCiteDiags,
} from "./lintLogic";

/**
 * .bib 内重复 key 校验。
 * getPath 返回当前文档路径（经 ref 取最新值，避免切同扩展名文件时闭包拿到旧路径）。
 */
export function duplicateKeyLinter(
  getPath: () => string | undefined,
): (view: EditorView) => Diagnostic[] {
  return (view: EditorView): Diagnostic[] => {
    const ref = useReferenceStore.getState();
    if (!ref.ready) return [];
    const file = getPath();
    if (!file) return [];
    const entriesInFile = ref.entries.filter((e) => e.file === file);
    const diags = collectDuplicateKeyDiags(
      view.state.doc,
      entriesInFile,
      ref.duplicateKeys,
      (k) => ref.byKey.get(k)?.length ?? 0,
    );
    return diags.map((d) => ({
      from: d.from,
      to: d.to,
      severity: "warning",
      message: d.message,
    }));
  };
}

/** .tex 内引用缺失校验。 */
export function missingCiteLinter(): (view: EditorView) => Diagnostic[] {
  return (view: EditorView): Diagnostic[] => {
    const ref = useReferenceStore.getState();
    if (!ref.ready) return [];
    const knownKeys = new Set(ref.byKey.keys());
    if (knownKeys.size === 0) return [];
    const diags = collectMissingCiteDiags(view.state.doc, knownKeys);
    return diags.map((d) => ({
      from: d.from,
      to: d.to,
      severity: "warning",
      message: d.message,
    }));
  };
}

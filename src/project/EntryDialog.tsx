// M0-6 · 自绘输入对话框（WebView 无 window.prompt）
// 新建文件 / 新建文件夹 / 重命名 —— 对齐 .modal.sm 验收抽屉同款结构
// M0-6b：新建不再局限于 .tex——文件名可带任意后缀，并提供类型快选（.tex/.bib/.cls/.sty/.md/.txt/无后缀）；
//         输入含后缀时以输入为准，否则拼接所选类型；类型选择会话级记忆（lastExt，不落盘）。
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/ui/Icon";
import { useProjectStore } from "./useProject";

/** 类型快选档位（ext 为空串表示「无后缀」） */
const EXT_PRESETS: { ext: string; hint: string }[] = [
  { ext: ".tex", hint: "LaTeX 文档" },
  { ext: ".bib", hint: "BibTeX 文献库" },
  { ext: ".cls", hint: "文档类" },
  { ext: ".sty", hint: "宏包" },
  { ext: ".md", hint: "Markdown" },
  { ext: ".txt", hint: "纯文本" },
  { ext: "", hint: "无后缀（按纯文本打开）" },
];

/** 会话级记忆：上次选择的类型（不落盘） */
let lastExt = ".tex";

/** 取输入名末尾后缀（小写，含点）；无后缀返回 "" */
function tailExt(name: string): string {
  const m = name.match(/\.[^./\\]+$/);
  return m ? m[0].toLowerCase() : "";
}

export function EntryDialog() {
  const d = useProjectStore((s) => s.entryDialog);
  const close = useProjectStore((s) => s.closeEntryDialog);
  const createEntry = useProjectStore((s) => s.createEntry);
  const renameEntry = useProjectStore((s) => s.renameEntry);

  const [value, setValue] = useState("");
  const [ext, setExt] = useState(lastExt);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (d) {
      setValue(d.initial);
      if (d.mode === "create" && d.kind !== "dir") setExt(d.ext ?? lastExt);
      // 聚焦并选中主体名（便于直接打字覆盖）
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [d]);

  // Esc 关闭（在输入框上按键时由 onKeyDown 处理，这里兜底）
  useEffect(() => {
    if (!d) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [d, close]);

  if (!d) return null;

  const isCreate = d.mode === "create";
  const isDir = isCreate && d.kind === "dir";
  const isFile = isCreate && !isDir;
  const title = isCreate ? (isDir ? "新建文件夹" : "新建文件") : "重命名";
  const label = isCreate ? (isDir ? "文件夹名" : "文件名") : "新名称";
  const placeholder = isCreate ? (isDir ? "新建文件夹" : "untitled") : "";

  // 后缀：输入里带了以输入为准（chip 跟随），否则用所选类型
  const inputExt = tailExt(value);
  const activeExt = isFile && inputExt ? inputExt : ext;
  const finalName = isFile && !inputExt ? `${value}${ext}` : value;
  const previewName = value.trim() ? finalName : "";

  function submit() {
    if (!d) return;
    if (d.mode === "create") {
      if (isFile) lastExt = ext;
      void createEntry(d.dir, d.kind, value, isFile ? ext : undefined);
    } else {
      void renameEntry(d.from, value);
    }
  }

  return (
    <div className="modal-layer" onMouseDown={close}>
      <div
        className="modal sm"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="ibtn x" title="关闭" onClick={close}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body entry-body">
          <label className="entry-label" htmlFor="entry-name">
            {label}
          </label>
          <input
            id="entry-name"
            ref={inputRef}
            className="entry-input"
            value={value}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
          />
          {isFile && (
            <>
              <div className="entry-chips" role="group" aria-label="文件类型">
                {EXT_PRESETS.map((p) => (
                  <button
                    key={p.ext || "none"}
                    type="button"
                    className={activeExt === p.ext ? "entry-chip on" : "entry-chip"}
                    title={p.hint}
                    onClick={() => setExt(p.ext)}
                  >
                    {p.ext || "无后缀"}
                  </button>
                ))}
              </div>
              <p className="entry-preview">
                将创建：<b>{previewName || "—"}</b>
                {inputExt && inputExt !== ext && <span> · 后缀以输入为准</span>}
              </p>
            </>
          )}
          <p className="entry-hint">
            {isFile
              ? "Enter 确认 · Esc 取消 · 可输入任意后缀，重名/非法字符将被拒绝"
              : "Enter 确认 · Esc 取消 · 重名/非法字符将被拒绝"}
          </p>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={close}>
            取消
          </button>
          <button type="button" className="btn primary" onClick={submit}>
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

export default EntryDialog;

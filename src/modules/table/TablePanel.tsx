// M1-8 · 表格面板（P2：网格编辑）
// 布局：工具条 → 网格（双向滚动、行列头吸顶/吸左）→ 字段与代码预览。
// 交互口径（计划文档 M1-8 详节）：
//   - 单元格回车/失焦提交模型，避免每次按键触发面板级重渲染；
//   - Tab/Shift+Tab 左右移、Enter/Shift+Enter 上下移、Ctrl+方向键 跨格、Esc 退出；
//   - 拖拽/Shift+点击 矩形选区；Ctrl+C 复制为 TSV，Ctrl+V 以当前格为左上角铺入（Excel 粘贴路径）。
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Icon } from "@/ui/Icon";
import { getActiveView } from "@/editor/activeView";
import { useBuffersStore } from "@/editor/useBuffers";
import { insertSnippet, insertSnippetSelect } from "@/core/moduleRegistry";
import { useSettingsStore } from "@/core/settings";
import { notify, useProjectStore } from "@/project/useProject";
import { projectApi } from "@/ipc/invoke";
import { slugify } from "@/editor/image/pathUtils";
import {
  TABLE_MAX_COLS,
  TABLE_MAX_ROWS,
  createTable,
  findAnchor,
  fromMatrix,
  insertCol,
  insertRow,
  mergeRange,
  pasteMatrix,
  rangeMatrix,
  removeCol,
  removeRow,
  setCellText,
  setColumnAlign,
  splitAt,
  type EscapeMode,
  type HAlign,
  type TableModel,
  type TableStyle,
} from "./tableModel";
import { generateTable, captionSelection } from "./tableGen";
import { fingerprintOf, parseTableAt } from "./tableParse";
import { looksLikeTable, parseDelimited, toTSV } from "./tableCsv";
import { selectionRect, useTableStore } from "./tableStore";

/** 列名：0→A、25→Z、26→AA */
function colLabel(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

const STYLE_OPTIONS: Array<{ v: TableStyle; label: string }> = [
  { v: "booktabs", label: "三线表" },
  { v: "grid", label: "全框线" },
  { v: "plain", label: "无线" },
];

const ESCAPE_OPTIONS: Array<{ v: EscapeMode; label: string }> = [
  { v: "smart", label: "智能转义" },
  { v: "full", label: "全转义" },
  { v: "off", label: "不转义" },
];

interface CellInputProps {
  value: string;
  r: number;
  c: number;
  selected: boolean;
  inRange: boolean;
  onCommit: (r: number, c: number, text: string) => void;
  onNav: (r: number, c: number, dr: number, dc: number, extend: boolean, wrap?: boolean) => void;
  onPasteText: (r: number, c: number, text: string) => void;
  onCopyRange: () => string | null;
  registerRef: (r: number, c: number, el: HTMLInputElement | null) => void;
}

/** 单元格输入（memo：只有自身 value/选中态变化才重渲染） */
const CellInput = memo(function CellInput({
  value,
  r,
  c,
  selected,
  inRange,
  onCommit,
  onNav,
  onPasteText,
  onCopyRange,
  registerRef,
}: CellInputProps) {
  const [draft, setDraft] = useState(value);
  // 外部变更（粘贴/导入/撤销重置）回灌到本地草稿
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (draft !== value) onCommit(r, c, draft);
  };

  return (
    <input
      ref={(el) => registerRef(r, c, el)}
      className={selected ? "tbl-inp sel" : inRange ? "tbl-inp range" : "tbl-inp"}
      value={draft}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          (e.target as HTMLInputElement).blur();
          return;
        }
        // Ctrl/⌘ + 方向键：跨格移动（普通方向键保留光标移动）
        if ((e.ctrlKey || e.metaKey) && e.key.startsWith("Arrow")) {
          e.preventDefault();
          const dr = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
          const dc = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
          onNav(r, c, dr, dc, e.shiftKey);
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          onNav(r, c, e.shiftKey ? -1 : 1, 0, false);
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          onNav(r, c, 0, e.shiftKey ? -1 : 1, false, true);
        }
      }}
      onPaste={(e) => {
        const text = e.clipboardData.getData("text/plain");
        // 含制表符/多行 → 视为表格数据铺入；否则按普通文本粘贴
        if (looksLikeTable(text)) {
          e.preventDefault();
          onPasteText(r, c, text);
        }
      }}
      onCopy={(e) => {
        const tsv = onCopyRange();
        if (tsv !== null) {
          e.preventDefault();
          e.clipboardData.setData("text/plain", tsv);
        }
      }}
    />
  );
});

export function TablePanel() {
  const model = useTableStore((s) => s.model);
  const sel = useTableStore((s) => s.sel);
  const update = useTableStore((s) => s.update);
  const setSel = useTableStore((s) => s.setSel);
  const reset = useTableStore((s) => s.reset);
  const source = useTableStore((s) => s.source);
  const setSource = useTableStore((s) => s.setSource);
  /** 表格模块设置（新表默认线型/转义/编号/位置/label 前缀） */
  const tableCfg = useSettingsStore((s) => s.settings.table);
  const maxRows = Math.min(TABLE_MAX_ROWS, tableCfg.maxRows);
  const maxCols = Math.min(TABLE_MAX_COLS, tableCfg.maxCols);

  /** 按设置生成新表（重置 / 导入共用） */
  const newTable = useCallback(
    () =>
      createTable(3, 3, {
        style: tableCfg.style,
        numbered: tableCfg.numbered,
        placement: tableCfg.placement,
        escape: tableCfg.escape,
        header: tableCfg.headerRow,
      }),
    [tableCfg],
  );

  // 插入目标：活动标签必须是可编辑文本（图片/PDF 查看器无 active view）
  const activePath = useBuffersStore((s) => s.activePath);
  const activeKind = useBuffersStore(
    (s) => s.buffers.find((b) => b.path === s.activePath)?.kind ?? null,
  );
  const canInsert = !!activePath && activeKind === "text";
  const mainFile = useProjectStore((s) => s.tree?.mainFile ?? null);

  /** 导言区文本（用于宏包检测；优先主文件，回退活动标签） */
  const [preamble, setPreamble] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const target = mainFile ?? activePath;
    if (!target) {
      setPreamble(null);
      return;
    }
    projectApi
      .readFile(target)
      .then((d) => {
        if (alive) setPreamble(d.content);
      })
      .catch(() => {
        if (alive) setPreamble(null);
      });
    return () => {
      alive = false;
    };
  }, [mainFile, activePath]);

  const inputs = useRef(new Map<string, HTMLInputElement>());
  const dragRef = useRef(false);
  const anchorRef = useRef({ r: 0, c: 0 });

  const rect = selectionRect(sel);

  const registerRef = useCallback((r: number, c: number, el: HTMLInputElement | null) => {
    if (el) inputs.current.set(`${r}:${c}`, el);
    else inputs.current.delete(`${r}:${c}`);
  }, []);

  const focusCell = useCallback((r: number, c: number) => {
    const key = `${r}:${c}`;
    const el = inputs.current.get(key);
    if (el) {
      el.focus();
      el.select();
      return true;
    }
    return false;
  }, []);

  /** 合并块内部无法聚焦 → 落到锚点 */
  const focusResolved = useCallback(
    (r: number, c: number) => {
      if (focusCell(r, c)) return;
      const anchor = findAnchor(model, r, c);
      if (anchor) focusCell(anchor.r, anchor.c);
    },
    [model, focusCell],
  );

  const nav = useCallback(
    (r: number, c: number, dr: number, dc: number, extend: boolean, wrap = false) => {
      let nr = Math.min(model.rows - 1, Math.max(0, r + dr));
      let nc = Math.min(model.cols - 1, Math.max(0, c + dc));
      // Tab 跨行回绕：末列 → 下一行首列；首列 → 上一行末列
      if (wrap && dc > 0 && c === model.cols - 1) {
        nr = Math.min(model.rows - 1, r + 1);
        nc = 0;
      } else if (wrap && dc < 0 && c === 0) {
        nr = Math.max(0, r - 1);
        nc = model.cols - 1;
      }
      if (extend) setSel({ ar: anchorRef.current.r, ac: anchorRef.current.c, fr: nr, fc: nc });
      else {
        anchorRef.current = { r: nr, c: nc };
        setSel({ ar: nr, ac: nc, fr: nr, fc: nc });
      }
      // 等上游 model 不变的情况下直接聚焦（输入框常驻）
      requestAnimationFrame(() => focusResolved(nr, nc));
    },
    [model.rows, model.cols, setSel, focusResolved],
  );

  const commitCell = useCallback(
    (r: number, c: number, text: string) => {
      update((m) => setCellText(m, r, c, text));
    },
    [update],
  );

  const pasteText = useCallback(
    (r: number, c: number, text: string) => {
      const matrix = parseDelimited(text);
      if (!matrix.length) return;
      update((m) => pasteMatrix(m, r, c, matrix));
    },
    [update],
  );

  const copyRange = useCallback((): string | null => {
    if (rect.r1 === rect.r2 && rect.c1 === rect.c2) return null; // 单格交还原生复制
    const matrix = rangeMatrix(model, rect.r1, rect.c1, rect.r2, rect.c2);
    return toTSV(matrix);
  }, [model, rect.r1, rect.c1, rect.r2, rect.c2]);

  // 拖拽选区结束（鼠标可能在网格外释放）
  useEffect(() => {
    const stop = () => {
      dragRef.current = false;
    };
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  const onCellMouseDown = (r: number, c: number, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (e.shiftKey) {
      setSel({ ar: anchorRef.current.r, ac: anchorRef.current.c, fr: r, fc: c });
      return;
    }
    anchorRef.current = { r, c };
    dragRef.current = true;
    setSel({ ar: r, ac: c, fr: r, fc: c });
  };

  const onCellMouseEnter = (r: number, c: number) => {
    if (!dragRef.current) return;
    setSel({ ar: anchorRef.current.r, ac: anchorRef.current.c, fr: r, fc: c });
  };

  const inRange = (r: number, c: number) =>
    r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2;

  // ── 工具条动作（全部落在当前选区上）──
  const act = {
    addRow: () => update((m) => insertRow(m, rect.r2 + 1)),
    addCol: () => update((m) => insertCol(m, rect.c2 + 1)),
    delRow: () => update((m) => removeRow(m, rect.r2)),
    delCol: () => update((m) => removeCol(m, rect.c2)),
    merge: () => update((m) => mergeRange(m, rect.r1, rect.c1, rect.r2, rect.c2)),
    split: () => update((m) => splitAt(m, rect.r1, rect.c1)),
    align: (a: HAlign) =>
      update((m) => {
        let next = m;
        for (let c = rect.c1; c <= rect.c2; c++) next = setColumnAlign(next, c, a);
        return next;
      }),
    toggleHeader: () => update((m) => ({ ...m, header: !m.header })),
    setStyle: (v: TableStyle) => update((m) => ({ ...m, style: v })),
    setWidth: (v: TableModel["width"]) => update((m) => ({ ...m, width: v })),
    setEscape: (v: EscapeMode) => update((m) => ({ ...m, escape: v })),
    setCaption: (v: string) => update((m) => ({ ...m, caption: v })),
    setLabel: (v: string) => update((m) => ({ ...m, label: v })),
  };

  const code = useMemo(() => generateTable(model), [model]);
  const canAddRow = model.rows < maxRows;
  const canAddCol = model.cols < maxCols;

  /** 本模型需要的宏包（按生成结果推导） */
  const requiredPackages = useMemo(() => {
    const pkgs: string[] = [];
    if (model.style === "booktabs") pkgs.push("booktabs");
    if (model.width === "full") pkgs.push("tabularx");
    if (model.cells.some((row) => row.some((c) => (c.rowSpan ?? 1) > 1))) pkgs.push("multirow");
    return pkgs;
  }, [model]);

  /** 导言区已声明的宏包（缺失才提示，避免误报） */
  const missingPackages = useMemo(() => {
    if (!preamble) return [];
    return requiredPackages.filter((pkg) => {
      const re = new RegExp(`\\\\usepackage(\\[[^\\]]*\\])?\\{[^}]*\\b${pkg}\\b[^}]*\\}`);
      return !re.test(preamble);
    });
  }, [preamble, requiredPackages]);

  /** 当前模型 → 最终模型（标签留空时按标题推导 tab:<slug>） */
  const finalizeModel = useCallback((): TableModel => {
    const label =
      model.label.trim() ||
      (model.caption.trim() ? `${tableCfg.labelPrefix}${slugify(model.caption)}` : "");
    return { ...model, label };
  }, [model, tableCfg.labelPrefix]);

  /** 插入表格代码到活动编辑器（光标落于 \caption{} 内） */
  const handleInsert = useCallback(() => {
    if (!canInsert) {
      notify("请先在 .tex 标签页中使用表格插入", "err");
      return;
    }
    const view = getActiveView();
    if (!view) {
      notify("没有可插入的编辑器", "err");
      return;
    }
    const finalModel = finalizeModel();
    const body = generateTable(finalModel);
    const pos = view.state.selection.main.head;
    const doc = view.state.doc;
    // 块前保证至少一个空行（与 M1-7 图片插入同口径）
    const needLeading = pos > 0 && doc.sliceString(pos - 1, pos) !== "\n";
    const prefix = needLeading ? "\n\n" : "";
    const sel = captionSelection(finalModel);
    if (sel) {
      insertSnippetSelect(prefix + body, sel.from + prefix.length, sel.to + prefix.length);
    } else {
      insertSnippet(prefix + body);
    }
    notify("已插入表格代码", "ok");
  }, [canInsert, finalizeModel]);

  /** 「编辑当前表格」：从光标处 tabular 回填网格 */
  const handleEditCurrent = useCallback(() => {
    const view = getActiveView();
    if (!view) {
      notify("请先在 .tex 标签页中使用", "err");
      return;
    }
    const parsed = parseTableAt(view.state.doc.toString(), view.state.selection.main.head);
    if (!parsed) {
      notify("光标处未找到可编辑的表格", "err");
      return;
    }
    reset(parsed.model);
    setSource({ from: parsed.from, to: parsed.to, fingerprint: parsed.fingerprint });
    notify(`已载入表格（${parsed.model.rows}×${parsed.model.cols}）`, "ok");
  }, [reset, setSource]);

  /** 「导入 CSV/TSV」：读文本 → 嗅探分隔符 → 建表（编码由 Rust read_file 处理） */
  const handleImport = useCallback(async () => {
    let picked: string | string[] | null = null;
    try {
      picked = await openFileDialog({
        multiple: false,
        filters: [{ name: "表格文本（CSV/TSV）", extensions: ["csv", "tsv", "txt"] }],
      });
    } catch (e) {
      notify(`打开文件失败：${String(e)}`, "err");
      return;
    }
    const path = Array.isArray(picked) ? picked[0] : picked;
    if (!path) return;
    try {
      const d = await projectApi.readFile(path);
      const matrix = parseDelimited(d.content);
      if (!matrix.length) {
        notify("文件为空或无法解析", "err");
        return;
      }
      reset(
        fromMatrix(matrix, {
          style: tableCfg.style,
          numbered: tableCfg.numbered,
          placement: tableCfg.placement,
          escape: tableCfg.escape,
          header: tableCfg.headerRow,
        }),
      );
      setSource(null);
      notify(`已导入 ${matrix.length} 行 × ${matrix[0]?.length ?? 0} 列`, "ok");
    } catch (e) {
      notify(`导入失败：${String(e)}`, "err");
    }
  }, [reset, setSource, tableCfg]);

  /** 「更新表格」：指纹校验通过才原地替换，避免覆盖用户手改的源码 */
  const handleUpdate = useCallback(() => {
    if (!source) return;
    const view = getActiveView();
    if (!view) {
      notify("没有可更新的编辑器", "err");
      return;
    }
    const doc = view.state.doc.toString();
    const current = doc.slice(source.from, source.to);
    if (fingerprintOf(current) !== source.fingerprint) {
      notify("表格源码已被修改，已取消更新（可改用「插入到编辑器」）", "err");
      return;
    }
    const body = generateTable(finalizeModel());
    view.dispatch({ changes: { from: source.from, to: source.to, insert: body } });
    setSource({
      from: source.from,
      to: source.from + body.length,
      fingerprint: fingerprintOf(body),
    });
    notify("已更新表格", "ok");
  }, [source, setSource, finalizeModel]);

  /** 把缺失宏包补进主文件导言区（仅当活动标签就是主文件，避免插错文档） */
  const addPackages = useCallback(() => {
    if (!mainFile || activePath !== mainFile) {
      notify("请在主文件导言区手动添加宏包", "err");
      return;
    }
    const view = getActiveView();
    if (!view) return;
    const text = view.state.doc.toString();
    const at = text.indexOf("\\begin{document}");
    if (at < 0) {
      notify("未找到 \\begin{document}，请手动添加宏包", "err");
      return;
    }
    view.dispatch({ changes: { from: at, insert: `\\usepackage{${missingPackages.join(",")}}\n` } });
    notify(`已加入宏包：${missingPackages.join(", ")}`, "ok");
  }, [mainFile, activePath, missingPackages]);

  return (
    <div className="table-panel">
      {/* ── 工具条：行列 / 合并 / 对齐 / 表头 ── */}
      <div className="tbl-toolbar">
        <button
          type="button"
          className="tbtn"
          title="在选区下方插入一行"
          disabled={!canAddRow}
          onClick={act.addRow}
        >
          ＋行
        </button>
        <button
          type="button"
          className="tbtn"
          title="在选区右侧插入一列"
          disabled={!canAddCol}
          onClick={act.addCol}
        >
          ＋列
        </button>
        <button
          type="button"
          className="tbtn"
          title="删除选区末行"
          disabled={model.rows <= 1}
          onClick={act.delRow}
        >
          －行
        </button>
        <button
          type="button"
          className="tbtn"
          title="删除选区末列"
          disabled={model.cols <= 1}
          onClick={act.delCol}
        >
          －列
        </button>
        <span className="tbl-sep" />
        <button
          type="button"
          className="tbtn"
          title="合并选区为一个单元格（左上角保留文本）"
          disabled={rect.r1 === rect.r2 && rect.c1 === rect.c2}
          onClick={act.merge}
        >
          合并
        </button>
        <button type="button" className="tbtn" title="拆分当前合并单元格" onClick={act.split}>
          拆分
        </button>
        <span className="tbl-sep" />
        <button type="button" className="tbtn" title="选区各列左对齐" onClick={() => act.align("l")}>
          L
        </button>
        <button type="button" className="tbtn" title="选区各列居中" onClick={() => act.align("c")}>
          C
        </button>
        <button type="button" className="tbtn" title="选区各列右对齐" onClick={() => act.align("r")}>
          R
        </button>
        <span className="tbl-sep" />
        <button
          type="button"
          className={model.header ? "tbtn on" : "tbtn"}
          title="首行作为表头（三线表在其后加 \midrule）"
          onClick={act.toggleHeader}
        >
          表头
        </button>
        <button
          type="button"
          className="tbtn"
          title="清空并新建表格（按设置使用默认线型/表头）"
          onClick={() => reset(newTable())}
        >
          <Icon name="refresh" size={12} />
        </button>
        <button
          type="button"
          className="tbtn"
          title="读取光标处的表格并回填网格（反向编辑）"
          disabled={!canInsert}
          onClick={handleEditCurrent}
        >
          载入表格
        </button>
      </div>

      {/* ── 样式行 ── */}
      <div className="tbl-toolbar">
        <select
          className="tbl-sel"
          title="表格线风格"
          value={model.style}
          onChange={(e) => act.setStyle(e.target.value as TableStyle)}
        >
          {STYLE_OPTIONS.map((o) => (
            <option key={o.v} value={o.v}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className="tbl-sel"
          title="宽度：撑满时用 tabularx + X 列"
          value={model.width}
          onChange={(e) => act.setWidth(e.target.value as TableModel["width"])}
        >
          <option value="auto">自然宽</option>
          <option value="full">撑满页宽</option>
        </select>
        <select
          className="tbl-sel"
          title="单元格转义：智能=保留 $..$ 与命令，仅转义 & % # _"
          value={model.escape}
          onChange={(e) => act.setEscape(e.target.value as EscapeMode)}
        >
          {ESCAPE_OPTIONS.map((o) => (
            <option key={o.v} value={o.v}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="tbtn"
          title="导入 CSV/TSV 文件（.xlsx 请先另存为 CSV）"
          onClick={() => void handleImport()}
        >
          导入 CSV
        </button>
      </div>

      {/* ── 网格 ── */}
      <div className="tbl-grid-wrap">
        <table className="tbl-grid">
          <thead>
            <tr>
              <th className="tbl-corner" />
              {Array.from({ length: model.cols }, (_, c) => (
                <th
                  key={c}
                  className={c >= rect.c1 && c <= rect.c2 ? "tbl-colhead on" : "tbl-colhead"}
                  title={`列 ${colLabel(c)}`}
                >
                  {colLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: model.rows }, (_, r) => (
              <tr key={r}>
                <th
                  className={r >= rect.r1 && r <= rect.r2 ? "tbl-rowhead on" : "tbl-rowhead"}
                  title={`行 ${r + 1}`}
                >
                  {r + 1}
                </th>
                {Array.from({ length: model.cols }, (_, c) => {
                  const cell = model.cells[r][c];
                  if (cell.covered) {
                    return (
                      <td
                        key={c}
                        className={inRange(r, c) ? "tbl-cell covered sel" : "tbl-cell covered"}
                        onMouseEnter={() => onCellMouseEnter(r, c)}
                      />
                    );
                  }
                  const selected = sel.ar === r && sel.ac === c && sel.fr === r && sel.fc === c;
                  return (
                    <td
                      key={c}
                      className={inRange(r, c) ? "tbl-cell sel" : "tbl-cell"}
                      onMouseDown={(e) => onCellMouseDown(r, c, e)}
                      onMouseEnter={() => onCellMouseEnter(r, c)}
                    >
                      <CellInput
                        value={cell.text}
                        r={r}
                        c={c}
                        selected={selected}
                        inRange={inRange(r, c)}
                        onCommit={commitCell}
                        onNav={nav}
                        onPasteText={pasteText}
                        onCopyRange={copyRange}
                        registerRef={registerRef}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── 标题 / 标签 ── */}
      <div className="tbl-fields">
        <label className="tbl-field">
          <span>标题</span>
          <input
            className="tbl-input"
            value={model.caption}
            placeholder="实验结果"
            onChange={(e) => act.setCaption(e.target.value)}
          />
        </label>
        <label className="tbl-field">
          <span>标签</span>
          <input
            className="tbl-input"
            value={model.label}
            placeholder="tab:results"
            onChange={(e) => act.setLabel(e.target.value)}
          />
        </label>
      </div>

      {/* ── 代码预览 ── */}
      <details className="tbl-code">
        <summary>生成代码（{model.rows}×{model.cols}）</summary>
        <pre>{code}</pre>
      </details>

      {/* ── 宏包缺失提示（非阻断）── */}
      {missingPackages.length > 0 ? (
        <div className="tbl-warn">
          <span>缺少宏包：{missingPackages.join("、")}（生成代码可能编译失败）</span>
          <button
            type="button"
            className="tbtn"
            title={
              mainFile && activePath === mainFile
                ? "插入到 \\begin{document} 之前"
                : "请切到主文件后再插入，或手动添加"
            }
            onClick={addPackages}
          >
            加入导言区
          </button>
        </div>
      ) : null}

      <div className="tbl-actions">
        <button
          type="button"
          className="tbtn"
          title="复制选区为 TSV（可直接回贴 Excel）"
          onClick={() => {
            const matrix = rangeMatrix(model, rect.r1, rect.c1, rect.r2, rect.c2);
            void navigator.clipboard?.writeText(toTSV(matrix));
          }}
        >
          <Icon name="copy" size={12} /> 复制 TSV
        </button>
        {source ? (
          <button
            type="button"
            className="tbtn primary"
            title="原地替换光标处表格（源码被手改时会拒绝，改走「插入到编辑器」）"
            onClick={handleUpdate}
          >
            更新表格
          </button>
        ) : null}
        <button
          type="button"
          className={source ? "tbtn" : "tbtn primary"}
          title={canInsert ? "插入表格代码到光标处（光标落于标题内）" : "请先打开 .tex 标签页"}
          disabled={!canInsert}
          onClick={handleInsert}
        >
          插入到编辑器
        </button>
      </div>

      {/* 反向编辑状态提示 */}
      {source ? (
        <div className="table-panel-hint">
          正在编辑源码中的表格（{source.from}–{source.to}）。「更新表格」原地替换；源码被手动修改后会拒绝覆盖。
          反向载入为「不转义」模式以保留原格式。
        </div>
      ) : null}

      {/* 选区提示（选中多格时说明合并/复制口径） */}
      {rect.r1 !== rect.r2 || rect.c1 !== rect.c2 ? (
        <div className="table-panel-hint">
          已选 {rect.r2 - rect.r1 + 1} 行 × {rect.c2 - rect.c1 + 1} 列
        </div>
      ) : null}
    </div>
  );
}

export default TablePanel;

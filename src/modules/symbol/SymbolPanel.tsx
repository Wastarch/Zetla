// M1-12b · 符号面板（公式侧栏「快捷工具」页签；M1-6 面板重写）
// 结构：搜索框 + 10 分类大钮（▾ 内嵌展开/收起，对齐 Formula.html 快捷工具）+ 符号/模板混合网格。
// 交互定稿（用户 2026-10-25）：
//   单击 → 写入侧栏编写区光标处（composeStore.insert + 记最近 + 回显）
//   右键 → InsertCtxMenu：直接插入到编辑器（= M1-6 旧单击行为，主项）/ 插入到编写区 / 复制 LaTeX
//   搜索框回车 → 写入首项（键盘路径）
// 模板含 \Box 槽位：直插编辑器时自动选中首槽、Tab 跳下一槽（mathSlots 协议）。
import { useEffect, useMemo, useRef, useState } from "react";
import { insertSnippetWithSlots } from "@/editor/mathSlots";
import LazySymbolGlyph from "./LazySymbolGlyph";
import MatrixDialog from "./MatrixDialog";
import { notify } from "@/project/useProject";
import { useComposeStore } from "@/modules/formula/composeStore";
import { InsertCtxMenu, type CtxAction } from "@/ui/InsertCtxMenu";
import { CATEGORIES, CAT_ICONS, itemsByCat, searchItems, SUBCATS, SUBCAT_LABEL, type InsertItem } from "./symbolItems";

/** 回显时长（ms） */
const FLASH_MS = 1200;

export default function SymbolPanel() {
  const [q, setQ] = useState("");
  // 默认展开第一类（常用符号）；点已展开类 = 收起（显示提示行）
  const [openCat, setOpenCat] = useState<string>(CATEGORIES[0]);
  const [flash, setFlash] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; item: InsertItem } | null>(null);
  // 矩阵浮层：触发方式 write=单击(写编写区)/direct=右键(直插编辑器)；null=关闭；matrixKey 记当前展开的是哪个图标（用于再次点击收起）
  const [matrixDlg, setMatrixDlg] = useState<null | "write" | "direct">(null);
  // 矩阵浮层预选环境（点击某括号样式图标时带入）
  const [matrixEnv, setMatrixEnv] = useState<string | undefined>(undefined);
  // 矩阵浮层锚点（触发图标视口矩形，用于就地定位在侧栏旁）
  const [matrixAnchor, setMatrixAnchor] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [matrixKey, setMatrixKey] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  const searching = q.trim() !== "";
  const items = useMemo(
    () => (searching ? searchItems(q) : openCat ? itemsByCat(openCat) : []),
    [searching, q, openCat],
  );

  // 二级子类分区：符号按 subcat 分组（SUBCATS 顺序，空子类自动跳过）；模板单独成组；
  // 搜索态 / 无子类分类（数组矩阵）合并为单组。每个分组 = 一个 .sym-subgroup（小标题 + 网格）。
  const groups = useMemo(() => {
    if (!openCat && !searching) return [];
    const out: { key: string; label: string; items: InsertItem[] }[] = [];
    if (searching) {
      if (items.length) out.push({ key: "search", label: "", items });
      return out;
    }
    const subs = SUBCATS[openCat!];
    if (subs) {
      for (const sub of subs) {
        const sitems = items.filter((it) => it.kind === "symbol" && it.subcat === sub);
        if (sitems.length) out.push({ key: sub, label: SUBCAT_LABEL[sub] ?? sub, items: sitems });
      }
    } else {
      const sitems = items.filter((it) => it.kind === "symbol");
      if (sitems.length) out.push({ key: "__all", label: "", items: sitems });
    }
    // 模板：有 subcat 的按子类归组（如矩阵集），无 subcat 的归通用「模板 Templates」
    const tNoSub: InsertItem[] = [];
    const tBySub = new Map<string, InsertItem[]>();
    for (const it of items.filter((x) => x.kind === "template")) {
      if (it.subcat) {
        const arr = tBySub.get(it.subcat);
        if (arr) arr.push(it);
        else tBySub.set(it.subcat, [it]);
      } else {
        tNoSub.push(it);
      }
    }
    for (const [sub, sitems] of tBySub) {
      out.push({ key: `__tpl-${sub}`, label: SUBCAT_LABEL[sub] ?? sub, items: sitems });
    }
    if (tNoSub.length) out.push({ key: "__tpl", label: "模板 Templates", items: tNoSub });
    return out;
  }, [searching, items, openCat]);

  const say = (msg: string) => {
    setFlash(msg);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), FLASH_MS);
  };

  /** 单击：写入侧栏编写区光标处 + 记最近使用 */
  const writeToCompose = (item: InsertItem) => {
    const st = useComposeStore.getState();
    st.insert(item.latex);
    st.pushRecent({ key: item.key, label: item.name, latex: item.latex });
    say(`已写入编写区 ${item.latex}`);
  };

  /** 右键主项：直接插入主编辑器（无 \Box 时等价普通插入；有则选中首槽 + Tab 导航） */
  const directInsert = (item: InsertItem) => {
    if (insertSnippetWithSlots(item.latex)) say(`已插入 ${item.latex}`);
  };

  const copyLatex = async (item: InsertItem) => {
    try {
      await navigator.clipboard.writeText(item.latex);
      notify(`已复制 ${item.latex}`);
    } catch (e) {
      notify(`复制失败：${String(e)}`, "err");
    }
  };

  const menuFor = (item: InsertItem): CtxAction[] => [
    { label: "直接插入到编辑器", primary: true, onClick: () => directInsert(item) },
    { label: "插入到编写区", onClick: () => writeToCompose(item) },
    { label: "复制 LaTeX", onClick: () => void copyLatex(item) },
  ];

  /** 矩阵对话框确认：按触发方式落位（write→编写区 / direct→直插编辑器），并记最近 */
  const applyMatrix = (latex: string) => {
    const mode = matrixDlg;
    setMatrixDlg(null);
    const item: InsertItem = {
      key: `tpl:${matrixEnv ?? "matrix"}`,
      kind: "template",
      cat: "数组矩阵",
      subcat: "矩阵",
      name: "矩阵",
      glyph: "▦",
      latex,
      slots: 0,
      note: "",
    };
    if (mode === "direct") directInsert(item);
    else writeToCompose(item);
  };

  /** 单个 tile（按钮）：大图判定 + KaTeX 懒渲染 / 命令文本，符号与模板共用 */
  const renderTile = (it: InsertItem) => {
    // 大图判定：符号若含 {}（\frac{}{} 等参数型宏）→ 命令文本；其余符号走 KaTeX 大图（与预览同引擎，真·所见即所得）
    //           模板：icon ≤2 字符 → 大图，否则命令文本
    const big = it.kind === "symbol" ? !it.latex.includes("{}") : it.glyph.length <= 2;
    // 矩阵对话框型模板：不走 writeToCompose / 右键菜单，改为打开 MatrixDialog
    const isMatrix = it.dialog === "matrix";
    return (
      <button
        key={it.key}
        type="button"
        className={it.kind === "template" ? "symbol-btn is-tpl" : "symbol-btn"}
        style={it.w ? ({ ["--btn-w"]: `${it.w}px` } as React.CSSProperties) : undefined}
        title={
          isMatrix
            ? `${it.name} · 点击设置行列数 · 右键直插编辑器`
            : `${it.name}（${it.latex}）${it.slots ? ` · ${it.slots} 个空槽` : ""} · 单击写入编写区，右键直插编辑器`
        }
        onClick={
          isMatrix
            ? (e) => {
                const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                // 再次点击同一图标 → 收起；否则重定位并展开
                if (matrixDlg && matrixKey === it.key) {
                  setMatrixDlg(null);
                  return;
                }
                setMatrixKey(it.key);
                setMatrixEnv(it.env);
                setMatrixAnchor({ x: r.left, y: r.top, w: r.width, h: r.height });
                setMatrixDlg("write");
              }
            : () => writeToCompose(it)
        }
        onContextMenu={
          isMatrix
            ? (e) => {
                e.preventDefault();
                const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                setMatrixKey(it.key);
                setMatrixEnv(it.env);
                setMatrixAnchor({ x: r.left, y: r.top, w: r.width, h: r.height });
                setMatrixDlg("direct");
              }
            : (e) => {
                e.preventDefault();
                setCtx({ x: e.clientX, y: e.clientY, item: it });
              }
        }
      >
        {isMatrix ? (
          // 矩阵图标：KaTeX 渲染该环境 2×2 示意（带括号样式，所见即所得）
          <LazySymbolGlyph tex={it.latex} />
        ) : big ? (
          it.kind === "symbol" ? (
            // 符号大图：KaTeX 渲染 latex，懒加载（进入视口才渲染，压低首开开销）
            <LazySymbolGlyph tex={it.latex} />
          ) : (
            // 模板大图 icon（∑/∫ 等）保持原样
            <span className="symbol-glyph">{it.glyph}</span>
          )
        ) : (
          // 参数型符号（\frac{}{} 等）与长 icon 模板 → 等宽命令文本
          <span className="symbol-glyph is-cmd">
            {it.kind === "symbol" ? it.latex : it.glyph}
          </span>
        )}
        <span className="symbol-name">
          {it.kind === "template" ? it.name : `\\${it.name}`}
        </span>
      </button>
    );
  };

  return (
    <div className="symbol-panel">
      <input
        className="symbol-search"
        placeholder="搜索符号 / 公式 / 模板"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && items.length > 0) {
            e.preventDefault();
            writeToCompose(items[0]);
          }
        }}
      />

      {/* 10 分类大钮（▾ 内嵌展开；搜索态隐藏——结果已跨分类） */}
      {!searching && (
        <nav className="sym-cats" aria-label="符号分类">
          {CATEGORIES.map((c) => {
            const open = openCat === c;
            return (
              <button
                key={c}
                type="button"
                className={open ? "sym-cat is-open" : "sym-cat"}
                title={`${c}（${itemsByCat(c).length} 项）${open ? " · 点击收起" : ""}`}
                onClick={() => setOpenCat(open ? "" : c)}
              >
                <span className="sym-cat-icon">{CAT_ICONS[c]}</span>
                <span className="sym-cat-name">{c}</span>
                <span className={open ? "sym-cat-arrow up" : "sym-cat-arrow"}>▾</span>
              </button>
            );
          })}
        </nav>
      )}

      {flash && <div className="symbol-flash">{flash}</div>}

      {!searching && !openCat ? (
        <div className="sym-cats-hint">点击上方分类，展开该类符号 / 模板</div>
      ) : (
        <>
          {/* 分类名/搜索结果 与具体符号之间加分割条（2026-10-25 用户反馈「区分一下」） */}
          <div className="sym-sec">
            <span className="sym-sec-name">{searching ? "搜索结果" : openCat}</span>
            <span className="sym-sec-count">{items.length} 项</span>
          </div>
          <div className="symbol-scroll">
            {items.length === 0 ? (
              <div className="symbol-empty">
                {searching ? "未找到匹配项" : "该类暂无符号 / 模板"}
              </div>
            ) : (
              // 按二级子类分区渲染；每个分组 = 小标题 + 网格（LazySymbolGlyph 在 tile 内部懒渲染）
              groups.map((g) => (
                <div className="sym-subgroup" key={g.key}>
                  {g.label && (
                    <div className="sym-sec sym-subsec">
                      <span className="sym-sec-name">{g.label}</span>
                      <span className="sym-sec-count">{g.items.length} 项</span>
                    </div>
                  )}
                  <div className="symbol-grid">
                    {g.items.map((it) => renderTile(it))}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {ctx && (
        <InsertCtxMenu x={ctx.x} y={ctx.y} actions={menuFor(ctx.item)} onClose={() => setCtx(null)} />
      )}

      {matrixDlg && matrixAnchor && (
        <MatrixDialog
          key={matrixKey ?? "matrix"}
          mode={matrixDlg}
          initialEnv={matrixEnv}
          anchor={matrixAnchor}
          onApply={applyMatrix}
          onClose={() => setMatrixDlg(null)}
        />
      )}
    </div>
  );
}

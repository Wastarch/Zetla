// M1-12b · 二级工具栏（输入区域底部、编写区上方；对齐 Formula.html 工具栏）
// 第一行：颜色 ▾（\color 声明，作用于后续文本）｜字体 ▾ / 字号 ▾（wrapSelection 包裹选区或 \Box）
//         环境 ▾（\begin{}…\end{} 包裹）｜清空
// 第二行：源码 | 可视化切换 + 编写区字号缩放（− 16 +，clamp 11–20）
// 颜色为声明式插入（\color{red} 影响其后文本，参考 Formula.html 行为）；
// 字体/字号/环境为包裹式（有选区包选区，无选区包 \Box 槽——composeStore.wrapSelection）。
// 下拉面板用 position:fixed + 视口夹取：.math-region 带 overflow:hidden（圆角裁剪），
// absolute 定位的下拉会被区域边缘裁掉。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useComposeStore } from "./composeStore";

interface DropItem {
  label: string;
  /** 右侧提示（.mi .sc，如命令名/环境名） */
  hint?: string;
  run: () => void;
}

/** 下拉钮（fixed 定位 + 视口夹取/下溢上翻；点击外部/Esc 关闭；复用 .mi 菜单样式） */
function Drop({ label, items }: { label: string; items: DropItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      // 锚点钮也算「内部」——点它走按钮自身 toggle，不在此关
      if (ref.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  // 打开时测量并夹取：右溢左收、下溢上翻（与 InsertCtxMenu 同口径）
  useLayoutEffect(() => {
    if (!open || !ref.current || !btnRef.current) return;
    const r = ref.current.getBoundingClientRect();
    const b = btnRef.current.getBoundingClientRect();
    setPos((p) => ({
      x: Math.max(6, Math.min(p.x, window.innerWidth - r.width - 10)),
      y: p.y + r.height > window.innerHeight - 10 ? Math.max(6, b.top - r.height - 4) : p.y,
    }));
  }, [open]);

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ x: r.left, y: r.bottom + 4 });
    }
    setOpen((v) => !v);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={open ? "math-tool on" : "math-tool"}
        aria-expanded={open}
        onClick={toggle}
      >
        {label}
        <span className="math-tool-arrow">▾</span>
      </button>
      {open && (
        <div ref={ref} className="math-drop" style={{ left: pos.x, top: pos.y }} role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className="mi"
              onClick={() => {
                setOpen(false);
                it.run();
              }}
            >
              <span>{it.label}</span>
              {it.hint && <span className="sc">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export default function MathToolbar() {
  const mode = useComposeStore((s) => s.mode);
  const fontSize = useComposeStore((s) => s.fontSize);
  const setMode = useComposeStore((s) => s.setMode);
  const zoomFont = useComposeStore((s) => s.zoomFont);
  const clear = useComposeStore((s) => s.clear);
  /** 声明式插入（颜色）：写入编写区光标处 */
  const ins = (code: string) => useComposeStore.getState().insert(code);
  /** 包裹式插入（字体/字号/环境）：有选区包选区，无选区包 \Box */
  const wrap = (pre: string, suf: string) => useComposeStore.getState().wrapSelection(pre, suf);

  const colorItems: DropItem[] = ["红", "蓝", "绿", "橙", "紫", "灰"].map((label) => {
    const cmd = { 红: "red", 蓝: "blue", 绿: "green", 橙: "orange", 紫: "purple", 灰: "gray" }[label]!;
    return { label, hint: cmd, run: () => ins(`\\color{${cmd}}`) };
  });

  const fontItems: DropItem[] = [
    { label: "黑板粗体", hint: "mathbb", run: () => wrap("\\mathbb{", "}") },
    { label: "粗体", hint: "mathbf", run: () => wrap("\\mathbf{", "}") },
    { label: "斜体", hint: "mathit", run: () => wrap("\\mathit{", "}") },
    { label: "花体", hint: "mathcal", run: () => wrap("\\mathcal{", "}") },
    { label: "哥特体", hint: "mathfrak", run: () => wrap("\\mathfrak{", "}") },
    { label: "无衬线", hint: "mathsf", run: () => wrap("\\mathsf{", "}") },
    { label: "等宽", hint: "mathtt", run: () => wrap("\\mathtt{", "}") },
  ];

  const sizeItems: DropItem[] = [
    { label: "极小", hint: "tiny", run: () => wrap("\\tiny{", "}") },
    { label: "小", hint: "small", run: () => wrap("\\small{", "}") },
    { label: "大", hint: "large", run: () => wrap("\\large{", "}") },
    { label: "更大", hint: "Large", run: () => wrap("\\Large{", "}") },
    { label: "很大", hint: "LARGE", run: () => wrap("\\LARGE{", "}") },
    { label: "巨大", hint: "huge", run: () => wrap("\\huge{", "}") },
  ];

  const envItems: DropItem[] = [
    { label: "编号方程", hint: "equation", run: () => wrap("\\begin{equation}\n", "\n\\end{equation}") },
    { label: "无编号方程", hint: "equation*", run: () => wrap("\\begin{equation*}\n", "\n\\end{equation*}") },
    { label: "对齐组", hint: "align", run: () => wrap("\\begin{align}\n", "\n\\end{align}") },
    { label: "分段函数", hint: "cases", run: () => wrap("\\begin{cases}\n", "\n\\end{cases}") },
    { label: "矩阵", hint: "matrix", run: () => wrap("\\begin{matrix}\n", "\n\\end{matrix}") },
    { label: "圆括号矩阵", hint: "pmatrix", run: () => wrap("\\begin{pmatrix}\n", "\n\\end{pmatrix}") },
    { label: "方括号矩阵", hint: "bmatrix", run: () => wrap("\\begin{bmatrix}\n", "\n\\end{bmatrix}") },
    { label: "行列式", hint: "vmatrix", run: () => wrap("\\begin{vmatrix}\n", "\n\\end{vmatrix}") },
  ];

  return (
    <div className="math-tools">
      <div className="math-tools-row">
        <Drop label="颜色" items={colorItems} />
        <Drop label="字体" items={fontItems} />
        <Drop label="字号" items={sizeItems} />
        <Drop label="环境" items={envItems} />
        <button
          type="button"
          className="math-tool"
          title="清空编写区（Ctrl+Z 可撤销）"
          onClick={() => clear()}
        >
          清空
        </button>
      </div>
      <div className="math-tools-row">
        <div className="math-seg" role="group" aria-label="编写区模式">
          <button
            type="button"
            className={mode === "source" ? "on" : ""}
            onClick={() => setMode("source")}
          >
            源码
          </button>
          <button
            type="button"
            className={mode === "visual" ? "on" : ""}
            onClick={() => setMode("visual")}
          >
            可视化
          </button>
        </div>
        <div className="math-zoom">
          <button type="button" title="缩小字号" onClick={() => zoomFont(-1)}>
            −
          </button>
          <span className="math-zoom-val">{fontSize}</span>
          <button type="button" title="放大字号" onClick={() => zoomFont(1)}>
            +
          </button>
        </div>
      </div>
    </div>
  );
}

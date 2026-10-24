// M1-6 · 符号面板（懒加载组件，验证 slot 挂载 + Suspense 通路）
// 行为：分类展示 + 按名称/命令/字形搜索（如 alpha → \alpha），一键插入当前光标。
import { useEffect, useMemo, useRef, useState } from "react";
import { insertSnippet } from "@/core/moduleRegistry";
import symbolsData from "./symbols.json";

interface SymbolDef {
  name: string;
  cmd: string;
  category: string;
  glyph?: string;
}

const SYMBOLS = symbolsData as SymbolDef[];
const CATEGORIES = ["全部", ...Array.from(new Set(SYMBOLS.map((s) => s.category)))];

export default function SymbolPanel() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("全部");
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return SYMBOLS.filter((s) => {
      if (cat !== "全部" && s.category !== cat) return false;
      if (!kw) return true;
      return (
        s.name.toLowerCase().includes(kw) ||
        s.cmd.toLowerCase().includes(kw) ||
        (s.glyph ?? "").includes(kw)
      );
    });
  }, [q, cat]);

  useEffect(() => {
    return () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    };
  }, []);

  const insert = (def: SymbolDef) => {
    const ok = insertSnippet(def.cmd);
    if (!ok) return;
    setFlash(def.cmd);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1200);
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && filtered.length > 0) {
      e.preventDefault();
      insert(filtered[0]);
    }
  };

  return (
    <div className="symbol-panel">
      <div className="symbol-toolbar">
        <input
          className="symbol-search"
          placeholder="搜索符号，如 alpha / sum / ≤"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onSearchKey}
        />
        <select
          className="symbol-cat"
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          aria-label="符号分类"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {flash && <div className="symbol-flash">已插入 {flash}</div>}

      <div className="symbol-grid">
        {filtered.map((s) => (
          <button
            type="button"
            key={s.cmd}
            className="symbol-btn"
            title={`插入 ${s.cmd}`}
            onClick={() => insert(s)}
          >
            <span className={s.glyph ? "symbol-glyph" : "symbol-glyph is-cmd"}>
              {s.glyph ?? s.cmd}
            </span>
            {s.glyph && <span className="symbol-name">\{s.name}</span>}
          </button>
        ))}
        {filtered.length === 0 && <div className="symbol-empty">未找到匹配符号</div>}
      </div>
    </div>
  );
}

// M1-12b · 插入项右键菜单（符号面板 / 公式库条目共用）
// 复用项目树右键菜单的 .ctx/.mi 样式（zetla.css）；自绘原因：WebView 无原生 contextmenu。
// 口径对齐 project/CtxMenu.tsx：视口夹取 + 点击栏外/Esc/失焦关闭。
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface CtxAction {
  label: string;
  /** 右侧快捷键提示（.mi .sc） */
  sc?: string;
  /** 主项（accent 高亮，通常放第一项） */
  primary?: boolean;
  disabled?: boolean;
  /** 置灰/说明原因（title 提示） */
  hint?: string;
  onClick: () => void;
}

export function InsertCtxMenu({
  x,
  y,
  actions,
  onClose,
}: {
  x: number;
  y: number;
  actions: CtxAction[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // 关闭：点击菜单外 / Esc / 窗口失焦
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // 渲染后测量并夹取到视口（与 CtxMenu 同口径）
  useLayoutEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.max(6, Math.min(x, window.innerWidth - r.width - 10)),
      y: Math.max(6, Math.min(y, window.innerHeight - r.height - 10)),
    });
  }, [x, y]);

  return (
    <div
      ref={ref}
      className="ctx open"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
      role="menu"
    >
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          role="menuitem"
          className={a.primary ? "mi primary" : "mi"}
          disabled={a.disabled}
          title={a.hint}
          onClick={() => {
            onClose();
            a.onClick();
          }}
        >
          <span>{a.label}</span>
          {a.sc && <span className="sc">{a.sc}</span>}
        </button>
      ))}
    </div>
  );
}

export default InsertCtxMenu;

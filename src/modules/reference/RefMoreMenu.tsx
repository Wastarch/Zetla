// M1-36 · 引用面板页签右侧 ⋯ 菜单
// 把原独立一行 .ref-fmt-bar（Bib 条目格式）收进菜单，并加「更改引用命令」二级菜单。
// 样式复用项目右键菜单 .ctx/.mi（zetla.css），箭头统一用 ui/Chevron。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/core/settings";
import { notify } from "@/project/useProject";
import { Chevron } from "@/ui/Chevron";
import { ZOTERO_COMMANDS, type ZoteroCommand } from "@/types/zotero";

export interface RefMoreMenuProps {
  x: number;
  y: number;
  /** zotero.bibFormat 配置值（auto / bibtex / biblatex） */
  configured: string;
  /** 当前生效格式的可读文案 */
  effective: string;
  busy: boolean;
  onChooseFormat: (value: string) => void;
  onClose: () => void;
}

export function RefMoreMenu({
  x,
  y,
  configured,
  effective,
  busy,
  onChooseFormat,
  onClose,
}: RefMoreMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cmdBtnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [subTop, setSubTop] = useState(0);
  const [cmdOpen, setCmdOpen] = useState(false);
  const command = useSettingsStore((s) => s.settings.zotero?.defaultCommand ?? "cite");

  // 菜单外点击 / Esc 关闭（二级菜单渲染在根菜单内，点它不会误关整单）
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);

  // 视口夹取 + 二级菜单与「更改引用命令」项对齐
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const r = root.getBoundingClientRect();
    setPos({
      x: Math.max(6, Math.min(x, window.innerWidth - r.width - 10)),
      y: Math.max(6, Math.min(y, window.innerHeight - r.height - 10)),
    });
    const b = cmdBtnRef.current?.getBoundingClientRect();
    if (b) {
      setSubTop(Math.max(6, Math.min(b.top - r.top - 6, window.innerHeight - pos.y - 210)));
    }
  }, [x, y, pos.y]);

  const chooseCommand = (cmd: ZoteroCommand) => {
    const st = useSettingsStore.getState();
    const cur = st.settings.zotero;
    if (!cur) return;
    const next = { ...cur, defaultCommand: cmd };
    // 与 CitationPicker「上次使用记忆」同一配置键，运行时立即生效 + 旁路落盘
    st.setSettings({ ...st.settings, zotero: next });
    void st.persist({ zotero: next });
    notify(`默认引用命令已设为 \\${cmd}`);
    onClose();
  };

  return (
    <div
      ref={rootRef}
      className="ctx open ref-more-menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
      role="menu"
    >
      <div className="ref-more-fmt">
        <span>Bib 条目格式</span>
        <select
          className="ref-fmt-select"
          value={configured}
          disabled={busy}
          onChange={(e) => {
            onChooseFormat(e.target.value);
            onClose();
          }}
        >
          <option value="auto">跟随项目</option>
          <option value="bibtex">BibTeX</option>
          <option value="biblatex">biblatex</option>
        </select>
      </div>
      <div className="ref-more-effective">当前：{effective}</div>
      <div className="msep" />
      <button
        ref={cmdBtnRef}
        type="button"
        role="menuitem"
        className="mi"
        aria-expanded={cmdOpen}
        onClick={() => setCmdOpen((v) => !v)}
      >
        <span>更改引用命令</span>
        <span className="sc">
          <Chevron open={cmdOpen} size={12} />
        </span>
      </button>
      {cmdOpen && (
        <div className="ctx open ref-more-sub" style={{ top: subTop }} role="menu">
          {ZOTERO_COMMANDS.map((cmd) => (
            <button
              key={cmd}
              type="button"
              role="menuitem"
              className="mi"
              onClick={() => chooseCommand(cmd)}
            >
              <span>\{cmd}</span>
              {cmd === command && <span className="ref-more-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default RefMoreMenu;

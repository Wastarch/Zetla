// M1-37 · 引用面板页签右侧 ⋯ 菜单
// Bib 条目格式与引用命令统一为「标签 + 下拉框」两行；不再显示当前格式，
// 也不再用二级菜单切换命令。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/core/settings";
import { notify } from "@/project/useProject";
import { ZOTERO_COMMANDS, type ZoteroCommand } from "@/types/zotero";

export interface RefMoreMenuProps {
  x: number;
  y: number;
  /** zotero.bibFormat 配置值（auto / bibtex / biblatex） */
  configured: string;
  busy: boolean;
  onChooseFormat: (value: string) => void;
  onClose: () => void;
}

export function RefMoreMenu({
  x,
  y,
  configured,
  busy,
  onChooseFormat,
  onClose,
}: RefMoreMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const command = useSettingsStore((s) => s.settings.zotero?.defaultCommand ?? "cite");

  // 菜单外点击 / Esc 关闭
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

  // 视口夹取（菜单渲染后按实际尺寸校正）
  useLayoutEffect(() => {
    const r = rootRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      x: Math.max(6, Math.min(x, window.innerWidth - r.width - 10)),
      y: Math.max(6, Math.min(y, window.innerHeight - r.height - 10)),
    });
  }, [x, y]);

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
      <div className="ref-more-row">
        <span>Bib 条目格式</span>
        <select
          className="ref-more-select"
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
      <div className="ref-more-row">
        <span>引用命令</span>
        <select
          className="ref-more-select"
          value={command}
          onChange={(e) => chooseCommand(e.target.value as ZoteroCommand)}
        >
          {ZOTERO_COMMANDS.map((cmd) => (
            <option key={cmd} value={cmd}>
              \{cmd}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default RefMoreMenu;

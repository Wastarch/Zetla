// M1-17 · 语法高亮配色对话框（设置页「外观与保存 → 语法高亮」入口打开）
// 编辑 LaTeX 各语义分组的亮/暗配色；改动即时写入设置草稿（store.settings），
// 编辑器订阅同一份设置即时预览；点「取消」由 SettingsDialog 回滚快照。
import { useCallback } from "react";
import { useSettingsStore } from "@/core/settings";
import { cloneSettings, DEFAULT_LATEX_HIGHLIGHT, type HighlightGroup } from "@/types/settings";
import { Icon } from "@/ui/Icon";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** 单个颜色字段：原生取色器 + 可手输 hex（校验 6 位十六进制） */
function ColorField({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <span className="hl-theme">
      <input
        type="color"
        value={HEX_RE.test(value) ? value : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        aria-label="取色器"
      />
      <input
        className="txt-in hl-hex"
        value={value}
        spellCheck={false}
        onChange={(e) => {
          const v = e.target.value.trim();
          if (HEX_RE.test(v)) onChange(v);
        }}
      />
    </span>
  );
}

export function SyntaxHighlightDialog({ onClose }: { onClose: () => void }) {
  const draft = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const groups = draft.highlight?.latex ?? DEFAULT_LATEX_HIGHLIGHT;

  // 写入设置草稿（基于最新 store 值深拷贝，避免闭包拿到旧引用）
  const commit = useCallback(
    (next: HighlightGroup[]) => {
      const cur = useSettingsStore.getState().settings;
      setSettings({ ...cloneSettings(cur), highlight: { latex: next } });
    },
    [setSettings],
  );

  const setGroup = (id: string, patch: Partial<HighlightGroup>) =>
    commit(groups.map((g) => (g.id === id ? { ...g, ...patch } : g)));

  const resetDefaults = () => commit(DEFAULT_LATEX_HIGHLIGHT);

  return (
    <div className="modal-layer" role="dialog" aria-label="语法高亮配色" onMouseDown={onClose}>
      <div
        className="modal syntax-hl"
        style={{ width: "min(620px, 92vw)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <Icon name="sliders" size={18} style={{ color: "var(--accent)" }} />
          <div>
            <h2>LaTeX 语法高亮配色</h2>
            <div className="sub">控制序列 / 环境名 / 章节 / 数学符号等语义分组的上色</div>
          </div>
          <button type="button" className="ibtn x" title="关闭" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="modal-body">
          <div className="hl-head">
            <span className="hl-label">语义分组</span>
            <span className="hl-cols">
              <span>亮色</span>
              <span>暗色</span>
            </span>
          </div>
          <div className="hl-list">
            {groups.map((g) => (
              <div className="hl-row" key={g.id}>
                <span className="hl-label" title={g.label}>
                  {g.label}
                </span>
                <span className="hl-cols">
                  <ColorField value={g.light} onChange={(hex) => setGroup(g.id, { light: hex })} />
                  <ColorField value={g.dark} onChange={(hex) => setGroup(g.id, { dark: hex })} />
                </span>
              </div>
            ))}
          </div>
          <p className="set-note">
            颜色即时预览（编辑器与主题同步）；「恢复默认」回填出厂配色。未保存前可点设置页「取消」整体回滚。
          </p>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn" onClick={resetDefaults}>
            恢复默认
          </button>
          <div style={{ marginLeft: "auto" }}>
            <button type="button" className="btn primary" onClick={onClose}>
              完成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SyntaxHighlightDialog;

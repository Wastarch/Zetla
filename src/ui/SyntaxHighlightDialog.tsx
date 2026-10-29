// M1-17 · 语法高亮配色对话框（设置页「外观与保存 → 语法高亮」入口打开）
// 编辑 LaTeX 各语义分组的亮/暗配色；改动即时写入设置草稿（store.settings），
// 编辑器订阅同一份设置即时预览；点「取消」由 SettingsDialog 回滚快照。
import { useCallback, useRef, type ChangeEvent } from "react";
import { useSettingsStore } from "@/core/settings";
import { cloneSettings, DEFAULT_LATEX_HIGHLIGHT, type HighlightGroup } from "@/types/settings";
import { Icon } from "@/ui/Icon";
import {
  BUILTIN_HIGHLIGHT_PRESETS,
  cloneGroups,
  findPreset,
  matchPresetId,
} from "@/editor/highlightPresets";

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

  // 当前分组是否完全命中某个预设（用于在下拉里回显「自定义」）
  const activePreset = matchPresetId(groups);

  const applyPreset = (id: string) => {
    const p = findPreset(id);
    if (p) commit(cloneGroups(p.groups));
  };

  const fileRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const payload = {
      app: "zetla",
      type: "highlight-v1",
      name: "LaTeX 语法高亮配色",
      groups,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "zetla-highlight.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 允许重复选择同一文件
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const arr: unknown = Array.isArray(parsed) ? parsed : (parsed as { groups?: unknown }).groups;
        if (!Array.isArray(arr)) throw new Error("文件缺少 groups 数组");
        const next: HighlightGroup[] = (arr as Record<string, unknown>[]).map((g) => ({
          id: String(g.id),
          label: String(g.label ?? g.id),
          tags: Array.isArray(g.tags) ? (g.tags as unknown[]).map(String) : [],
          light: String(g.light ?? "#000000"),
          dark: String(g.dark ?? "#000000"),
        }));
        for (const g of next) {
          if (!HEX_RE.test(g.light) || !HEX_RE.test(g.dark)) {
            throw new Error(`分组「${g.label}」颜色非法，须为 #RRGGBB`);
          }
          if (g.tags.length === 0) {
            throw new Error(`分组「${g.label}」缺少 tags（lezer 标签名）`);
          }
        }
        commit(next);
      } catch (err) {
        alert("导入失败：" + (err instanceof Error ? err.message : String(err)));
      }
    };
    reader.readAsText(file);
  };

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
          <div className="hl-presets">
            <span className="hl-label">主题方案</span>
            <select
              className="txt-in"
              value={activePreset ?? ""}
              onChange={(e) => applyPreset(e.target.value)}
            >
              <option value="">自定义（当前）</option>
              {BUILTIN_HIGHLIGHT_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn" onClick={handleExport}>
              导出
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => fileRef.current?.click()}
            >
              导入
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={handleImport}
            />
          </div>
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

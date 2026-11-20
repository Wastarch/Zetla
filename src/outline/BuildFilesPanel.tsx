// M1-39 · 资源管理器底部「构建文件」折叠面板（位于大纲上方）
// 复用 .outline 折叠样式；列出输出目录（或主文件同目录）的编译产物，点击在标签中打开。
import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "@/core/store";
import { useSettingsStore } from "@/core/settings";
import { projectApi } from "@/ipc/invoke";
import { useProjectStore } from "@/project/useProject";
import { Chevron } from "@/ui/Chevron";
import { Icon } from "@/ui/Icon";
import { DEFAULT_AUX_EXTENSIONS } from "@/types";
import type { BuildArtifact } from "@/types/project";
import { OUTLINE_HEAD_H } from "./outlineLayout";
import {
  artifactKind,
  formatArtifactSize,
  formatArtifactTime,
  sortArtifacts,
} from "./buildArtifacts";

/** 展开态固定高度（无拖拽条，列表内部滚动）；折叠态只留标题行 */
const BUILD_FILES_H = 152;

export function BuildFilesPanel() {
  const root = useProjectStore((s) => s.root);
  const mainFile = useProjectStore((s) => s.tree?.mainFile ?? null);
  const outputDir = useProjectStore((s) => s.tree?.outputDir ?? null);
  const openFromTree = useProjectStore((s) => s.openFromTree);
  const previewRev = useAppStore((s) => s.previewRev);
  const expanded = useAppStore((s) => s.buildFilesExpanded);
  const toggle = useAppStore((s) => s.toggleBuildFiles);

  const [items, setItems] = useState<BuildArtifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [manualRev, setManualRev] = useState(0);

  const refresh = useCallback(async () => {
    if (!root || !mainFile) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const cfg = useSettingsStore.getState().settings.build.cleanAuxExtensions;
      const extensions = cfg?.length ? cfg : DEFAULT_AUX_EXTENSIONS;
      const found = await projectApi.listBuildArtifacts(root, mainFile, outputDir, extensions);
      setItems(sortArtifacts(found));
    } catch (e) {
      setError(String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [root, mainFile, outputDir]);

  // 打开项目 / 编译完成 / 手动刷新 / 输出目录变化时重列；折叠态也刷计数
  useEffect(() => {
    void refresh();
  }, [refresh, previewRev, manualRev]);

  const dirLabel = outputDir ? outputDir : mainFile ? "主文件目录" : "—";

  return (
    <div
      className={`outline build-files${expanded ? "" : " collapsed"}`}
      style={{ height: expanded ? BUILD_FILES_H : OUTLINE_HEAD_H }}
    >
      <div className="outline-head">
        <button
          type="button"
          className="outline-caret"
          title={expanded ? "折叠构建文件" : "展开构建文件"}
          onClick={toggle}
        >
          <Chevron open={expanded} />
        </button>
        <span className="outline-title">构建文件</span>
        <span className="outline-count">{items.length ? `· ${items.length}` : ""}</span>
        <span className="outline-spacer" />
        <button
          type="button"
          className="outline-refresh"
          title={`重新扫描构建产物（${dirLabel}）`}
          onClick={() => setManualRev((n) => n + 1)}
        >
          ⟳
        </button>
      </div>

      {expanded && (
        <>
          {!root || !mainFile ? (
            <div className="outline-empty">打开项目后显示构建文件</div>
          ) : loading ? (
            <div className="outline-empty">扫描中…</div>
          ) : error ? (
            <div className="outline-empty outline-err">扫描失败：{error}</div>
          ) : items.length === 0 ? (
            <div className="outline-empty">暂无构建产物（编译后显示）</div>
          ) : (
            <div className="outline-list">
              {items.map((a) => {
                const kind = artifactKind(a.name);
                return (
                  <div
                    key={a.path}
                    className={`outline-item build-artifact ba-${kind}`}
                    title={`${a.path}\n${formatArtifactSize(a.size)} · ${formatArtifactTime(a.modified)}`}
                    onClick={() => openFromTree(a.path)}
                  >
                    <Icon name={kind === "pdf" ? "pdf" : "file"} size={13} className="ba-icon" />
                    <span className="outline-text">{a.name}</span>
                    <span className="outline-file">
                      {formatArtifactSize(a.size)} · {formatArtifactTime(a.modified)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default BuildFilesPanel;

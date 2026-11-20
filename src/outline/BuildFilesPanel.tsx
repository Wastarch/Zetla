// M1-39/M1-40 · 资源管理器底部「构建文件」折叠面板（位于大纲上方）
// 复用 .outline 折叠样式；列出输出目录（或主文件同目录）的编译产物，点击在标签中打开。
// M1-40：顶部可拖拽调高（96–480，与大纲互相钳制），PDF 恒置顶。
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useAppStore } from "@/core/store";
import { useSettingsStore } from "@/core/settings";
import { projectApi } from "@/ipc/invoke";
import { useProjectStore } from "@/project/useProject";
import { Chevron } from "@/ui/Chevron";
import { Icon } from "@/ui/Icon";
import { DEFAULT_AUX_EXTENSIONS } from "@/types";
import type { BuildArtifact } from "@/types/project";
import { OUTLINE_HEAD_H, clampBuildFilesHeight } from "./outlineLayout";
import {
  artifactKind,
  formatArtifactSize,
  formatArtifactTime,
  sortArtifacts,
} from "./buildArtifacts";

export function BuildFilesPanel() {
  const root = useProjectStore((s) => s.root);
  const mainFile = useProjectStore((s) => s.tree?.mainFile ?? null);
  const outputDir = useProjectStore((s) => s.tree?.outputDir ?? null);
  const openFromTree = useProjectStore((s) => s.openFromTree);
  const previewRev = useAppStore((s) => s.previewRev);
  // M1-41：手动清理后由 menuActions 触发，避免只 refresh(true) 时面板仍是旧清单
  const buildFilesRev = useAppStore((s) => s.buildFilesRev);
  const expanded = useAppStore((s) => s.buildFilesExpanded);
  const toggle = useAppStore((s) => s.toggleBuildFiles);
  const height = useAppStore((s) => s.buildFilesHeight);
  const setHeight = useAppStore((s) => s.setBuildFilesHeight);
  const outlineExpanded = useAppStore((s) => s.outlineExpanded);
  const outlineHeight = useAppStore((s) => s.outlineHeight);

  const [items, setItems] = useState<BuildArtifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [manualRev, setManualRev] = useState(0);

  const sectionRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ y: number; h: number } | null>(null);

  const refresh = useCallback(async () => {
    if (!root || !mainFile) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const cfg = useSettingsStore.getState().settings.build.cleanAuxExtensions;
      const base = cfg?.length ? cfg : DEFAULT_AUX_EXTENSIONS;
      // M1-40：树中隐藏的 .bcf / .run.xml 不在默认 cleanAux 列表，补进面板避免「两边都看不到」
      const extensions = Array.from(new Set([...base, ".bcf", ".run.xml"]));
      const found = await projectApi.listBuildArtifacts(root, mainFile, outputDir, extensions);
      setItems(sortArtifacts(found));
    } catch (e) {
      setError(String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [root, mainFile, outputDir]);

  // 打开项目 / 编译完成 / 手动刷新 / 手动清理 / 输出目录变化时重列；折叠态也刷计数
  useEffect(() => {
    void refresh();
  }, [refresh, previewRev, buildFilesRev, manualRev]);

  // 顶部横线拖拽改高度：与大纲互相扣减占用，项目树始终至少留 MIN_TREE_H。
  // 拖拽中不写盘，useWindowMemory 的 layoutKey + 500ms 防抖负责持久化。
  const onResizeDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = { y: e.clientY, h: height };
      setDragging(true);
      document.body.classList.add("row-resizing");
    },
    [height],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const sidebarH = sectionRef.current?.parentElement?.clientHeight ?? window.innerHeight - 100;
      const outlineH = outlineExpanded ? outlineHeight : OUTLINE_HEAD_H;
      setHeight(clampBuildFilesHeight(d.h - (e.clientY - d.y), sidebarH, outlineH));
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
      document.body.classList.remove("row-resizing");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("row-resizing");
    };
  }, [dragging, setHeight, outlineExpanded, outlineHeight]);

  // 窗口/大纲变化时兜底：记忆的高度不得超过当前可容纳上限
  useEffect(() => {
    const clamp = () => {
      const sidebarH = sectionRef.current?.parentElement?.clientHeight ?? window.innerHeight - 100;
      const outlineH = outlineExpanded ? outlineHeight : OUTLINE_HEAD_H;
      const c = clampBuildFilesHeight(height, sidebarH, outlineH);
      if (c !== height) setHeight(c);
    };
    clamp();
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [height, setHeight, outlineExpanded, outlineHeight]);

  const dirLabel = outputDir ? outputDir : mainFile ? "主文件目录" : "—";

  return (
    <div
      ref={sectionRef}
      className={`outline build-files${expanded ? "" : " collapsed"}${dragging ? " dragging" : ""}`}
      style={{ height: expanded ? height : OUTLINE_HEAD_H }}
    >
      {expanded && (
        <div
          className="outline-resizer"
          title="拖拽调整构建文件区高度"
          onPointerDown={onResizeDown}
        />
      )}
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

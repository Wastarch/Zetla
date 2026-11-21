// v1：绘图 Tab 顶栏「源码来源」下拉面板。
// 分区布局：状态摘要 / 操作区（重新扫描 · 从文件导入 · 自动导入开关）/ 候选区。
// 自行管理视口夹取与点外·Esc·失焦关闭（口径同 ui/InsertCtxMenu），
// 因为扁平 CtxAction 列表无法承载标题、开关与空态文案。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { notify } from "@/project/useProject";
import type { TikzSourceCandidate } from "@/types/diagram";
import { useDiagramStore } from "./store";

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

function describeCandidate(c: TikzSourceCandidate): string {
  const where = c.kind === "tex-env" ? `${c.relPath}:${c.startLine}` : c.relPath;
  const first = c.rawSource.split("\n").find((l) => l.trim())?.trim() ?? "（空片段）";
  return `${where} · ${first}`;
}

export function TikzSourceMenu({
  x,
  y,
  onClose,
}: {
  x: number;
  y: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  const candidates = useDiagramStore((s) => s.tikzCandidates);
  const scanStatus = useDiagramStore((s) => s.tikzScanStatus);
  const scanError = useDiagramStore((s) => s.tikzScanError);
  const activeCandidateId = useDiagramStore((s) => s.activeCandidateId);
  const importedPath = useDiagramStore((s) => s.importedPath);
  const autoImportEnabled = useDiagramStore((s) => s.autoImportEnabled);
  const setAutoImportEnabled = useDiagramStore((s) => s.setAutoImportEnabled);
  const setActiveCandidateId = useDiagramStore((s) => s.setActiveCandidateId);
  const refreshTikzSources = useDiagramStore((s) => s.refreshTikzSources);
  const applyTikzCandidate = useDiagramStore((s) => s.applyTikzCandidate);
  const importTikzFileFromPath = useDiagramStore((s) => s.importTikzFileFromPath);

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

  useLayoutEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.max(6, Math.min(x, window.innerWidth - r.width - 10)),
      y: Math.max(6, Math.min(y, window.innerHeight - r.height - 10)),
    });
  }, [x, y]);

  const statusLabel =
    scanStatus === "scanning"
      ? "扫描中…"
      : scanStatus === "error"
        ? "扫描失败"
        : importedPath
          ? "已导入"
          : candidates.length > 0
            ? `${candidates.length} 个候选`
            : "未发现候选";

  const summary =
    scanStatus === "scanning"
      ? "正在读取项目里的 .tikz 文件与 .tex 环境"
      : scanError
        ? scanError
        : importedPath
          ? `当前源码来自 ${basename(importedPath)}`
          : candidates.length > 0
            ? "发现来源但尚未导入，点下方候选载入"
            : "当前显示默认示例；可从项目扫描或导入外部文件";

  const applyCandidate = (c: TikzSourceCandidate) => {
    setActiveCandidateId(c.id);
    applyTikzCandidate(c);
    notify(`已导入 ${describeCandidate(c)}`, "ok");
    onClose();
  };

  const pickExternalFile = async () => {
    const picked = await openFileDialog({
      multiple: false,
      filters: [{ name: "TikZ / LaTeX", extensions: ["tikz", "tex", "ltx"] }],
    });
    if (!picked) return;
    const path = typeof picked === "string" ? picked : picked[0];
    if (!path) return;
    try {
      const count = await importTikzFileFromPath(path);
      if (count === 0) {
        notify("该文件未找到 TikZ 图（需含 tikzpicture 环境或绘图命令）", "err");
      } else if (count === 1) {
        notify(`已导入外部文件 ${basename(path)}`, "ok");
        onClose();
      } else {
        notify(`从 ${basename(path)} 找到 ${count} 张图，请在下方候选中选择`, "ok");
      }
    } catch (e) {
      notify(`导入失败：${e instanceof Error ? e.message : String(e)}`, "err");
    }
  };

  return (
    <div
      ref={ref}
      className="dg-src-pop"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
      role="menu"
      aria-label="源码来源"
    >
      <div className="dg-src-pop-head">
        <span className="dg-src-pop-title">源码来源</span>
        <span className={`dg-src-pop-badge${scanStatus === "error" ? " is-err" : ""}`}>
          {statusLabel}
        </span>
      </div>
      <p className="dg-src-pop-summary">{summary}</p>

      <div className="dg-src-pop-group">
        <div className="dg-src-pop-actions">
          <button
            type="button"
            className="dg-src-pop-btn"
            disabled={scanStatus === "scanning"}
            title="重新扫描当前项目里的 .tikz 文件与 .tex/.ltx 中的 tikzpicture"
            onClick={() => void refreshTikzSources()}
          >
            {scanStatus === "scanning" ? "扫描中…" : "重新扫描"}
          </button>
          <button
            type="button"
            className="dg-src-pop-btn"
            title="从项目外的 .tikz / .tex / .ltx 文件导入源码"
            onClick={() => void pickExternalFile()}
          >
            从外部文件导入…
          </button>
        </div>
        <button
          type="button"
          className="dg-src-pop-toggle"
          role="menuitemcheckbox"
          aria-checked={autoImportEnabled}
          title="打开绘图 Tab 时是否自动导入唯一候选"
          onClick={() => setAutoImportEnabled(!autoImportEnabled)}
        >
          <span>打开时自动导入</span>
          <span className={`dg-src-switch${autoImportEnabled ? " is-on" : ""}`} aria-hidden="true">
            <span className="dg-src-switch-knob" />
          </span>
        </button>
      </div>

      <div className="dg-src-pop-group">
        <div className="dg-src-pop-sectitle">候选来源 · {candidates.length}</div>
        {candidates.length === 0 ? (
          <p className="dg-src-pop-empty">
            未发现来源。可在项目里放 .tikz 文件 / .tex 中的 tikzpicture，或点「从文件导入…」。
          </p>
        ) : (
          <ul className="dg-src-pop-list">
            {candidates.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  role="menuitem"
                  className={`dg-src-pop-item${activeCandidateId === c.id ? " is-active" : ""}`}
                  title={`${c.reason} · 置信度 ${c.confidence}`}
                  onClick={() => applyCandidate(c)}
                >
                  <span className="dg-src-pop-item-row">
                    <span className="dg-src-pop-item-path">
                      {c.kind === "tex-env" ? `${c.relPath}:${c.startLine}` : c.relPath}
                    </span>
                    <span className="dg-src-pop-item-tags">
                      {c.origin === "external" && <span className="dg-src-pop-tag is-ext">外部</span>}
                      <span className="dg-src-pop-tag">
                        {c.kind === "tikz-file" ? "文件" : "环境"}
                      </span>
                    </span>
                  </span>
                  <span className="dg-src-pop-item-preview">
                    {c.rawSource.split("\n").find((l) => l.trim())?.trim() || "（空片段）"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default TikzSourceMenu;

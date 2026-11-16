// P3-6 · 「体检」页签（引用完整性诊断，只读）
//
// 数据：项目 .bib 索引 + 全文引用位置 + map.json + Zotero 回收站清单（可离线跳过）。
// 动作只有两个：跳到问题位置、在 Zotero 中打开条目。不做任何自动修复。
import { useCallback, useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { zoteroApi } from "@/ipc/invoke";
import { useReferenceStore } from "@/modules/reference/useReferenceStore";
import { useSettingsStore } from "@/core/settings";
import { useZoteroStore } from "@/modules/zotero/useZoteroStore";
import { zoteroSelectUrl } from "@/modules/zotero/zoteroReverse";
import {
  INTEGRITY_LABEL,
  INTEGRITY_ORDER,
  buildIntegrityReport,
  integritySummary,
  parseItemKeysFromJson,
  type IntegrityReport,
} from "@/modules/zotero/zoteroIntegrity";

/** 一次最多渲染多少行（未引用条目在大库里可能上百条） */
const RENDER_CAP = 200;

export interface ZoteroIntegrityPaneProps {
  onJump: (file: string, line: number) => void;
  onNotice: (msg: string, kind?: "ok" | "err") => void;
}

export function ZoteroIntegrityPane({ onJump, onNotice }: ZoteroIntegrityPaneProps) {
  const entries = useReferenceStore((s) => s.entries);
  const citations = useReferenceStore((s) => s.citations);
  const keyMap = useZoteroStore((s) => s.keyMap);
  const health = useZoteroStore((s) => s.health);
  const settings = useSettingsStore((s) => s.settings.zotero);
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);

  const enabled = !!settings?.enabled;
  const connected = health?.state === "connected";
  const port = health?.port ?? settings?.port ?? 23119;

  const run = useCallback(async () => {
    setBusy(true);
    let trashKeys: Set<string> | null = null;
    setTrashError(null);
    if (enabled && connected) {
      try {
        const raw = await zoteroApi.trashItems(port, 200);
        trashKeys = new Set(parseItemKeysFromJson(raw));
      } catch (e) {
        // 离线/权限失败：降级为「回收站未检查」，绝不误报
        trashKeys = null;
        setTrashError(`回收站未检查：${String(e)}`);
      }
    }
    const next = buildIntegrityReport({
      bibEntries: entries.map((e) => ({ key: e.key, file: e.file, line: e.line })),
      citations: citations.map((c) => ({ key: c.key, file: c.file, line: c.line })),
      keyMap,
      trashKeys,
    });
    setReport(next);
    setBusy(false);
  }, [entries, citations, keyMap, enabled, connected, port]);

  // 首次进入 + 索引变化时自动体检（纯内存计算，不发请求；回收站请求仅在连接可用时）
  useEffect(() => {
    void run();
  }, [run]);

  const shown = useMemo(() => report?.issues.slice(0, RENDER_CAP) ?? [], [report]);
  const overflow = report ? Math.max(0, report.issues.length - RENDER_CAP) : 0;

  const onOpenItem = useCallback(
    async (itemKey: string) => {
      const url = zoteroSelectUrl(itemKey);
      if (!url) {
        onNotice("itemKey 非法，无法定位", "err");
        return;
      }
      try {
        await openUrl(url);
      } catch (e) {
        onNotice(`打开 Zotero 失败：${String(e)}`, "err");
      }
    },
    [onNotice],
  );

  return (
    <div className="zo-diag">
      <div className="zo-diag-head">
        <span className="zo-diag-summary">{report ? integritySummary(report) : "正在体检…"}</span>
        <button type="button" className="zo-diag-run" disabled={busy} onClick={() => void run()}>
          {busy ? "体检中…" : "重新体检"}
        </button>
      </div>

      {report && (
        <>
          <div className="zo-diag-chips">
            {INTEGRITY_ORDER.map((k) => (
              <span
                key={k}
                className={report.counts[k] > 0 ? "zo-diag-chip zo-diag-chip-on" : "zo-diag-chip"}
                title={`${INTEGRITY_LABEL[k]}：${report.counts[k]} 处`}
              >
                {INTEGRITY_LABEL[k]} {report.counts[k]}
              </span>
            ))}
          </div>
          <div className="zo-diag-meta">
            {report.bibCount} 条文献 · {report.citeCount} 个被引 key · 映射 {report.mapCount} 条
            {report.trashChecked ? " · 回收站已检查" : " · 回收站未检查"}
          </div>
          {trashError && <div className="zo-diag-warn">{trashError}</div>}
          {!enabled && <div className="zo-diag-warn">Zotero 联动已关闭：仅做离线诊断。</div>}
        </>
      )}

      <div className="zo-diag-list">
        {report && report.issues.length === 0 ? (
          <div className="zo-diag-empty">没有发现问题。</div>
        ) : (
          shown.map((it, idx) => (
            <div className="zo-diag-row" key={`${it.kind}:${it.key}:${idx}`}>
              <span className={`zo-diag-kind zo-diag-kind-${it.kind}`}>{INTEGRITY_LABEL[it.kind]}</span>
              <div className="zo-diag-body">
                <div className="zo-diag-key">{it.key}</div>
                <div className="zo-diag-detail">{it.detail}</div>
              </div>
              <div className="zo-diag-ops">
                {it.file && it.line ? (
                  <button
                    type="button"
                    className="zo-diag-op"
                    title={`${it.file}:${it.line}`}
                    onClick={() => onJump(it.file as string, it.line as number)}
                  >
                    定位
                  </button>
                ) : null}
                {it.itemKey ? (
                  <button
                    type="button"
                    className="zo-diag-op"
                    title="在 Zotero 中定位该条目"
                    onClick={() => void onOpenItem(it.itemKey as string)}
                  >
                    Zotero
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      {overflow > 0 && (
        <div className="zo-diag-foot">仅显示前 {RENDER_CAP} 条，另有 {overflow} 条未列出。</div>
      )}
    </div>
  );
}

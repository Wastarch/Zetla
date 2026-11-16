// Zotero 联动 · P1 设置页「项目绑定与自动同步」
// 只读 Zotero：所有 HTTP 由 Rust 发出；本组件只做表单与状态展示。
import { useEffect, useState } from "react";
import { useSettingsStore } from "@/core/settings";
import { useProjectStore } from "@/project/useProject";
import {
  DEFAULT_ZOTERO_BINDING,
  DEFAULT_ZOTERO_SETTINGS,
  type ZoteroBinding,
  type ZoteroCollection,
  type ZoteroSyncMode,
} from "@/types/zotero";
import {
  fetchZoteroCollections,
  persistZoteroBindings,
  syncAllZoteroBindings,
  syncZoteroBinding,
} from "./zoteroRuntime";
import { isPathInsideRoot, normalizeBibPath, pathKey, syncSummary } from "./zoteroSync";
import { useZoteroStore } from "./useZoteroStore";

export function ZoteroBindingPane() {
  const root = useProjectStore((s) => s.root);
  const z = useSettingsStore((s) => s.settings.zotero ?? DEFAULT_ZOTERO_SETTINGS);
  const bindings = useZoteroStore((s) => s.bindings);
  const keyMap = useZoteroStore((s) => s.keyMap);
  const lastSync = useZoteroStore((s) => s.lastSync);
  const syncBusy = useZoteroStore((s) => s.syncBusy);
  const syncError = useZoteroStore((s) => s.syncError);
  const consistency = useZoteroStore((s) => s.consistency);
  const bibChange = useZoteroStore((s) => s.bibChange);

  const [collections, setCollections] = useState<ZoteroCollection[]>([]);
  const [draftKey, setDraftKey] = useState("");
  const [draftPath, setDraftPath] = useState(DEFAULT_ZOTERO_BINDING.bibPath);
  const [draftFormat, setDraftFormat] = useState<"bibtex" | "biblatex">("bibtex");
  /** P4：新绑定默认「插一篇写一篇」；存量绑定迁移为全量（行为不变） */
  const [draftMode, setDraftMode] = useState<ZoteroSyncMode>("on-demand");
  const [collectionsBusy, setCollectionsBusy] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!z.enabled || !root) return;
    void (async () => {
      setCollectionsBusy(true);
      try {
        setCollections(await fetchZoteroCollections(z.port));
      } catch {
        setCollections([]);
      } finally {
        setCollectionsBusy(false);
      }
    })();
  }, [z.enabled, z.port, root]);

  const loadCollections = async () => {
    setCollectionsBusy(true);
    setNote("");
    try {
      const list = await fetchZoteroCollections(z.port);
      setCollections(list);
      setNote(list.length ? `已读取 ${list.length} 个 Zotero 分类` : "本地 API 未返回分类（库可能为空）");
    } catch (e) {
      setNote(`读取分类失败：${String(e)}`);
    } finally {
      setCollectionsBusy(false);
    }
  };

  const addBinding = async () => {
    if (!root) return;
    const bibPath = draftPath.trim() || DEFAULT_ZOTERO_BINDING.bibPath;
    const name = draftKey
      ? collections.find((c) => c.key === draftKey)?.name ?? draftKey
      : "全库（不按分类）";
    const next: ZoteroBinding = {
      collectionKey: draftKey,
      collectionName: name,
      bibPath,
      format: draftFormat,
      enabled: true,
      syncMode: draftMode,
    };
    const abs = normalizeBibPath(root, bibPath);
    const dedup = bindings.filter((b) => pathKey(normalizeBibPath(root, b.bibPath)) !== pathKey(abs));
    setFormBusy(true);
    setNote("");
    try {
      await persistZoteroBindings([...dedup, next]);
      setNote(isPathInsideRoot(root, abs)
        ? `已绑定 ${name} → ${bibPath}（可主动同步 + 自动监听）`
        : `已绑定 ${name} → ${bibPath}（项目外：仅监听与索引，写盘由 BBT 负责）`);
    } catch (e) {
      setNote(`保存绑定失败：${String(e)}`);
    } finally {
      setFormBusy(false);
    }
  };

  const removeBinding = async (b: ZoteroBinding) => {
    setFormBusy(true);
    try {
      await persistZoteroBindings(bindings.filter((x) => x !== b));
      setNote(`已移除绑定 ${b.collectionName}`);
    } catch (e) {
      setNote(`移除失败：${String(e)}`);
    } finally {
      setFormBusy(false);
    }
  };

  const toggleMode = async (b: ZoteroBinding) => {
    const nextMode: ZoteroSyncMode = b.syncMode === "on-demand" ? "full" : "on-demand";
    setFormBusy(true);
    try {
      await persistZoteroBindings(
        bindings.map((x) => (x === b ? { ...x, syncMode: nextMode } : x)),
      );
      setNote(
        `已把 ${b.collectionName} 切换为「${nextMode === "on-demand" ? "按需写入（插一篇写一篇）" : "全量同步"}」模式`,
      );
    } catch (e) {
      setNote(`切换失败：${String(e)}`);
    } finally {
      setFormBusy(false);
    }
  };

  const syncOne = async (b: ZoteroBinding) => {
    setNote("同步中…");
    const r = await syncZoteroBinding(b);
    setNote(syncSummary(r));
  };

  const syncAll = async () => {
    setNote("同步中…");
    const rs = await syncAllZoteroBindings();
    setNote(rs.length ? rs.map(syncSummary).join(" ｜ ") : "没有启用的绑定");
  };

  return (
    <div className="zotero-bind-pane">
      <h4>项目绑定（Phase 1）</h4>
      {!root ? (
        <p className="set-note">请先打开一个项目；绑定保存在项目的 <code>.ltex/config.json</code>。</p>
      ) : (
        <>
          <div className="fld">
            <div className="lbl">
              <b>Zotero 分类</b>
              <span>选择要同步的 collection；「全库」表示所有顶层题录</span>
            </div>
            <div className="zotero-bind-line">
              <select
                className="txt-in zotero-bind-select"
                value={draftKey}
                onChange={(e) => setDraftKey(e.target.value)}
              >
                <option value="">全库（不按分类）</option>
                {collections.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name}{c.parentCollection ? ` · 子分类` : ""}（{c.key}）
                  </option>
                ))}
              </select>
              <button type="button" className="btn sm" disabled={collectionsBusy} onClick={() => void loadCollections()}>
                {collectionsBusy ? "读取中…" : "↻ 读取分类"}
              </button>
            </div>
          </div>

          <div className="fld">
            <div className="lbl">
              <b>受管 .bib 路径</b>
              <span>相对项目根（推荐）；项目外绝对路径只监听与索引，写入交给 BBT Keep updated</span>
            </div>
            <div className="zotero-bind-line">
              <input
                className="txt-in zotero-bind-input"
                value={draftPath}
                onChange={(e) => setDraftPath(e.target.value)}
                placeholder="references.bib"
              />
              <select
                className="txt-in zotero-bind-format"
                value={draftFormat}
                onChange={(e) => setDraftFormat(e.target.value as "bibtex" | "biblatex")}
              >
                <option value="bibtex">bibtex</option>
                <option value="biblatex">biblatex</option>
              </select>
              <select
                className="txt-in zotero-bind-format"
                value={draftMode}
                title="on-demand：插入引用时逐条写入 .bib；full：同步时整分类覆盖 .bib"
                onChange={(e) => setDraftMode(e.target.value as ZoteroSyncMode)}
              >
                <option value="on-demand">按需写入</option>
                <option value="full">全量同步</option>
              </select>
              <button type="button" className="btn primary sm" disabled={formBusy} onClick={() => void addBinding()}>
                保存绑定
              </button>
            </div>
          </div>

          <div className="zotero-bind-list">
            {bindings.length === 0 ? (
              <p className="set-note">
                尚未绑定。装了 Better BibTeX 可在 Zotero 里对该 collection 选「自动导出」并勾选
                <b> Keep updated</b>，导出路径填上面的 .bib；Zetla 会自动监听并重建引用索引。
              </p>
            ) : (
              bindings.map((b, i) => {
                const abs = normalizeBibPath(root, b.bibPath);
                const inside = isPathInsideRoot(root, abs);
                return (
                  <div className="zotero-bind-row" key={`${b.collectionKey}-${b.bibPath}-${i}`}>
                    <div className="zotero-bind-meta">
                      <b>{b.collectionName || "全库"}</b>
                      <span>
                        {b.bibPath}{b.collectionKey ? ` · ${b.collectionKey}` : ""} · {b.format} ·{" "}
                        {b.syncMode === "on-demand" ? "按需写入" : "全量同步"}
                      </span>
                      <em>{inside ? "项目内（可主动同步）" : "项目外（仅监听与索引）"}</em>
                    </div>
                    <div className="zotero-bind-ops">
                      <button
                        type="button"
                        className="btn sm"
                        disabled={formBusy}
                        title="on-demand：插入引用时逐条写入 .bib；full：同步时整分类覆盖 .bib"
                        onClick={() => void toggleMode(b)}
                      >
                        {b.syncMode === "on-demand" ? "切为全量" : "切为按需"}
                      </button>
                      <button type="button" className="btn sm" disabled={syncBusy} onClick={() => void syncOne(b)}>
                        立即同步
                      </button>
                      <button type="button" className="btn sm" disabled={formBusy} onClick={() => void removeBinding(b)}>
                        移除
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="zotero-actions">
            <button type="button" className="btn sm" disabled={syncBusy || bindings.length === 0} onClick={() => void syncAll()}>
              {syncBusy ? "同步中…" : "立即同步全部"}
            </button>
            <span className="zotero-last">{syncSummary(lastSync)}</span>
          </div>
          {note && <div className="zotero-diag zotero-muted"><b>操作结果</b><p>{note}</p></div>}
          {syncError && <div className="zotero-diag zotero-warn"><b>同步提示</b><p>{syncError}</p></div>}
        </>
      )}

      <h4>同步状态</h4>
      <div className="zotero-bind-stats">
        <span>绑定 {bindings.length} 个</span>
        <span>键映射 {keyMap ? Object.keys(keyMap.byCiteKey).length : 0} 条</span>
        <span>未映射 {keyMap?.unmapped.length ?? 0} 个（多为用户手写条目）</span>
        <span>最近变更 {bibChange ? `${bibChange.reason} · ${bibChange.at.slice(11, 19)}` : "无"}</span>
      </div>
      {consistency && (
        <div className={`zotero-diag ${consistency.missing.length ? "zotero-warn" : "zotero-ok"}`}>
          <b>编译前一致性</b>
          <p>
            .bib {consistency.bibCount} 键 / \cite {consistency.citeCount} 键 ·
            缺失 {consistency.missing.length} · 未引用 {consistency.orphaned.length} ·
            重复 {consistency.duplicates.length}
          </p>
          {consistency.missing.length > 0 && (
            <p>缺失 key：{consistency.missing.slice(0, 8).join(", ")}{consistency.missing.length > 8 ? "…" : ""}</p>
          )}
        </div>
      )}

      <p className="set-note">
        自动同步链路：Zotero / BBT 改写 .bib → Rust notify 多路径监听（300ms 防抖 + hash 去重）→
        <code> zotero:bib-changed</code> → 重建引用索引（补全 / 跳转 / 悬浮 / 校验 / 面板）。
        已打开且未保存的 .bib 不会被覆盖。离线或 403 时直接使用磁盘缓存，编译不受影响；
        本期不写回 Zotero 文献库。
      </p>
    </div>
  );
}

export default ZoteroBindingPane;

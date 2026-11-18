// Zotero 联动 · P6 设置页「受管 .bib + 字段级同步」
// 只读 Zotero：所有 HTTP 由 Rust 发出；本组件只做表单与状态展示。
// P6 起不再有「分类绑定 / 全量模式」概念：只有一个受管 .bib 路径 + 启用开关。
// - 缺一条引用 → ensureBibEntries 幂等追加（插一篇写一篇）；
// - Zotero 题录字段变化 → syncZoteroBinding 字段级合并到同 citekey 条目。
import { useEffect, useState } from "react";
import { useProjectStore } from "@/project/useProject";
import {
  DEFAULT_ZOTERO_BINDING,
  type ZoteroBinding,
} from "@/types/zotero";
import {
  persistZoteroBindings,
  syncZoteroBinding,
} from "./zoteroRuntime";
import { isPathInsideRoot, normalizeBibPath, syncSummary } from "./zoteroSync";
import { useZoteroStore } from "./useZoteroStore";

export function ZoteroBindingPane() {
  const root = useProjectStore((s) => s.root);
  const bindings = useZoteroStore((s) => s.bindings);
  const keyMap = useZoteroStore((s) => s.keyMap);
  const lastSync = useZoteroStore((s) => s.lastSync);
  const syncBusy = useZoteroStore((s) => s.syncBusy);
  const syncError = useZoteroStore((s) => s.syncError);
  const consistency = useZoteroStore((s) => s.consistency);
  const bibChange = useZoteroStore((s) => s.bibChange);

  // 单个受管绑定：取第一个；存量多绑定取第一个启用者，保存时收敛为一个
  const binding = bindings.find((b) => b.enabled) ?? bindings[0] ?? null;
  const [draftPath, setDraftPath] = useState(binding?.bibPath ?? DEFAULT_ZOTERO_BINDING.bibPath);
  const [formBusy, setFormBusy] = useState(false);
  const [note, setNote] = useState("");

  // 绑定是异步从 .ltex/config.json 载入的；载入后同步输入框草稿
  useEffect(() => {
    if (binding) setDraftPath(binding.bibPath);
  }, [binding?.bibPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!root) return;
    const bibPath = draftPath.trim() || DEFAULT_ZOTERO_BINDING.bibPath;
    const next: ZoteroBinding = { bibPath, enabled: true };
    const abs = normalizeBibPath(root, bibPath);
    setFormBusy(true);
    setNote("");
    try {
      await persistZoteroBindings([next]);
      setNote(isPathInsideRoot(root, abs)
        ? `已设置受管 .bib：${bibPath}（缺条目自动补写，Zotero 字段变化可同步）`
        : `路径 ${bibPath} 不在项目内：只索引与监听，不会写盘`);
    } catch (e) {
      setNote(`保存失败：${String(e)}`);
    } finally {
      setFormBusy(false);
    }
  };

  const toggleEnabled = async () => {
    if (!binding) {
      await save();
      return;
    }
    setFormBusy(true);
    try {
      const enabled = !binding.enabled;
      await persistZoteroBindings(enabled ? [{ bibPath: binding.bibPath, enabled: true }] : []);
      setDraftPath(binding.bibPath);
      setNote(enabled ? "已启用受管 .bib 同步" : "已停用；项目内 .bib 仍可正常索引与编译");
    } catch (e) {
      setNote(`切换失败：${String(e)}`);
    } finally {
      setFormBusy(false);
    }
  };

  const remove = async () => {
    setFormBusy(true);
    try {
      await persistZoteroBindings([]);
      setDraftPath(DEFAULT_ZOTERO_BINDING.bibPath);
      setNote("已移除受管 .bib 设置");
    } catch (e) {
      setNote(`移除失败：${String(e)}`);
    } finally {
      setFormBusy(false);
    }
  };

  const syncNow = async () => {
    if (!binding) {
      setNote("请先设置受管 .bib 路径并保存");
      return;
    }
    setNote("同步中…");
    const r = await syncZoteroBinding(binding);
    setNote(syncSummary(r));
  };

  const abs = root && binding ? normalizeBibPath(root, binding.bibPath) : "";
  const inside = root && abs ? isPathInsideRoot(root, abs) : false;

  return (
    <div className="zotero-bind-pane">
      <h4>受管 .bib</h4>
      {!root ? (
        <p className="set-note">请先打开一个项目；设置在项目的 <code>.ltex/config.json</code>。</p>
      ) : (
        <>
          <div className="fld">
            <div className="lbl">
              <b>.bib 路径</b>
              <span>相对项目根；Zotero 字段变化会同步到这里的对应条目（citekey 不变）</span>
            </div>
            <div className="zotero-bind-line">
              <input
                className="txt-in zotero-bind-input"
                value={draftPath}
                onChange={(e) => setDraftPath(e.target.value)}
                placeholder="references.bib"
              />
              <button type="button" className="btn primary sm" disabled={formBusy} onClick={() => void save()}>
                保存
              </button>
            </div>
          </div>

          <div className="zotero-bind-list">
            {!binding ? (
              <p className="set-note">尚未设置受管 .bib。不设也能用：插入引用时若项目内没有 .bib 会自动新建 references.bib，缺一条补一条；设置受管 .bib 后可固定写入目标，并在下方「立即同步字段」把 Zotero 改动写回。</p>
            ) : (
              <div className="zotero-bind-row">
                <div className="zotero-bind-meta">
                  <b>{binding.bibPath}</b>
                  <span>{binding.enabled ? "已启用" : "已停用"} · {inside ? "项目内（可写盘）" : "项目外（仅索引）"}</span>
                  <em>{binding.enabled ? "Zotero 字段变化 → 同 citekey 条目字段级合并" : "停用期间不写盘、不同步字段"}</em>
                </div>
                <div className="zotero-bind-ops">
                  <button type="button" className="btn sm" disabled={formBusy} onClick={() => void toggleEnabled()}>
                    {binding.enabled ? "停用" : "启用"}
                  </button>
                  <button type="button" className="btn sm" disabled={syncBusy || !binding.enabled} onClick={() => void syncNow()}>
                    {syncBusy ? "同步中…" : "立即同步字段"}
                  </button>
                  <button type="button" className="btn sm" disabled={formBusy} onClick={() => void remove()}>
                    移除
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="zotero-actions">
            <span className="zotero-last">{syncSummary(lastSync)}</span>
          </div>
          {note && <div className="zotero-diag zotero-muted"><b>操作结果</b><p>{note}</p></div>}
          {syncError && <div className="zotero-diag zotero-warn"><b>同步提示</b><p>{syncError}</p></div>}
        </>
      )}

      <h4>同步状态</h4>
      <div className="zotero-bind-stats">
        <span>受管 .bib {binding ? 1 : 0} 个</span>
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
        同步规则：Zotero 题录的非空字段（标题 / 作者 / 年份 / 期刊 / DOI / URL / 摘要）覆盖项目 .bib 中同 citekey 条目的同名字段；
        .bib 独有字段（手写 note / eprint 等）与 citekey 保持不动。缺条目时在插入引用或编译前幂等补写。
        已打开且未保存的 .bib 不写盘；离线或 403 时编译照常。
      </p>
    </div>
  );
}

export default ZoteroBindingPane;

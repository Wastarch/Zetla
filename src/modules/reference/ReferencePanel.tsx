// M1-14f · 引用管理面板（纯前端，零 Rust 改动）—— 见 docs/开发计划.md M1-14f
// 活动栏「引用」视图：校验汇总条 + 搜索 + 按 .bib 文件分组的条目列表 + 导入 .bib。
// M1-14g+：条目左键 → 浮窗预览（只读）；右键菜单 → 插入 \cite / 跳到条目 / 查看反向引用。
// 所有数据只读 useReferenceStore 缓存（entries/byKey/duplicateKeys/citations），不重解、不重读盘。
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useReferenceStore } from "./useReferenceStore";
import { useProjectStore, notify } from "@/project/useProject";
import { projectApi } from "@/ipc/invoke";
import { jumpToFile } from "@/editor/jump";
import { insertSnippet } from "@/core/moduleRegistry";
import {
  openZoteroItem,
  resolveZoteroCitation,
  resolveZoteroPdfPreview,
} from "@/modules/zotero/zoteroReverseRuntime";
import { ensureBibEntries } from "@/modules/zotero/zoteroRuntime";
import type { ZoteroItem } from "@/types/zotero";
import {
  citationCopyMessage,
  citationCopyText,
  normalizeCslStyle,
} from "@/modules/zotero/zoteroCitation";
import {
  targetDisabled,
  targetHint,
  type ZoteroOpenTarget,
} from "@/modules/zotero/zoteroOpenTargets";
import { planStyleSwitch, type StyleSwitchPlan } from "@/modules/zotero/zoteroStyleMap";
import { applyStyleSwitch, readTexForEdit } from "@/modules/zotero/zoteroStyleApply";
import { ZoteroLibraryPane } from "@/modules/zotero/ZoteroLibraryPane";
import { ZoteroIntegrityPane } from "@/modules/zotero/ZoteroIntegrityPane";
import { useSettingsStore } from "@/core/settings";
import { InsertCtxMenu, type CtxAction } from "@/ui/InsertCtxMenu";
import { firstDuplicateEntry, type MissingCiteSummary } from "./lintLogic";
import { RefPreviewCard, type RefPreviewMode } from "./RefPreviewCard";
import { ZoteroOpenSplit } from "./ZoteroOpenSplit";
import { ZoteroPdfPreviewDialog } from "./ZoteroPdfPreviewDialog";
import { ZoteroStyleApplyDialog } from "./ZoteroStyleApplyDialog";
import type { BibEntry } from "./bibParser";

/** 浮窗尺寸估算（用于定位 clamp，实际宽高由 CSS 决定） */
const PREVIEW_W = 340;
const PREVIEW_H_EST = 300;

/** 以条目矩形为锚点计算浮窗位置：优先右侧，空间不足翻左侧，并 clamp 到视口内 */
function previewPos(rect: DOMRect): { left: number; top: number } {
  let left = rect.right + 8;
  if (left + PREVIEW_W > window.innerWidth - 8) left = rect.left - PREVIEW_W - 8;
  if (left < 8) left = 8;
  let top = rect.top;
  if (top + PREVIEW_H_EST > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - PREVIEW_H_EST - 8);
  }
  return { left, top };
}

/** P3-1b：同一条目判定（右键菜单与卡片布下拉时共用，避免串到别的条目） */
function sameBibEntry(a: BibEntry, b: BibEntry): boolean {
  return a.file === b.file && a.line === b.line && a.key === b.key;
}

/** P3-1b：打开目标下拉三项；primary 项 = 主按钮默认动作（打开全文） */
function zoteroOpenActions(
  entry: BibEntry,
  run: (target: ZoteroOpenTarget) => void,
): CtxAction[] {
  return [
    {
      label: "打开 PDF 全文",
      primary: true,
      hint: targetHint("pdf", entry.fields),
      onClick: () => run("pdf"),
    },
    {
      label: "在 Zotero 中打开条目",
      hint: targetHint("item", entry.fields),
      onClick: () => run("item"),
    },
    {
      label: "论文网页（DOI/URL）",
      hint: targetHint("web", entry.fields),
      disabled: targetDisabled("web", entry.fields),
      onClick: () => run("web"),
    },
  ];
}

export default function ReferencePanel() {
  const entries = useReferenceStore((s) => s.entries);
  const byKey = useReferenceStore((s) => s.byKey);
  const duplicateKeys = useReferenceStore((s) => s.duplicateKeys);
  const citesByKey = useReferenceStore((s) => s.citesByKey);
  const citations = useReferenceStore((s) => s.citations);

  const [q, setQ] = useState("");
  /** P3-5 / P3-6：面板视图（项目文献 / Zotero 文献库 / 体检） */
  const [view, setView] = useState<"project" | "library" | "diagnostics">("project");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** 手动刷新中（重扫项目 + 重建索引） */
  const [refreshing, setRefreshing] = useState(false);
  /** P3-1：反向跳转进行中（禁用重复点击，避免并发搜索） */
  const [zoteroBusy, setZoteroBusy] = useState(false);
  /** P3-2：内嵌 PDF 读取中 */
  const [pdfBusy, setPdfBusy] = useState(false);
  /** P3-2：Zotero 附件 PDF 内嵌预览（本地路径由 Rust 只读解析） */
  const [zoteroPdf, setZoteroPdf] = useState<{
    path: string;
    filename: string;
  } | null>(null);
  /** P3-1b：打开目标下拉（放在菜单/卡片外部；menu 来源可与父右键菜单共存） */
  const [openMenu, setOpenMenu] = useState<{
    x: number;
    y: number;
    entry: BibEntry;
    source: "menu" | "card";
  } | null>(null);
  /** 右键菜单：命中的条目、屏幕坐标、以及「查看反向引用」用的浮窗锚点 */
  const [menu, setMenu] = useState<{
    entry: BibEntry;
    x: number;
    y: number;
    pos: { left: number; top: number };
  } | null>(null);
  /** 左键浮窗预览（info 预览 / refs 反向引用 / cite CSL 引文） */
  const [preview, setPreview] = useState<{
    entry: BibEntry;
    mode: RefPreviewMode;
    left: number;
    top: number;
  } | null>(null);

  /** P3-3：CSL 样式（初值取设置里的 zotero.cslStyle，切换后旁路落盘记住） */
  const [citeStyle, setCiteStyle] = useState(() =>
    normalizeCslStyle(useSettingsStore.getState().settings.zotero?.cslStyle),
  );
  /** P3-3：引文预览状态（只放内存；失败只提示，不阻断编辑与编译） */
  const [cite, setCite] = useState<{
    loading: boolean;
    error: string | null;
    bib: string;
    citation: string;
  }>({ loading: false, error: null, bib: "", citation: "" });

  /** P3-4：导言区样式切换确认弹窗（先预览 diff，确认后才落笔） */
  const [styleApply, setStyleApply] = useState<{
    path: string;
    file: string;
    plan: StyleSwitchPlan;
  } | null>(null);
  const [styleBusy, setStyleBusy] = useState(false);

  // 右键菜单：点击空白/滚动/Esc 关闭；同时收起由它唤起的下拉（卡片下拉不受影响）
  useEffect(() => {
    if (!menu) return;
    const close = () => {
      setMenu(null);
      setOpenMenu((prev) => (prev?.source === "menu" ? null : prev));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  // 浮窗预览：点击浮窗/条目之外、Esc、滚动（浮窗内部滚动除外）关闭
  useEffect(() => {
    if (!preview) return;
    const onPointerDown = (ev: PointerEvent) => {
      const t = ev.target as HTMLElement | null;
      // P3-1b：点打开目标下拉时不收起卡片（下拉由本组件在外层渲染）
      if (
        t &&
        (t.closest(".ref-preview") ||
          t.closest(".ref-entry") ||
          t.closest(".zo-menu-layer") ||
          t.closest(".zo-style-layer") ||
          t.closest(".zo-pdf-layer"))
      )
        return;
      setPreview(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(null);
    };
    const onScroll = (ev: Event) => {
      const t = ev.target as HTMLElement | null;
      if (t && t.closest && t.closest(".ref-preview")) return;
      setPreview(null);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [preview]);

  /** 左键：打开/切换浮窗预览（再点同一条目收起） */
  const onRowClick = useCallback((e: BibEntry, ev: ReactMouseEvent<HTMLButtonElement>) => {
    const id = `${e.file}:${e.line}`;
    // 先同步取锚点坐标：setState updater 可能延迟执行，届时 ev.currentTarget 已为 null
    const pos = previewPos(ev.currentTarget.getBoundingClientRect());
    setPreview((prev) => {
      if (prev && `${prev.entry.file}:${prev.entry.line}` === id) {
        // 同一条目：info 再点收起；refs 则切回 info
        return prev.mode === "info" ? null : { ...prev, mode: "info" };
      }
      return { entry: e, mode: "info", ...pos };
    });
  }, []);

  /** 右键/文献库：在光标处插入 \cite{key}；P4 按需绑定先补缺失条目（插一篇写一篇） */
  const onInsert = useCallback(async (key: string, item?: ZoteroItem) => {
    if (item) {
      try {
        const r = await ensureBibEntries([{ citeKey: key, item }]);
        if (r.written > 0) notify(r.message, "ok");
        else if (r.unknown.length > 0) notify(`${r.unknown[0]} 未能写入：${r.message}`, "err");
      } catch {
        /* 写入失败不阻断插入 */
      }
    }
    if (!insertSnippet(`\\cite{${key}}`)) {
      notify("请先打开一个 .tex 编辑器并定位光标", "err");
    }
  }, []);

  /** P3-1b：按目标打开（pdf 默认 / item / web）；只读，失败只给 toast，不影响编辑与编译 */
  const runZoteroOpen = useCallback(async (e: BibEntry, target: ZoteroOpenTarget) => {
    setZoteroBusy(true);
    try {
      const r = await openZoteroItem(
        {
          key: e.key,
          title: e.title,
          doi: e.fields?.doi,
          author: e.author,
          year: e.year,
          fields: e.fields ?? null,
        },
        target,
      );
      notify(r.message, r.ok ? "ok" : "err");
    } catch (err) {
      notify(`打开失败：${String(err)}`, "err");
    } finally {
      setZoteroBusy(false);
    }
  }, []);

  /** P3-2：安全 http(s) 链接交给 opener（非 http(s) 已在纯逻辑层被拒绝） */
  const onOpenPreviewUrl = useCallback(async (url: string) => {
    try {
      await openUrl(url);
    } catch (err) {
      notify(`打开网页失败：${String(err)}`, "err");
    }
  }, []);

  /** P3-2：读取 Zotero PDF 附件本地路径并打开 Zetla 内嵌预览；失败只给 toast */
  const onPreviewZoteroPdf = useCallback(async (e: BibEntry) => {
    setPdfBusy(true);
    try {
      const r = await resolveZoteroPdfPreview({
        key: e.key,
        title: e.title,
        doi: e.fields?.doi,
        author: e.author,
        year: e.year,
        fields: e.fields ?? null,
      });
      if (!r.ok || !r.path) {
        notify(r.message, "err");
        return;
      }
      setZoteroPdf({ path: r.path, filename: r.filename ?? `${e.key}.pdf` });
    } catch (err) {
      notify(`预览 PDF 失败：${String(err)}`, "err");
    } finally {
      setPdfBusy(false);
    }
  }, []);

  /** P3-3：切到「引文」页签 / 换样式时拉取 CSL 引文（只读；离开页签即作废，避免串条目） */
  useEffect(() => {
    if (!preview || preview.mode !== "cite") return;
    const entry = preview.entry;
    let alive = true;
    setCite((c) => ({ ...c, loading: true, error: null }));
    void resolveZoteroCitation(
      {
        key: entry.key,
        title: entry.title,
        doi: entry.fields?.doi,
        author: entry.author,
        year: entry.year,
        fields: entry.fields ?? null,
      },
      citeStyle,
    ).then((r) => {
      if (!alive) return;
      setCite({
        loading: false,
        error: r.ok ? null : r.message,
        bib: r.bib,
        citation: r.citation,
      });
    });
    return () => {
      alive = false;
    };
  }, [preview, citeStyle]);

  /** P3-3：切换 CSL 样式；运行时立即生效并旁路落盘（只写 Zetla 自己的配置） */
  const onCiteStyleChange = useCallback((id: string) => {
    const next = normalizeCslStyle(id);
    setCiteStyle(next);
    const st = useSettingsStore.getState();
    const cur = st.settings.zotero;
    if (!cur || cur.cslStyle === next) return;
    const zotero = { ...cur, cslStyle: next };
    st.setSettings({ ...st.settings, zotero });
    void st.persist({ zotero });
  }, []);

  /** P3-3：复制引文 / 参考文献（只写系统剪贴板，不碰任何文件） */
  const onCopyCitation = useCallback(
    async (kind: "citation" | "bib") => {
      const text = citationCopyText(kind === "citation" ? cite.citation : cite.bib);
      if (!text) {
        notify("暂无可复制的引文，请等待加载完成或换一个样式", "err");
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        notify(citationCopyMessage(kind, citeStyle), "ok");
      } catch (e) {
        notify(`复制失败：${String(e)}`, "err");
      }
    },
    [cite, citeStyle],
  );

  /** P3-4：点「应用到导言区」——先读主文档现状并算最小补丁，再弹确认窗（此时不改文件） */
  const onApplyPreamble = useCallback(async () => {
    const main = useProjectStore.getState().tree?.mainFile;
    if (!main) {
      notify("未识别主文件，无法修改导言区", "err");
      return;
    }
    try {
      const { tex } = await readTexForEdit(main);
      const plan = planStyleSwitch(tex, citeStyle);
      if (!plan.ok) {
        notify(plan.message, "err");
        return;
      }
      if (plan.noop) {
        notify(plan.message);
        return;
      }
      setStyleApply({ path: main, file: main.split(/[\\/]/).pop() ?? main, plan });
    } catch (e) {
      notify(`读取主文档失败：${String(e)}`, "err");
    }
  }, [citeStyle]);

  /** P3-4：确认后落笔。写入前重读重算，避免预览到确认之间导言区被改导致偏移错位 */
  const onConfirmStyleApply = useCallback(async () => {
    if (!styleApply) return;
    setStyleBusy(true);
    try {
      const r = await applyStyleSwitch(styleApply.path, citeStyle);
      notify(r.message, r.ok ? "ok" : "err");
      if (r.ok) setStyleApply(null);
    } catch (e) {
      notify(`写入导言区失败：${String(e)}`, "err");
    } finally {
      setStyleBusy(false);
    }
  }, [styleApply, citeStyle]);

  // 重复 key 汇总（store 直接可得，无需读盘）
  const dupSummary = useMemo(() => {
    return {
      count: duplicateKeys.size,
      first: firstDuplicateEntry(entries, duplicateKeys),
    };
  }, [entries, duplicateKeys]);

  // 缺失引用汇总：直接从 store 的 citation 索引推导（不重读盘、不重扫）
  const missing = useMemo<MissingCiteSummary>(() => {
    const known = new Set(byKey.keys());
    let count = 0;
    let first: { file: string; line: number } | null = null;
    // 依文件+行号排序，保证「首个」稳定（citations 顺序取决于树遍历）
    const sorted = [...citations].sort((a, b) =>
      a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1,
    );
    for (const c of sorted) {
      if (known.has(c.key)) continue;
      count++;
      if (!first) first = { file: c.file, line: c.line };
    }
    return { count, first };
  }, [citations, byKey]);

  // 分组：按 .bib 文件
  const groups = useMemo(() => {
    const map = new Map<string, BibEntry[]>();
    for (const e of entries) {
      const arr = map.get(e.file) ?? [];
      arr.push(e);
      map.set(e.file, arr);
    }
    return [...map.entries()];
  }, [entries]);

  // 搜索过滤（key / author / title）
  const query = q.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!query) return groups;
    return groups
      .map(([file, es]) => {
        const fes = es.filter(
          (e) =>
            e.key.toLowerCase().includes(query) ||
            (e.author ?? "").toLowerCase().includes(query) ||
            (e.title ?? "").toLowerCase().includes(query),
        );
        return [file, fes] as [string, BibEntry[]];
      })
      .filter(([, es]) => es.length > 0);
  }, [groups, query]);

  // 导入 .bib（仅文件导入：选本地 .bib → 拷进项目根）
  const onImport = useCallback(async () => {
    const r = useProjectStore.getState().root;
    if (!r) {
      notify("请先打开项目", "err");
      return;
    }
    try {
      const picked = await openFileDialog({
        multiple: false,
        filters: [{ name: "BibTeX", extensions: ["bib"] }],
      });
      if (typeof picked !== "string") return; // 取消
      const base = picked.split(/[\\/]/).pop() ?? "reference.bib";
      const sep = r.includes("\\") ? "\\" : "/";
      const target = r.endsWith(sep) ? r + base : r + sep + base;
      const t = useProjectStore.getState().tree;
      const exists = t?.nodes.some(
        (n) => n.type === "file" && n.path.toLowerCase() === target.toLowerCase(),
      );
      if (exists) {
        notify(`项目根已存在 ${base}，未覆盖`, "err");
        return;
      }
      await projectApi.copyEntry(picked, target);
      notify(`已导入 ${base}，请在 \\addbibresource 中引用`);
      void useReferenceStore.getState().reindex();
    } catch (e) {
      notify(`导入失败：${String(e)}`, "err");
    }
  }, []);

  const toggleGroup = (file: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  };

  /** 手动刷新：重新扫描项目目录 + 重建引用索引（检测新增/改名/外部改动的 .bib / .tex） */
  const onRefresh = useCallback(async () => {
    const { root } = useProjectStore.getState();
    if (!root) {
      notify("请先打开项目", "err");
      return;
    }
    setRefreshing(true);
    try {
      // 1) 重扫目录，确保新增/改名/外部加入的 .bib 进入项目树
      const tree = await projectApi.scanProject(root);
      useProjectStore.setState({ tree });
      // 2) 清反向引用缓存并重索引（重读全部 .tex / .bib，已打开走 buffer）
      useReferenceStore.getState().invalidateCitations();
      await useReferenceStore.getState().reindex();
      const n = useReferenceStore.getState().entries.length;
      notify(`已重新扫描项目内 .bib 文献，共 ${n} 条`);
    } catch (e) {
      notify(`刷新失败：${String(e)}`, "err");
    } finally {
      setRefreshing(false);
    }
  }, []);

  const allClear = dupSummary.count === 0 && missing.count === 0;

  return (
    <div className="ref-panel">
      {/* P3-5 / P3-6：页签（项目文献 / Zotero 文献库 / 体检） */}
      <div className="ref-tabs" role="tablist">
        {(
          [
            ["project", "项目文献"],
            ["library", "Zotero 文献库"],
            ["diagnostics", "体检"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={view === id ? "ref-tab ref-tab-on" : "ref-tab"}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "project" ? (
        <>
          {/* 校验汇总条（M1-14e 缓过来的项目级聚合） */}
          <div className="ref-summary">
            {allClear ? (
              <div className="ref-ok">✓ 引用无误</div>
            ) : (
              <>
                <button
                  type="button"
                  className="ref-pill ref-pill-warn"
                  disabled={dupSummary.count === 0}
                  title="点击跳到首个重复 key"
                  onClick={() =>
                    dupSummary.first && jumpToFile(dupSummary.first.file, dupSummary.first.line)
                  }
                >
                  ⚠ 重复 key {dupSummary.count} 处
                </button>
                <button
                  type="button"
                  className="ref-pill ref-pill-err"
                  disabled={missing.count === 0}
                  title="点击跳到首个缺失引用"
                  onClick={() =>
                    missing.first && jumpToFile(missing.first.file, missing.first.line)
                  }
                >
                  ❌ 缺失引用 {missing.count} 处
                </button>
              </>
            )}
          </div>

          {/* 操作区：搜索 + 导入 */}
          <div className="ref-actions">
            <input
              className="ref-search"
              placeholder="搜索 key / 作者 / 标题"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button
              type="button"
              className="ref-import"
              onClick={() => void onRefresh()}
              disabled={refreshing}
              title="重新扫描项目内 .bib 文献"
            >
              {refreshing ? "刷新中…" : "↻ 刷新"}
            </button>
            <button type="button" className="ref-import" onClick={() => void onImport()}>
              + 导入…
            </button>
          </div>

          {/* 分组列表 */}
          <div className="ref-list">
            {filteredGroups.length === 0 ? (
              <div className="ref-empty">
                {entries.length === 0 ? "项目中未发现 .bib 文献" : "无匹配条目"}
              </div>
            ) : (
              filteredGroups.map(([file, es]) => {
                const isCollapsed = collapsed.has(file);
                return (
                  <div className="ref-group" key={file}>
                    <button
                      type="button"
                      className="ref-group-head"
                      onClick={() => toggleGroup(file)}
                      title={file}
                    >
                      <span className={isCollapsed ? "ref-caret" : "ref-caret open"}>▾</span>
                      <span className="ref-group-name">{file.split(/[\\/]/).pop()}</span>
                      <span className="ref-group-count">{es.length}</span>
                    </button>
                    {!isCollapsed &&
                      es.map((e) => {
                        const dup = duplicateKeys.has(e.key);
                        const refCount = (citesByKey.get(e.key) ?? []).length;
                        return (
                          <div className="ref-entry-wrap" key={`${e.file}:${e.line}`}>
                            <button
                              type="button"
                              className={dup ? "ref-entry ref-entry-dup" : "ref-entry"}
                              title={`${e.key} · @${e.type} · 点击预览；右键更多`}
                              onClick={(ev) => onRowClick(e, ev)}
                              onContextMenu={(ev) => {
                                ev.preventDefault();
                                setPreview(null);
                                setMenu({
                                  entry: e,
                                  x: ev.clientX,
                                  y: ev.clientY,
                                  pos: previewPos(ev.currentTarget.getBoundingClientRect()),
                                });
                              }}
                            >
                              {dup && (
                                <span className="ref-dup-dot" title="重复 key">
                                  ●
                                </span>
                              )}
                              <span className="ref-key">{e.key}</span>
                              <span className="ref-meta">
                                {(e.author ?? "—") + (e.year ? ` (${e.year})` : "")}
                              </span>
                              {refCount > 0 && (
                                <span className="ref-cite-count" title={`被引用 ${refCount} 次`}>
                                  {refCount}
                                </span>
                              )}
                              <span className="ref-type">@{e.type}</span>
                            </button>
                          </div>
                        );
                      })}
                  </div>
                );
              })
            )}
          </div>

          {/* 右键菜单：在光标处插入 / 跳到条目 / 查看反向引用 */}
          {menu && (
            <div
              className="ctx-menu"
              style={{ left: menu.x, top: menu.y }}
              onClick={(ev) => ev.stopPropagation()}
            >
              <button
                type="button"
                className="ctx-item"
                onClick={() => {
                  void onInsert(menu.entry.key);
                  setMenu(null);
                }}
              >
                {`在光标处插入 \\cite{${menu.entry.key}}`}
              </button>
              <button
                type="button"
                className="ctx-item"
                onClick={() => {
                  jumpToFile(menu.entry.file, menu.entry.line);
                  setMenu(null);
                }}
              >
                跳到条目
              </button>
              <ZoteroOpenSplit
                variant="menu"
                busy={zoteroBusy}
                menuOpen={
                  !!openMenu &&
                  openMenu.source === "menu" &&
                  sameBibEntry(openMenu.entry, menu.entry)
                }
                onRun={(target) => {
                  void runZoteroOpen(menu.entry, target);
                  setMenu(null);
                  setOpenMenu((prev) => (prev?.source === "menu" ? null : prev));
                }}
                onOpenMenu={(pos) => {
                  // 用户改主意：点 ▾ 时父右键菜单保持显示，下拉作为子菜单浮在其上；再点 ▾ 只收起下拉
                  setOpenMenu((prev) =>
                    prev?.source === "menu" && sameBibEntry(prev.entry, menu.entry)
                      ? null
                      : { ...pos, entry: menu.entry, source: "menu" },
                  );
                }}
              />
              <button
                type="button"
                className="ctx-item"
                onClick={() => {
                  setPreview({ entry: menu.entry, mode: "refs", ...menu.pos });
                  setMenu(null);
                }}
              >
                查看反向引用
              </button>
            </div>
          )}

          {/* 左键浮窗：预览信息 / 反向引用 */}
          {preview && (
            <RefPreviewCard
              entry={preview.entry}
              refs={citesByKey.get(preview.entry.key) ?? []}
              mode={preview.mode}
              left={preview.left}
              top={preview.top}
              onMode={(m) => setPreview((p) => (p ? { ...p, mode: m } : p))}
              onClose={() => setPreview(null)}
              onJump={(file, line) => {
                jumpToFile(file, line);
                setPreview(null);
              }}
              onRun={(target) => void runZoteroOpen(preview.entry, target)}
              onOpenUrl={(url) => void onOpenPreviewUrl(url)}
              onPreviewPdf={() => void onPreviewZoteroPdf(preview.entry)}
              pdfBusy={pdfBusy}
              cite={{ ...cite, style: citeStyle }}
              onCiteStyle={onCiteStyleChange}
              onCopyCitation={(kind) => void onCopyCitation(kind)}
              onApplyPreamble={() => void onApplyPreamble()}
              onOpenMenu={(pos) =>
                setOpenMenu((prev) =>
                  prev?.source === "card" && sameBibEntry(prev.entry, preview.entry)
                    ? null
                    : { ...pos, entry: preview.entry, source: "card" },
                )
              }
              menuOpen={
                !!openMenu &&
                openMenu.source === "card" &&
                sameBibEntry(openMenu.entry, preview.entry)
              }
              busy={zoteroBusy}
            />
          )}

          {/* P3-1b：打开目标下拉（编译 ▾ 同款 InsertCtxMenu；menu 来源时与父右键菜单共存，层级更高） */}
          {openMenu && (
            <div className="zo-menu-layer">
              <InsertCtxMenu
                x={openMenu.x}
                y={openMenu.y}
                onClose={() => setOpenMenu(null)}
                actions={zoteroOpenActions(openMenu.entry, (t) => {
                  setOpenMenu(null);
                  setMenu(null);
                  void runZoteroOpen(openMenu.entry, t);
                })}
              />
            </div>
          )}
        </>
      ) : view === "library" ? (
        <ZoteroLibraryPane
          onInsert={onInsert}
          onNotice={(m, k) => notify(m, k)}
        />
      ) : (
        <ZoteroIntegrityPane
          onJump={(file, line) => jumpToFile(file, line)}
          onNotice={(m, k) => notify(m, k)}
        />
      )}

      {/* P3-2：Zotero 附件 PDF 内嵌预览（独立于全局预览 store，不触碰编译结果） */}
      {zoteroPdf && (
        <ZoteroPdfPreviewDialog
          path={zoteroPdf.path}
          filename={zoteroPdf.filename}
          onClose={() => setZoteroPdf(null)}
        />
      )}

      {/* P3-4：样式映射落到导言区前的确认窗（只改一处，可撤销，不自动重编译） */}
      {styleApply && (
        <ZoteroStyleApplyDialog
          fileName={styleApply.file}
          engine={styleApply.plan.engine ?? "none"}
          styleLabel={styleApply.plan.mapping?.label ?? citeStyle}
          target={styleApply.plan.target ?? ""}
          line={styleApply.plan.line}
          before={styleApply.plan.before}
          after={styleApply.plan.after}
          note={styleApply.plan.mapping?.note}
          busy={styleBusy}
          onConfirm={() => void onConfirmStyleApply()}
          onClose={() => {
            if (!styleBusy) setStyleApply(null);
          }}
        />
      )}
    </div>
  );
}

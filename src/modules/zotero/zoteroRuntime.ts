// Zotero 联动 · P1 运行时编排（模块级单例）
//
// 与 P0 的 useZoteroStore 单例运行时分工：那边只管「连接自检 / 状态灯 / 轮询」，
// 这里管「绑定加载 / 多路径监听 / .bib 变更 → 重建引用索引 / 主动同步 / 编译前校验」。
// 设计要点：
// 1) 所有失败一律吞掉并写进 store，**绝不阻断编译**，Zotero 没开时磁盘 .bib 照常用；
// 2) 脏缓冲优先：有未保存改动的 .bib 不写盘、不重载，只提示；
// 3) 自身写盘由 Rust 侧 hash 抑制，这里 reason="sync" 不再重复 reindex；
// 4) StrictMode 假卸载 —— 运行时做成模块级单例，只用 import.meta.hot.dispose 清理。
import { useAppStore } from "@/core/store";
import { useSettingsStore } from "@/core/settings";
import { useBuffersStore } from "@/editor/useBuffers";
import { onKernelEvent, RustEvents } from "@/ipc/events";
import { zoteroApi } from "@/ipc/invoke";
import { useReferenceStore } from "@/modules/reference/useReferenceStore";
import { useProjectStore } from "@/project/useProject";
import {
  DEFAULT_ZOTERO_SETTINGS,
  type ZoteroBibChanged,
  type ZoteroBinding,
  type ZoteroCollection,
  type ZoteroKeyMap,
  type ZoteroSyncRecord,
} from "@/types/zotero";
import {
  BIB_DEBOUNCE_MS,
  bibKeysFromText,
  buildKeyMap,
  checkBibConsistency,
  consistencySummary,
  isNewChange,
  isPathInsideRoot,
  itemsToBibtex,
  normalizeBibPath,
  parseCollections,
  parseItemKeyNotes,
  parseZoteroItems,
  pathKey,
  planKeyMigration,
  shouldPull,
  type KeyMigration,
} from "./zoteroSync";
import { useZoteroStore } from "./useZoteroStore";

// ── 模块级状态（单例） ────────────────────────────────────────
let installed = false;
let unlistenBib: (() => void) | null = null;
let unsubscribeProject: (() => void) | null = null;
let unsubscribeSettings: (() => void) | null = null;
let reindexTimer: number | undefined;
let lastHandled: Pick<ZoteroBibChanged, "path" | "hash"> | null = null;
let lastRoot: string | null = null;

function cfg() {
  return useSettingsStore.getState().settings.zotero ?? DEFAULT_ZOTERO_SETTINGS;
}

function zstore() {
  return useZoteroStore.getState();
}

/** 当前绑定对应的绝对路径（P1-2：可能在项目树外，BBT Keep updated 常导出到外部） */
export function boundBibPaths(): string[] {
  const root = useProjectStore.getState().root;
  if (!root) return [];
  return zstore()
    .bindings.filter((b) => b.bibPath.trim())
    .map((b) => normalizeBibPath(root, b.bibPath));
}

function isDirtyBib(absPath: string): boolean {
  const key = pathKey(absPath);
  const b = useBuffersStore
    .getState()
    .buffers.find((x) => pathKey(x.path) === key);
  return !!b && b.kind === "text" && b.content !== b.savedContent;
}

async function reindexNow(): Promise<void> {
  const st = useReferenceStore.getState();
  st.invalidateCitations();
  await st.reindex();
}

// ── 绑定 / 映射 / watcher 生命周期 ────────────────────────────
export async function reloadZoteroBindings(root: string | null): Promise<void> {
  lastRoot = root;
  const st = zstore();
  if (!root) {
    st.setBindings([]);
    st.setKeyMap(null);
    st.setConsistency(null);
    useReferenceStore.getState().setExternalBibPaths([]);
    await zoteroApi.unwatchBibs().catch(() => {});
    return;
  }
  let bindings: ZoteroBinding[] = [];
  try {
    bindings = await zoteroApi.getBindings(root);
  } catch {
    // 旧项目 / 配置损坏按「无绑定」处理，不报错
  }
  st.setBindings(bindings);

  // P1-6：映射缓存（坏 JSON 一律忽略，不阻断）
  try {
    const raw = await zoteroApi.loadMap(root);
    if (raw) {
      const parsed = JSON.parse(raw) as ZoteroKeyMap;
      if (parsed && typeof parsed.byCiteKey === "object") st.setKeyMap(parsed);
    }
  } catch {
    /* 缓存损坏：下一轮同步会重建 */
  }

  // P1-2：外部 .bib 纳入索引白名单（项目内路径也会被去重）
  useReferenceStore.getState().setExternalBibPaths(boundBibPaths());
  await restartBibWatcher();
  await reindexNow();
}

async function restartBibWatcher(): Promise<void> {
  const c = cfg();
  const root = useProjectStore.getState().root;
  if (!c.enabled || !c.autoSync || !root) {
    await zoteroApi.unwatchBibs().catch(() => {});
    return;
  }
  const paths = boundBibPaths();
  try {
    await zoteroApi.watchBibs(paths);
  } catch {
    // watcher 失败不影响索引：项目树 watcher 与手动刷新仍可用
  }
}

/** UI：保存绑定（写 .ltex/config.json 的 zoteroBindings，保留其它键） */
export async function persistZoteroBindings(list: ZoteroBinding[]): Promise<void> {
  const root = useProjectStore.getState().root;
  if (!root) throw new Error("请先打开项目");
  await zoteroApi.setBindings(root, list);
  zstore().setBindings(list);
  useReferenceStore.getState().setExternalBibPaths(boundBibPaths());
  await restartBibWatcher();
  await reindexNow();
}

/** UI：拉分类列表（失败返回空数组，由调用方显示提示） */
export async function fetchZoteroCollections(port: number): Promise<ZoteroCollection[]> {
  const raw = await zoteroApi.fetchCollections(port);
  return parseCollections(raw);
}

// ── .bib 变更事件链 ──────────────────────────────────────────
function handleBibChanged(e: ZoteroBibChanged): void {
  if (!e || typeof e.path !== "string" || typeof e.hash !== "string") return;
  if (!isNewChange(lastHandled, e)) return; // 双通道 / 重复挂载去重
  lastHandled = { path: e.path, hash: e.hash };
  zstore().noteBibChange({ path: e.path, hash: e.hash, reason: e.reason });

  // 主动同步写盘：编排里已 reindex，这里只记状态，避免重复重扫
  if (e.reason === "sync") return;
  const tracked = boundBibPaths();
  if (!tracked.some((p) => pathKey(p) === pathKey(e.path))) return;

  if (reindexTimer !== undefined) window.clearTimeout(reindexTimer);
  reindexTimer = window.setTimeout(() => {
    reindexTimer = undefined;
    void (async () => {
      const st = zstore();
      if (isDirtyBib(e.path)) {
        // P1-5：脏缓冲不覆盖；reindex 已优先读缓冲内容，故索引也不会被外部内容冲掉
        st.setSyncError(
          `检测到 ${e.path.split(/[\\/]/).pop()} 外部更新，但编辑器中有未保存改动；已保留缓冲内容，保存后请手动刷新`,
        );
      } else {
        st.setSyncError(null);
        try {
          // Rust 事件路径与项目树/缓冲路径写法可能不同（反斜杠、正斜杠、verbatim 前缀），
          // 而 revertBuffer 内部是精确字符串匹配；先按规范化路径找到缓冲，再用它自己的 path 重载。
          const evKey = pathKey(e.path);
          const opened = useBuffersStore
            .getState()
            .buffers.find((b) => b.kind === "text" && pathKey(b.path) === evKey);
          if (opened) await useBuffersStore.getState().revertBuffer(opened.path);
        } catch {
          /* 文件可能正在被 BBT 重写，下一轮事件会再来 */
        }
      }
      try {
        await reindexNow();
      } catch {
        /* 不阻断 */
      }
    })();
  }, BIB_DEBOUNCE_MS);
}

// ── 主动同步（P1-8 BBT pull export / P1-9 无 BBT 降级） ────────
function skipped(message: string, bibPath: string): ZoteroSyncRecord {
  return {
    at: new Date().toISOString(),
    ok: false,
    source: "skipped",
    written: false,
    hash: "",
    entryCount: 0,
    mappedCount: 0,
    message,
    bibPath,
  };
}

/** 早退也算一次「已尝试」，写入 store 让设置页能看到原因 */
function skip(message: string, bibPath: string): ZoteroSyncRecord {
  const rec = skipped(message, bibPath);
  zstore().setLastSync(rec);
  return rec;
}

/**
 * 同步一条绑定。三条降级路径：
 * - 离线 / 关闭联动 → 跳过，磁盘缓存 .bib 照常可用（编译不阻断）；
 * - BBT 在线 → pull export 拿 BibTeX；同时拉 items JSON 建键映射；
 * - 无 BBT → 本地 API items JSON → Zetla 生成稳定 citekey 的 BibTeX。
 * 外部 .bib（项目根外）只监听不写盘，交由 BBT Keep updated 维护。
 */
export async function syncZoteroBinding(binding: ZoteroBinding): Promise<ZoteroSyncRecord> {
  const root = useProjectStore.getState().root;
  const health = zstore().health;
  const now = new Date().toISOString();
  const abs = root ? normalizeBibPath(root, binding.bibPath) : binding.bibPath;
  if (!root) return skip("未打开项目", abs);
  const c = cfg();
  if (!c.enabled) return skip("Zotero 联动未启用", abs);
  if (!health || health.state !== "connected") return skip("Zotero 离线，使用磁盘缓存 .bib", abs);
  if (zstore().syncBusy) return skip("同步进行中", abs);
  if (!isPathInsideRoot(root, abs)) return skip("项目外的 .bib 由 BBT 维护，Zetla 只监听与索引", abs);
  if (isDirtyBib(abs)) return skip("该 .bib 有未保存改动，已跳过写盘", abs);

  const st = zstore();
  st.setSyncBusy(true);
  st.setSyncError(null);
  try {
    const port = c.port || 23119;
    const collectionKey = binding.collectionKey.trim();
    let itemsJson = "";
    try {
      itemsJson = await zoteroApi.fetchItems(port, collectionKey || null);
    } catch {
      // 键映射失败不致命：.bib 仍可同步
    }
    const items = itemsJson ? parseZoteroItems(itemsJson) : [];

    let text = "";
    let source: "bbt" | "local-api" = "local-api";
    if (health.bbtAvailable && collectionKey) {
      try {
        text = await zoteroApi.fetchBbtExport(port, collectionKey, binding.format);
        source = "bbt";
      } catch {
        // pull export 失败（集合未配置自动导出等）→ 回落本地 API 生成
      }
    }
    if (!text.trim()) {
      if (items.length === 0) throw new Error("本地 API 未返回题录（分类可能为空或请求被拒绝）");
      text = itemsToBibtex(items);
      source = "local-api";
    }

    const written = await zoteroApi.writeBib(root, binding.bibPath, text);
    const bibKeys = bibKeysFromText(text);
    const notes = parseItemKeyNotes(text);
    const map = buildKeyMap(items, bibKeys, health.serverId ?? null, now, notes);
    const cited = useReferenceStore.getState().citations.map((x) => x.key);
    const migrations: KeyMigration[] = planKeyMigration(st.keyMap, map, cited);
    // 键漂移只生成计划、不自动改 .tex（避免静默改写用户正文）
    await zoteroApi.saveMap(
      root,
      JSON.stringify({ ...map, migrations }, null, 2),
    );
    st.setKeyMap(map);
    await reindexNow();

    const record: ZoteroSyncRecord = {
      at: now,
      ok: true,
      source,
      written: written.written,
      hash: written.hash,
      entryCount: bibKeys.length,
      mappedCount: Object.keys(map.byCiteKey).length,
      message: migrations.length
        ? `${migrations.length} 个 citekey 已变化（未自动改写正文）`
        : written.message,
      bibPath: written.path,
    };
    st.setLastSync(record);
    return record;
  } catch (e) {
    const message = `同步失败：${String(e)}`;
    st.setSyncError(message);
    const record: ZoteroSyncRecord = {
      at: now, ok: false, source: "skipped", written: false, hash: "",
      entryCount: 0, mappedCount: 0, message, bibPath: abs,
    };
    st.setLastSync(record);
    return record;
  } finally {
    zstore().setSyncBusy(false);
  }
}

/** UI：立即同步全部启用的绑定（顺序执行，避免并发写盘） */
export async function syncAllZoteroBindings(): Promise<ZoteroSyncRecord[]> {
  const out: ZoteroSyncRecord[] = [];
  for (const b of zstore().bindings.filter((x) => x.enabled)) {
    out.push(await syncZoteroBinding(b));
  }
  return out;
}

// ── 编译前校验（P1-7） ───────────────────────────────────────
/**
 * 在 startCompile 保存脏缓冲之后调用。只读诊断 + 可选主动拉取；
 * 全程 try/catch 吞异常，返回 Promise<void>，任何失败都不阻断编译。
 */
export async function runZoteroPreCompile(): Promise<void> {
  try {
    const c = cfg();
    if (!c.enabled || !c.syncOnCompile) return;
    const root = useProjectStore.getState().root;
    if (!root) return;
    const st = zstore();
    const binding = st.bindings.find((b) => b.enabled);
    if (
      c.autoSync && binding && st.health?.state === "connected" &&
      shouldPull(st.lastSync?.at ?? null, Date.now())
    ) {
      await syncZoteroBinding(binding);
    }
    const ref = useReferenceStore.getState();
    const report = checkBibConsistency(
      ref.entries.map((e) => e.key),
      ref.citations.map((x) => x.key),
    );
    zstore().setConsistency(report);
    const line = consistencySummary(report);
    if (line) useAppStore.getState().appendLog([line]);
  } catch {
    // 编译链路不允许被联动代码打断
  }
}

// ── 单例安装 / 卸载 ──────────────────────────────────────────
function onFocus(): void {
  const c = cfg();
  const st = zstore();
  if (!c.enabled || !c.autoSync || st.syncBusy) return;
  if (st.health?.state !== "connected") return;
  if (!shouldPull(st.lastSync?.at ?? null, Date.now())) return;
  const b = st.bindings.find((x) => x.enabled);
  if (b) void syncZoteroBinding(b);
}

export function startZoteroSyncRuntime(): void {
  if (installed) return;
  installed = true;

  void onKernelEvent<ZoteroBibChanged>(RustEvents.zoteroBibChanged, handleBibChanged)
    .then((fn) => { unlistenBib = fn; })
    .catch(() => {});

  unsubscribeProject = useProjectStore.subscribe((s, prev) => {
    if (s.root !== prev.root || s.root !== lastRoot) {
      void reloadZoteroBindings(s.root);
    }
  });

  unsubscribeSettings = useSettingsStore.subscribe((s, prev) => {
    const a = s.settings.zotero;
    const b = prev.settings.zotero;
    if (!a || !b) return;
    if (a.enabled === b.enabled && a.autoSync === b.autoSync) return;
    void restartBibWatcher();
  });

  window.addEventListener("focus", onFocus);
  void reloadZoteroBindings(useProjectStore.getState().root);
}

export function stopZoteroSyncRuntime(): void {
  if (reindexTimer !== undefined) {
    window.clearTimeout(reindexTimer);
    reindexTimer = undefined;
  }
  unlistenBib?.();
  unlistenBib = null;
  unsubscribeProject?.();
  unsubscribeProject = null;
  unsubscribeSettings?.();
  unsubscribeSettings = null;
  window.removeEventListener("focus", onFocus);
  void zoteroApi.unwatchBibs().catch(() => {});
  lastHandled = null;
  lastRoot = null;
  installed = false;
}

if (import.meta.hot) {
  import.meta.hot.dispose(stopZoteroSyncRuntime);
}

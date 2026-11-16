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
import { getActiveView } from "@/editor/activeView";
import { useBuffersStore } from "@/editor/useBuffers";
import { onKernelEvent, RustEvents } from "@/ipc/events";
import { zoteroApi } from "@/ipc/invoke";
import { useReferenceStore } from "@/modules/reference/useReferenceStore";
import { extOf, notify, useProjectStore } from "@/project/useProject";
import {
  DEFAULT_ZOTERO_SETTINGS,
  type ZoteroBibChanged,
  type ZoteroBinding,
  type ZoteroCollection,
  type ZoteroItem,
  type ZoteroKeyMap,
  type ZoteroSyncRecord,
} from "@/types/zotero";
import {
  BIB_DEBOUNCE_MS,
  appendKeyMap,
  bibtexEntryBlock,
  buildKeyMap,
  checkBibConsistency,
  consistencySummary,
  isNewChange,
  isPathInsideRoot,
  missingCiteKeys,
  normalizeBibPath,
  parseCollections,
  parseItemKeyNotes,
  parseSingleItem,
  parseZoteroItems,
  pathKey,
  planKeyMigration,
  shouldPull,
  type KeyMigration,
} from "./zoteroSync";
import {
  itemKeyNotesFromBib,
  mergeBibFields,
  zoteroFieldsFromItem,
} from "./zoteroMerge";
import { useZoteroPicker } from "./useZoteroPicker";
import { useZoteroStore } from "./useZoteroStore";

// ── 模块级状态（单例） ────────────────────────────────────────
let installed = false;
let unlistenBib: (() => void) | null = null;
let unsubscribeProject: (() => void) | null = null;
let unsubscribeSettings: (() => void) | null = null;
let reindexTimer: number | undefined;
let metadataPollTimer: number | undefined;
let lastHandled: Pick<ZoteroBibChanged, "path" | "hash"> | null = null;
let lastRoot: string | null = null;

/** P6：元数据轮询固定间隔（毫秒）；只在设置里显式开启后启动，未开启时零请求 */
const METADATA_POLL_MS = 120_000;

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
    // P6：只读 bibPath + enabled；Rust 侧旧字段（collection/syncMode）由 serde 吞掉，
    // 这里再显式收敛一次，避免前端拿到历史脏字段。
    bindings = (await zoteroApi.getBindings(root))
      .filter((b) => !!b.bibPath?.trim())
      .map((b) => ({ bibPath: b.bibPath, enabled: b.enabled !== false }));
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

// ── 主动同步（P6 · Zotero 字段变更 → .bib 字段级合并） ─────────
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
 * P6 同步一条受管 .bib（字段级增量）：
 * 读现有 .bib → 拉 Zotero 全库题录 → 对「已在 .bib 且能映射到 itemKey」的条目
 * 生成字段补丁 → `mergeBibFields` 只替换变化条目（Zotero 非空字段覆盖同名字段、
 * .bib 独有字段保留、citekey 不变）→ 原子写盘。
 *
 * 三个出口全部吞异常 / 返回 skipped 记录，绝不阻断编译：
 * - 离线 / 关闭联动 → 跳过，磁盘缓存 .bib 照常可用；
 * - .bib 脏 / 项目外 → 跳过，交给用户或 BBT；
 * - 没变化 → 不写盘，仅刷新键映射。
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
    const existing = await zoteroApi.readBib(root, binding.bibPath);

    // 1) 拉全库 top-level 题录（只读；一次请求，按 itemKey 索引）
    let itemsJson = "";
    try {
      itemsJson = await zoteroApi.fetchItems(port, null);
    } catch {
      // 题录拉取失败不致命：下面映射为空，至多不更新字段
    }
    const items = itemsJson ? parseZoteroItems(itemsJson) : [];
    const byItemKey = new Map(items.map((it) => [it.itemKey, it]));

    // 2) 解析现有 .bib 的 citeKey → itemKey 映射：优先 map.json，缺失时从 note 兜底
    const ref = useReferenceStore.getState();
    const bibKeys = ref.entries
      .filter((e) => pathKey(e.file) === pathKey(abs))
      .map((e) => e.key);
    const noted = itemKeyNotesFromBib(existing); // itemKey → citeKey
    const prior = st.keyMap;
    const citeToItem: Record<string, string> = { ...(prior?.byCiteKey ?? {}) };
    for (const [ik, ck] of Object.entries(noted)) {
      if (!citeToItem[ck]) citeToItem[ck] = ik;
    }
    // 只处理确实在 .bib 里的条目
    const present = new Set(bibKeys.length ? bibKeys : Object.keys(citeToItem));
    const patchMap = new Map<string, ReturnType<typeof zoteroFieldsFromItem>>();
    for (const [ck, ik] of Object.entries(citeToItem)) {
      if (present.has(ck) && byItemKey.has(ik)) {
        patchMap.set(ck, zoteroFieldsFromItem(byItemKey.get(ik)!));
      }
    }
    // BBT 风格 .bib 兜底：题录 Extra 里的 Citation Key 直接命中 .bib 的 citekey（无 itemKey note 时）
    for (const it of items) {
      const ck = it.citationKey?.trim();
      if (ck && present.has(ck) && !patchMap.has(ck) && !citeToItem[ck]) {
        patchMap.set(ck, zoteroFieldsFromItem(it));
      }
    }
    const patches = [...patchMap.entries()].map(([citeKey, fields]) => ({ citeKey, fields }));

    // 3) 字段级合并 + 原子写（没变化不写盘）
    const merged = mergeBibFields(existing, patches);
    let written = false;
    let hash = "";
    let message = "";
    if (merged.changedKeys.length > 0) {
      const r = await zoteroApi.writeBib(root, binding.bibPath, merged.text);
      written = r.written;
      hash = r.hash;
      const sample = merged.changedKeys.slice(0, 4).join(", ");
      message = `已同步 ${merged.changedKeys.length} 条题录字段（${sample}${merged.changedKeys.length > 4 ? "…" : ""}）`;
    } else {
      message = patches.length
        ? `字段无变化（已检查 ${patches.length} 条映射）`
        : "没有可同步的映射条目（可先插入引用或用「补写条目」建立映射）";
    }

    // 4) 刷新键映射（citekey 不变；只为映射条目补全，不覆盖用户手写条目的指向）
    const notes = parseItemKeyNotes(merged.changedKeys.length ? merged.text : existing);
    const map = buildKeyMap(
      items,
      bibKeys.length ? bibKeys : Object.keys(citeToItem),
      health.serverId ?? null,
      now,
      { ...noted, ...notes },
    );
    const cited = ref.citations.map((x) => x.key);
    const migrations: KeyMigration[] = planKeyMigration(prior, map, cited);
    // 键漂移只记录计划，不自动改写 .tex 正文
    await zoteroApi.saveMap(root, JSON.stringify({ ...map, migrations }, null, 2));
    st.setKeyMap(map);
    await reindexNow();

    const record: ZoteroSyncRecord = {
      at: now,
      ok: true,
      source: "local-api",
      written,
      hash,
      entryCount: bibKeys.length,
      mappedCount: Object.keys(map.byCiteKey).length,
      message: migrations.length ? `${message}；${migrations.length} 个 citekey 漂移（未改正文）` : message,
      bibPath: abs,
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

// ── P4 · on-demand「插一篇写一篇」 ─────────────────────────────

export interface BibEntryRequest {
  citeKey: string;
  /** Zotero 8 位 key；picker 候选只有它时传这个（比查 map 更可靠） */
  itemKey?: string | null;
  /** 调用方手里已有完整题录（文献库视图）时直接带上，省一次网络请求 */
  item?: ZoteroItem | null;
}

export interface BibEnsureResult {
  ok: boolean;
  /** 实际追加条数 */
  written: number;
  /** 已存在于 .bib，无需写入 */
  skipped: string[];
  /** 拿不到题录、无法生成的 key */
  unknown: string[];
  message: string;
}

/** 第一个启用且指向项目内 .bib 的受管绑定（缺一条写一条 / 字段同步共用） */
function onDemandBinding(): { binding: ZoteroBinding; root: string; abs: string } | null {
  const root = useProjectStore.getState().root;
  if (!root) return null;
  const b = zstore().bindings.find((x) => x.enabled && x.bibPath.trim());
  if (!b) return null;
  const abs = normalizeBibPath(root, b.bibPath);
  // 项目外 .bib 由 BBT Keep updated 维护，Zetla 不写盘
  if (!isPathInsideRoot(root, abs)) return null;
  return { binding: b, root, abs };
}

/**
 * P4：确保这些 citekey 的条目存在于按需绑定的 .bib；缺失则生成单条并幂等追加
 * （Rust 侧按 key 去重，重复调用无副作用），随后增量更新 map.json 并重建索引。
 * 全程吞异常 —— 插入与编译链路不允许被联动代码打断。
 */
export async function ensureBibEntries(
  wanted: BibEntryRequest[],
): Promise<BibEnsureResult> {
  const empty: BibEnsureResult = {
    ok: true, written: 0, skipped: [], unknown: [], message: "",
  };
  try {
    const hit = onDemandBinding();
    if (!hit) return { ...empty, ok: false, message: "没有启用「按需写入」的项目内绑定" };
    const { binding, root, abs } = hit;
    const c = cfg();
    if (!c.enabled) return { ...empty, ok: false, message: "Zotero 联动未启用" };
    if (isDirtyBib(abs)) {
      return {
        ...empty, ok: false,
        message: `${binding.bibPath} 有未保存改动，已跳过写盘；保存后重试`,
      };
    }
    const health = zstore().health;
    const bibKeys = useReferenceStore.getState().entries.map((e) => e.key);
    const missing = missingCiteKeys(
      wanted.map((w) => w.citeKey),
      bibKeys,
    );
    if (missing.length === 0) return empty;
    if (!health || health.state !== "connected") {
      return { ...empty, ok: false, unknown: missing, message: "Zotero 离线，无法生成条目" };
    }
    const st = zstore();
    if (st.syncBusy) {
      return { ...empty, ok: false, unknown: missing, message: "同步进行中，稍后重试" };
    }
    const port = c.port || 23119;
    const items: { item: ZoteroItem; key: string }[] = [];
    const unknown: string[] = [];
    for (const w of wanted) {
      if (!missing.includes(w.citeKey)) continue;
      let item = w.item && w.item.itemKey ? w.item : null;
      if (!item) {
        const itemKey = w.itemKey || st.keyMap?.byCiteKey[w.citeKey];
        if (!itemKey) {
          unknown.push(w.citeKey);
          continue;
        }
        try {
          item = parseSingleItem(await zoteroApi.fetchItem(port, itemKey));
        } catch {
          item = null;
        }
      }
      if (item) items.push({ item, key: w.citeKey });
      else unknown.push(w.citeKey);
    }
    if (items.length === 0) {
      return {
        ...empty, ok: false, unknown,
        message: `无法取得题录：${unknown.join(", ")}`,
      };
    }
    // citekey 强制为用户选中的那个 —— 插入的 \cite 必须与 .bib 条目 key 一致
    const text = items
      .map(({ item, key }) => bibtexEntryBlock(item, key))
      .join("\n\n");
    st.setSyncBusy(true);
    try {
      const r = await zoteroApi.appendBib(root, binding.bibPath, text);
      const appended = r.appendedKeys ?? [];
      if (r.written && appended.length > 0) {
        // 增量更新映射：只给真正写入的 key 建映射，避免覆盖手写条目的既有指向
        const map = appendKeyMap(
          st.keyMap,
          appended.flatMap((k) => {
            const itemKey = items.find((x) => x.key === k)?.item.itemKey;
            return itemKey ? [{ citeKey: k, itemKey }] : [];
          }),
        );
        await zoteroApi.saveMap(root, JSON.stringify(map, null, 2));
        st.setKeyMap(map);
        await reindexNow();
      }
      return {
        ok: true,
        written: r.written ? appended.length : 0,
        skipped: missing.filter((k) => !appended.includes(k)),
        unknown,
        message: r.message,
      };
    } finally {
      st.setSyncBusy(false);
    }
  } catch (e) {
    return {
      ok: false, written: 0, skipped: [], unknown: [],
      message: `按需写入失败：${String(e)}`,
    };
  }
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

    // P6 按需补齐：编译前把「被引但缺失」的条目写进受管 .bib（失败只记日志，不阻断）
    const odBinding = st.bindings.find((b) => b.enabled);
    if (odBinding && report.missing.length > 0) {
      const r = await ensureBibEntries(report.missing.map((k) => ({ citeKey: k })));
      if (r.written > 0) {
        useAppStore.getState().appendLog([
          `Zotero 按需补写：编译前已补写 ${r.written} 条到 ${odBinding.bibPath}` +
            (r.unknown.length ? `；另有 ${r.unknown.length} 条无法生成` : ""),
        ]);
      } else if (r.unknown.length > 0) {
        useAppStore.getState().appendLog([
          `Zotero 按需补写：${r.unknown.length} 条被引条目无法生成（${r.message}）`,
        ]);
      }
    }
  } catch {
    // 编译链路不允许被联动代码打断
  }
}

// ── P2 · Citation Picker 全局快捷键（Ctrl+Alt+K） ──────────────
/**
 * 避开已占用的 Ctrl+Shift+Z（重做）、Ctrl+Shift+Space（片段）、
 * Ctrl+Shift+N/O/S 与 Ctrl+B chord（MenuBar.tsx:594）。
 * capture 阶段注册：只在命中该组合时拦截，CodeMirror 默认 keymap 不会吞掉它。
 * 联动关闭时依然可唤起 —— 主源是项目 .bib 索引，离线插入完全可用。
 */
function onPickerKey(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey) || !e.altKey || e.shiftKey) return;
  if (e.key.toLowerCase() !== "k") return;
  e.preventDefault();
  e.stopPropagation();
  const st = useBuffersStore.getState();
  const active = st.activePath
    ? st.buffers.find((b) => b.path === st.activePath)
    : null;
  const ext = active ? extOf(active.name) : "";
  if (!active || (ext !== "tex" && ext !== "ltx")) {
    notify("请在 .tex 文件中使用引用拾取", "err");
    return;
  }
  if (!getActiveView()) {
    notify("没有活动编辑器，无法插入引用", "err");
    return;
  }
  const picker = useZoteroPicker.getState();
  if (picker.open) picker.closePicker();
  else picker.openPicker(active.path);
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

/** P6：按设置启停元数据轮询（默认关闭；开后每 120s 且距上次同步 ≥60s 才拉一次） */
function restartMetadataPoll(): void {
  if (metadataPollTimer !== undefined) {
    window.clearInterval(metadataPollTimer);
    metadataPollTimer = undefined;
  }
  const c = cfg();
  if (!c.enabled || !c.metadataPollEnabled) return;
  metadataPollTimer = window.setInterval(() => {
    const cfgNow = cfg();
    const st = zstore();
    if (!cfgNow.enabled || !cfgNow.metadataPollEnabled || st.syncBusy) return;
    if (st.health?.state !== "connected") return;
    if (!shouldPull(st.lastSync?.at ?? null, Date.now())) return;
    const b = st.bindings.find((x) => x.enabled);
    if (b) void syncZoteroBinding(b);
  }, METADATA_POLL_MS);
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
    if (a.enabled === b.enabled && a.autoSync === b.autoSync && a.metadataPollEnabled === b.metadataPollEnabled) return;
    void restartBibWatcher();
    restartMetadataPoll();
  });

  window.addEventListener("focus", onFocus);
  window.addEventListener("keydown", onPickerKey, true);
  restartMetadataPoll();
  void reloadZoteroBindings(useProjectStore.getState().root);
}

export function stopZoteroSyncRuntime(): void {
  if (reindexTimer !== undefined) {
    window.clearTimeout(reindexTimer);
    reindexTimer = undefined;
  }
  if (metadataPollTimer !== undefined) {
    window.clearInterval(metadataPollTimer);
    metadataPollTimer = undefined;
  }
  unlistenBib?.();
  unlistenBib = null;
  unsubscribeProject?.();
  unsubscribeProject = null;
  unsubscribeSettings?.();
  unsubscribeSettings = null;
  window.removeEventListener("focus", onFocus);
  window.removeEventListener("keydown", onPickerKey, true);
  void zoteroApi.unwatchBibs().catch(() => {});
  lastHandled = null;
  lastRoot = null;
  installed = false;
}

if (import.meta.hot) {
  import.meta.hot.dispose(stopZoteroSyncRuntime);
}

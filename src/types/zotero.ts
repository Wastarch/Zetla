// Zotero 联动 · 协议类型（与 src-tauri/src/commands/zotero.rs / config.rs 一一对应，camelCase）
// P0 仅做只读连接自检与能力探测；P1 起才涉及 .bib 同步、P2 起才涉及引用插入。
// 设计文档：docs/dev/Zotero联动/开发计划.md

/** Zotero 本地 API 默认端口（Juris-M 为 24119）。主机固定 localhost，不可配置。 */
export const ZOTERO_DEFAULT_PORT = 23119;

/** P2 Citation Picker 可选引用命令（与 Rust ZOTERO_COMMANDS 一致） */
export const ZOTERO_COMMANDS = [
  "cite",
  "citep",
  "citet",
  "autocite",
  "parencite",
  "textcite",
] as const;
export type ZoteroCommand = (typeof ZOTERO_COMMANDS)[number];

/** P1 citekey 策略（与 Rust ZOTERO_KEY_STRATEGIES 一致） */
export const ZOTERO_KEY_STRATEGIES = ["bbt-first", "zetla"] as const;
export type ZoteroKeyStrategy = (typeof ZOTERO_KEY_STRATEGIES)[number];

// P6：full 模式已移除。存量配置里的 syncMode / collectionKey / collectionName
// 由 Rust serde default 吞掉；前端只看 bibPath + enabled，语义统一为：
// 「缺一条插一条（ensureBibEntries）」+「Zotero 字段变更时字段级合并（syncZoteroBinding）」。

/** 应用级偏好（AppSettings.zotero；Rust ZoteroConfig） */
export interface ZoteroSettings {
  /** 总开关：关闭时不自动发请求、状态栏不显示连接灯（设置页仍可手动自检） */
  enabled: boolean;
  /** 本地 API 端口；0 会归一化为 23119 */
  port: number;
  /** P1：定时 / 窗口获焦自动同步 */
  autoSync: boolean;
  /** P1：编译前校验 .bib 与 \cite 一致性 */
  syncOnCompile: boolean;
  /** P6：定时轮询 Zotero 元数据并字段级同步到受管 .bib（默认关，用户手动开启） */
  metadataPollEnabled: boolean;
  /** P2：默认引用命令 */
  defaultCommand: ZoteroCommand;
  /** P3：CSL 预览样式 id（仅预览/复制，不驱动 LaTeX 输出） */
  cslStyle: string;
  /** P1：citekey 策略 */
  keyStrategy: ZoteroKeyStrategy;
  /** P0：状态自检轮询间隔（秒，Rust 钳制 10–300） */
  pollIntervalSeconds: number;
  /** M1-34：Citation Picker 列表显示列（title 恒显不参与配置；与 Rust picker_columns 一一对应） */
  pickerColumns: string[];
}

/** Picker 列表可配置列白名单（title 固定显示，不在其中） */
export const ZOTERO_PICKER_COLUMN_IDS = [
  "authors",
  "year",
  "publication",
  "citeKey",
  "status",
] as const;

/** Picker 列表默认显示列（title 之外）：作者 / 年份 / citekey / 状态 */
export const DEFAULT_PICKER_COLUMNS: string[] = ["authors", "year", "citeKey", "status"];

/** 默认关闭联动：不改变存量用户行为 */
export const DEFAULT_ZOTERO_SETTINGS: ZoteroSettings = {
  enabled: false,
  port: ZOTERO_DEFAULT_PORT,
  autoSync: true,
  syncOnCompile: true,
  metadataPollEnabled: false,
  defaultCommand: "cite",
  cslStyle: "china-national-standard-gb-t-7714-2015-numeric",
  keyStrategy: "bbt-first",
  pollIntervalSeconds: 30,
  pickerColumns: [...DEFAULT_PICKER_COLUMNS],
};

/**
 * 连接状态。前 6 个由 Rust ZoteroState 产生；
 * `checking` / `disabled` 是纯前端 UI 态（自检中 / 用户关闭联动）。
 */
export type ZoteroConnectionState =
  | "connected"
  | "api-disabled"
  | "bad-request"
  | "offline"
  | "timeout"
  | "unavailable"
  | "checking"
  | "disabled";

/** `zotero_health` 返回的结构化事实（文案由 zoteroDiagnostics.ts 生成） */
export interface ZoteroHealth {
  state: Exclude<ZoteroConnectionState, "checking" | "disabled">;
  /** 连接都未建立时为 null */
  httpStatus: number | null;
  apiVersion: string | null;
  schemaVersion: string | null;
  /** Zotero 10+ 才有；P1 的缓存须按它分区 */
  serverId: string | null;
  zoteroVersion: string | null;
  /** 本地写能力（Zotero 10+）；本期不写回 */
  canWrite: boolean;
  /** Better BibTeX 在线（probe=1 返回 ready） */
  bbtAvailable: boolean;
  port: number;
  checkedAt: string;
  message: string;
}

// ── P1 · 自动化同步协议 ────────────────────────────────────────

/** Zotero 分类（本地 API `GET /api/users/0/collections` 的条目） */
export interface ZoteroCollection {
  key: string;
  name: string;
  /** 父分类 key；顶层为 false / 空 */
  parentCollection: string | false;
}

/**
 * P6：项目级「受管 .bib」配置（`.ltex/config.json` 的 zoteroBindings）。
 * 只保留一个路径 + 开关；不再有 collection / 全量模式概念。
 * 兼容：Rust 侧 serde 仍接受旧字段（collectionKey/collectionName/syncMode），
 * 前端忽略它们；读回写回时这些字段会被 Rust default 抹平。
 */
export interface ZoteroBinding {
  /** 相对项目根（推荐）或项目内绝对路径；Rust 写盘时校验不越界 */
  bibPath: string;
  enabled: boolean;
}

export const DEFAULT_ZOTERO_BINDING: ZoteroBinding = {
  bibPath: "references.bib",
  enabled: true,
};

/** `zotero_write_bib` / `zotero_append_entries` 返回 */
export interface ZoteroWriteResult {
  path: string;
  hash: string;
  written: boolean;
  bytes: number;
  message: string;
  /** 仅 append 返回：实际追加的条目 key（有序；writeBib 无此字段） */
  appendedKeys?: string[];
}

/** `zotero:bib-changed` 事件负载 */
export interface ZoteroBibChanged {
  path: string;
  hash: string;
  reason: "external" | "sync";
}

/** 从本地 API `format=json` 归一化出的题录（只保留同步需要的字段） */
export interface ZoteroItem {
  itemKey: string;
  itemType: string;
  title: string;
  authors: string[];
  year: string;
  /** 期刊 / 会议论文集 / 出版社（按 itemType 落到 journal / booktitle / publisher） */
  publicationTitle: string;
  doi: string;
  url: string;
  /** Zotero 的 abstractNote；无 BBT 时由本地 API 降级导出写入 .bib */
  abstract?: string;
  extra: string;
  /** BBT 写在 Extra 里的稳定 citekey */
  citationKey: string;
}

/** `.ltex/zotero/map.json`：citekey ↔ itemKey 双向映射（按 serverId 分区） */
export interface ZoteroKeyMap {
  serverId: string | null;
  updatedAt: string;
  /** citeKey → Zotero itemKey */
  byCiteKey: Record<string, string>;
  /** itemKey → citeKey */
  byItemKey: Record<string, string>;
  /** .bib 中未被映射的 key（多半是用户手写条目） */
  unmapped: string[];
}

/** 编译前一致性诊断（只读，不阻断编译） */
export interface ZoteroConsistency {
  checkedAt: string;
  /** \cite 引用了但 .bib 里没有 */
  missing: string[];
  /** .bib 里有但全文没人引用 */
  orphaned: string[];
  /** .bib 中重复定义的 key */
  duplicates: string[];
  bibCount: number;
  citeCount: number;
}

// ── P2 · 沉浸式插入协议 ────────────────────────────────────────

/** `zotero_search` 返回：items 为本地 API 原始 JSON，total 来自 Total-Results 响应头 */
export interface ZoteroSearchResult {
  items: string;
  total: number | null;
}

/** 一次同步的结果（设置页展示 + 节流依据） */
export interface ZoteroSyncRecord {
  at: string;
  ok: boolean;
  /** "bbt" | "local-api" | "skipped" */
  source: "bbt" | "local-api" | "skipped";
  written: boolean;
  hash: string;
  entryCount: number;
  mappedCount: number;
  message: string;
  bibPath: string;
}

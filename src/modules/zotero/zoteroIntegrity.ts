// Zotero 联动 · P3-6 引用完整性诊断纯逻辑
// （无 @/ 别名、无 store / Tauri 依赖，node --experimental-strip-types 可直接跑）
//
// 五类问题，全部只读：
//   orphan       正文 \cite 了，但 .bib 里没有 → 编译会出 ??
//   unreferenced .bib 有条目，但全文从未引用 → 可能是多余条目
//   duplicate    .bib 里同一 key 定义多次 → 引用到哪条不确定
//   trashed      映射指向的 Zotero 条目已在回收站 → 反向跳转会跳空
//   drift        映射里的 citekey 在 .bib 中已不存在 / 双向映射自相矛盾
//
// 铁律：不自动修复、不改 .bib、不回写 map.json；离线时垃圾桶检查标记为「未检查」而不是误报。

import type { ZoteroKeyMap } from "../../types/zotero.ts";

export type IntegrityKind = "orphan" | "unreferenced" | "duplicate" | "trashed" | "drift";

/** 展示顺序与严重度：越靠前越该先处理 */
export const INTEGRITY_ORDER: IntegrityKind[] = [
  "orphan",
  "trashed",
  "duplicate",
  "drift",
  "unreferenced",
];

export const INTEGRITY_LABEL: Record<IntegrityKind, string> = {
  orphan: "缺失引用",
  unreferenced: "未引用条目",
  duplicate: "重复 key",
  trashed: "条目在回收站",
  drift: "映射漂移",
};

export interface IntegrityBibEntry {
  key: string;
  file: string;
  line: number;
}

export interface IntegrityCitation {
  key: string;
  file: string;
  line: number;
}

export interface IntegrityInput {
  bibEntries: IntegrityBibEntry[];
  citations: IntegrityCitation[];
  keyMap: ZoteroKeyMap | null;
  /** 回收站 itemKey；null = 本次未检查（离线 / 未开启联动） */
  trashKeys?: ReadonlySet<string> | null;
}

export interface IntegrityIssue {
  kind: IntegrityKind;
  /** 展示用的 key（citekey；trashed/drift 也可能是 itemKey） */
  key: string;
  detail: string;
  /** 可跳转位置（.bib / .tex 行） */
  file?: string;
  line?: number;
  /** Zotero 8 位 itemKey（trashed / drift 用，便于「在 Zotero 打开」） */
  itemKey?: string;
}

export interface IntegrityReport {
  issues: IntegrityIssue[];
  counts: Record<IntegrityKind, number>;
  checkedAt: string;
  /** 是否做了回收站检查；false 时 UI 必须写「未检查」而不是「无问题」 */
  trashChecked: boolean;
  bibCount: number;
  citeCount: number;
  /** 映射条目数（byCiteKey 大小） */
  mapCount: number;
}

function emptyCounts(): Record<IntegrityKind, number> {
  return { orphan: 0, unreferenced: 0, duplicate: 0, trashed: 0, drift: 0 };
}

/** 从任意题录 JSON（回收站清单）里抽 itemKey；解析失败一律空数组，不抛异常 */
export function parseItemKeysFromJson(raw: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const arr = Array.isArray(data)
    ? data
    : Array.isArray((data as { items?: unknown } | null)?.items)
      ? ((data as { items: unknown[] }).items as unknown[])
      : [];
  const out: string[] = [];
  for (const v of arr) {
    const key = (v as { key?: unknown } | null)?.key;
    if (typeof key === "string" && /^[A-Za-z0-9]{8}$/.test(key) && !out.includes(key)) {
      out.push(key);
    }
  }
  return out;
}

/** 逐条诊断；结果按严重度 + key 稳定排序，便于快照测试与 UI 渲染 */
export function buildIntegrityReport(
  input: IntegrityInput,
  checkedAt: string = new Date().toISOString(),
): IntegrityReport {
  const issues: IntegrityIssue[] = [];

  // 1) .bib 侧索引：key → 首次出现位置；重复时记录第 2 次的位置
  const bibFirst = new Map<string, IntegrityBibEntry>();
  const bibDup = new Map<string, IntegrityBibEntry>();
  for (const e of input.bibEntries) {
    if (!bibFirst.has(e.key)) bibFirst.set(e.key, e);
    else if (!bibDup.has(e.key)) bibDup.set(e.key, e);
  }

  // 2) 正文引用计数
  const citeCount = new Map<string, number>();
  for (const c of input.citations) {
    citeCount.set(c.key, (citeCount.get(c.key) ?? 0) + 1);
    if (!bibFirst.has(c.key)) {
      issues.push({
        kind: "orphan",
        key: c.key,
        detail: "正文引用了该 key，但项目中找不到对应 .bib 条目（编译会显示 ??）",
        file: c.file,
        line: c.line,
      });
    }
  }

  // 3) 重复 key
  for (const [key, e] of bibDup) {
    issues.push({
      kind: "duplicate",
      key,
      detail: `该 key 在 .bib 中定义了多次，引用落到哪一条不确定（首个定义在 ${bibFirst.get(key)?.file ?? "?"}）`,
      file: e.file,
      line: e.line,
    });
  }

  // 4) 未引用条目
  for (const [key, e] of bibFirst) {
    if ((citeCount.get(key) ?? 0) > 0) continue;
    issues.push({
      kind: "unreferenced",
      key,
      detail: ".bib 里有该条目，但全文没有任何引用命令",
      file: e.file,
      line: e.line,
    });
  }

  // 5) 回收站：映射指向的条目已被删除
  const trash = input.trashKeys ?? null;
  if (trash && trash.size > 0) {
    for (const [citeKey, itemKey] of Object.entries(input.keyMap?.byCiteKey ?? {})) {
      if (!trash.has(itemKey)) continue;
      issues.push({
        kind: "trashed",
        key: citeKey,
        itemKey,
        detail: "映射指向的 Zotero 条目已在回收站，反向跳转会跳空（.bib 内容不受影响）",
      });
    }
  }

  // 6) 映射漂移：byCiteKey 的 key 在 .bib 中已不存在（改名/删除后未重建映射）
  const map = input.keyMap;
  if (map) {
    for (const [citeKey, itemKey] of Object.entries(map.byCiteKey ?? {})) {
      if (bibFirst.has(citeKey)) continue;
      // 已被 trashed 命中的不再重复报漂移，避免同一件事两条告警
      if (trash && trash.has(itemKey)) continue;
      issues.push({
        kind: "drift",
        key: citeKey,
        itemKey,
        detail: "映射里的 citekey 在 .bib 中已不存在（多半是条目改名或删除后未重建映射）",
      });
    }
    // 双向映射自相矛盾：byItemKey[itemKey] 与 byCiteKey[citeKey] 不一致
    for (const [citeKey, itemKey] of Object.entries(map.byCiteKey ?? {})) {
      const back = map.byItemKey?.[itemKey];
      if (!back || back === citeKey) continue;
      issues.push({
        kind: "drift",
        key: citeKey,
        itemKey,
        detail: `映射自相矛盾：${itemKey} 反查得到「${back}」，与正查不一致`,
      });
    }
  }

  const rank = new Map(INTEGRITY_ORDER.map((k, i) => [k, i]));
  issues.sort((a, b) => {
    const r = (rank.get(a.kind) ?? 99) - (rank.get(b.kind) ?? 99);
    if (r !== 0) return r;
    return a.key.localeCompare(b.key, "zh-CN");
  });

  const counts = emptyCounts();
  for (const i of issues) counts[i.kind] += 1;

  return {
    issues,
    counts,
    checkedAt,
    trashChecked: !!trash,
    bibCount: bibFirst.size,
    citeCount: citeCount.size,
    mapCount: Object.keys(map?.byCiteKey ?? {}).length,
  };
}

/** 顶部一句话总结（0 问题时也要说明「回收站未检查」这一前提） */
export function integritySummary(r: IntegrityReport): string {
  const total = r.issues.length;
  if (total === 0) {
    return r.trashChecked
      ? `引用索引正常：${r.bibCount} 条文献 / ${r.citeCount} 个被引 key`
      : `引用索引正常；回收站未检查（${r.bibCount} 条文献 / ${r.citeCount} 个被引 key）`;
  }
  const parts = INTEGRITY_ORDER.filter((k) => r.counts[k] > 0).map(
    (k) => `${INTEGRITY_LABEL[k]} ${r.counts[k]}`,
  );
  return `${total} 处问题：${parts.join(" · ")}`;
}

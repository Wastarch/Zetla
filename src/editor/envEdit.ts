// 环境反向编辑注册表（M1-19）：hover ✎ 标记 → 打开对应编辑面板 → 指纹校验原地替换。
// 职责边界：本文件只做「注册表 + 统一入口」，**禁止 import src/modules**（依赖方向
// modules → editor 单向，与 mathInsert→mathSlots 同向；反向会成环）。
// 各模块（公式/表格，未来图片等）在自己的注册函数 hooks.onModuleEnabled 里调
// registerEnvEditor，onModuleDisabled 里调 unregisterEnvEditor——模块停用后 hover
// 自然无对应标记，无需在此反查 moduleRegistry。
import { useAppStore } from "@/core/store";

/** 环境命中（hover 场景）：区间 + 展示名 + 模块私有富解析结果 */
export interface EnvHit {
  /** = EnvEditor.id（"formula" | "table" | …） */
  id: string;
  /** 环境整体区间（含包裹定界符，如 $…$ / \begin{…}…\end{…}） */
  from: number;
  to: number;
  /** tooltip 按钮展示名，如「公式（$…$）」「表格（tabular）」 */
  label: string;
  /** 模块私有解析结果（load 时取回，避免二次解析） */
  data?: unknown;
}

/** 一种可反向编辑的环境（公式/表格/未来的图片……） */
export interface EnvEditor {
  id: string;
  /** 点击标记后切换到的侧栏视图（"math" / "table" / …） */
  viewId: string;
  /** 命中检测：pos 落在某环境区间内则返回 hit；null = 不命中 */
  detectAt(doc: string, pos: number): EnvHit | null;
  /** 载入该环境到对应面板 store（切视图由 openEnvEditor 统一执行） */
  load(hit: EnvHit): void;
}

const registry = new Map<string, EnvEditor>();

/** 注册环境编辑器（同 id 覆盖 = 热更新安全，与 moduleRegistry.register 同思路） */
export function registerEnvEditor(ed: EnvEditor): void {
  registry.set(ed.id, ed);
}

export function unregisterEnvEditor(id: string): void {
  registry.delete(id);
}

/**
 * 收集 pos 处全部可编辑环境（嵌套时多个并存，如 table 单元格里的 $…$）。
 * 排序：内层（区间短）优先；同 id 同区间去重。
 */
export function collectEnvHitsAt(doc: string, pos: number): EnvHit[] {
  const hits: EnvHit[] = [];
  for (const ed of registry.values()) {
    const hit = ed.detectAt(doc, pos);
    if (hit) hits.push(hit);
  }
  hits.sort((a, b) => a.to - a.from - (b.to - b.from) || a.from - b.from);
  return hits.filter(
    (h, i) =>
      i === 0 ||
      !(
        h.id === hits[i - 1].id &&
        h.from === hits[i - 1].from &&
        h.to === hits[i - 1].to
      ),
  );
}

/** 点击 ✎ 标记的统一入口：载入对应面板 + 切到其侧栏视图（store.ts setSidebarView 总是展开） */
export function openEnvEditor(hit: EnvHit): boolean {
  const ed = registry.get(hit.id);
  if (!ed) return false;
  ed.load(hit);
  useAppStore.getState().setSidebarView(ed.viewId);
  return true;
}

/** djb2 指纹（「更新」前校验源码区间是否被手改；tableParse.ts re-export 保持兼容） */
export function fingerprintOf(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

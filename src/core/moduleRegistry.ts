// M1-1 · 模块接口层核心（开发文档 §4.2）
// 职责：模块注册/注销、启停（依赖与内核能力校验）、钩子派发、总线桥接。
// 原则（PRD 5.3）：模块间不直接调用一律走 bus；模块懒加载由声明方 React.lazy 完成；
// 模块可单独启停（设置页开关，覆盖值经 AppSettings.modules 持久化）。
import type { EditorView } from "@codemirror/view";
import { bus } from "./bus";
import { BusEvents } from "@/ipc/events";
import { getActiveView } from "@/editor/activeView";
import type {
  LatexModule,
  ModuleContext,
  ModuleEntryView,
  ModuleViewDecl,
} from "@/types/module";

interface RegistryEntry {
  mod: LatexModule;
  enabled: boolean;
  /** 注册顺序（钩子按注册序派发，保证确定性） */
  seq: number;
}

/** 内核能力白名单（模块 requires 引用；不满足时该模块无法启用） */
export const KERNEL_CAPABILITIES = ["editor", "compile", "preview", "project"] as const;
export type KernelCapability = (typeof KERNEL_CAPABILITIES)[number];

/** 模块启停事件负载（总线 module:enabled / module:disabled） */
export interface ModuleStatePayload {
  id: string;
  name: string;
}

/** 无法启用的原因编码：dep:<模块id> / cap:<能力名> */
export type BlockedReason = string | null;

export class ModuleRegistry {
  private entries = new Map<string, RegistryEntry>();
  private caps = new Set<string>();
  /** 设置页覆盖值（null = 配置尚未加载，各模块走 defaultEnabled） */
  private overrides: Record<string, boolean> | null = null;
  private seq = 0;

  // ── 内核能力 ──

  registerCapability(cap: string): void {
    this.caps.add(cap);
  }

  hasCapability(cap: string): boolean {
    return this.caps.has(cap);
  }

  // ── 注册表维护 ──

  /** 注册模块（同 id 重复注册 = 热替换，保留启用态与覆盖判定） */
  register(mod: LatexModule): void {
    if (!mod.id) {
      console.warn("[module] 拒绝注册：id 为空");
      return;
    }
    const prev = this.entries.get(mod.id);
    this.entries.set(mod.id, { mod, enabled: prev?.enabled ?? false, seq: this.seq++ });
    // 新注册模块立即按当前覆盖值落地（设置页打开前注册也能正确启停）
    if (!prev) this.applyOverride(mod.id);
  }

  unregister(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    if (e.enabled) {
      // 直接摘除（不经 disable 的被依赖校验：模块都没了，依赖检查无意义）
      this.entries.delete(id);
      this.safeCall(e.mod, "onModuleDisabled");
      bus.emit(BusEvents.moduleDisabled, { id: e.mod.id, name: e.mod.name });
      return;
    }
    this.entries.delete(id);
  }

  // ── 查询 ──

  get(id: string): LatexModule | null {
    return this.entries.get(id)?.mod ?? null;
  }

  isEnabled(id: string): boolean {
    return this.entries.get(id)?.enabled ?? false;
  }

  /** 全部模块（注册序）；设置页与 ModuleDock 消费 */
  list(): ModuleEntryView[] {
    return [...this.entries.values()]
      .sort((a, b) => a.seq - b.seq)
      .map((e) => ({
        id: e.mod.id,
        name: e.mod.name,
        version: e.mod.version,
        description: e.mod.description,
        enabled: e.enabled,
        blockedReason: this.blockedReason(e.mod),
      }));
  }

  /** 指定槽位中已启用且声明了组件的模块（ModuleDock 用） */
  listSlot(slot: LatexModule["slot"]): LatexModule[] {
    return [...this.entries.values()]
      .sort((a, b) => a.seq - b.seq)
      .filter((e) => e.enabled && e.mod.slot === slot && !!e.mod.component)
      .map((e) => e.mod);
  }

  /**
   * M1-8：全部「已启用且声明了自带视图」的模块视图（活动栏 / 视图菜单 / 侧栏渲染消费）。
   * 排序：先按 view.order（缺省排在内置视图之后），再按注册序，保证确定性。
   */
  listViews(): Array<{ module: LatexModule; view: ModuleViewDecl }> {
    return [...this.entries.values()]
      .sort((a, b) => a.seq - b.seq)
      .filter((e) => e.enabled && !!e.mod.view)
      .map((e) => ({ module: e.mod, view: e.mod.view as ModuleViewDecl }))
      .sort((a, b) => {
        const oa = a.view.order ?? Number.MAX_SAFE_INTEGER;
        const ob = b.view.order ?? Number.MAX_SAFE_INTEGER;
        return oa === ob ? 0 : oa - ob;
      });
  }

  /** 按视图 id 反查提供该视图的已启用模块（侧栏渲染用；null = 无模块提供） */
  viewModule(viewId: string): LatexModule | null {
    for (const e of this.entries.values()) {
      if (e.enabled && e.mod.view?.id === viewId) return e.mod;
    }
    return null;
  }

  // ── 启停 ──

  /** 启用；依赖/能力不满足返回 false（调用方据此提示） */
  enable(id: string): boolean {
    const e = this.entries.get(id);
    if (!e) return false;
    if (e.enabled) return true;
    const blocked = this.blockedReason(e.mod);
    if (blocked) {
      console.warn(`[module] 无法启用「${e.mod.name}」（${blocked}）`);
      return false;
    }
    e.enabled = true;
    this.safeCall(e.mod, "onModuleEnabled");
    bus.emit(BusEvents.moduleEnabled, { id: e.mod.id, name: e.mod.name });
    return true;
  }

  /** 停用；存在已启用的下游依赖模块时拒绝（返回 false） */
  disable(id: string): boolean {
    const e = this.entries.get(id);
    if (!e) return false;
    if (!e.enabled) return true;
    const dependents = [...this.entries.values()]
      .filter((x) => x.enabled && x.mod.deps?.includes(id))
      .map((x) => x.mod.name);
    if (dependents.length > 0) {
      console.warn(
        `[module] 无法停用「${e.mod.name}」：仍被 ${dependents.join("、")} 依赖`,
      );
      return false;
    }
    e.enabled = false;
    this.safeCall(e.mod, "onModuleDisabled");
    bus.emit(BusEvents.moduleDisabled, { id: e.mod.id, name: e.mod.name });
    return true;
  }

  toggle(id: string): boolean {
    return this.isEnabled(id) ? this.disable(id) : this.enable(id);
  }

  // ── 设置覆盖（AppSettings.modules → 注册表） ──

  /**
   * 写入设置页覆盖值并应用到全部已注册模块。
   * 与当前值相同则空转（避免重复启停事件）；map 缺省的键走模块 defaultEnabled。
   */
  setOverrides(map: Record<string, boolean> | null): void {
    if (sameMap(this.overrides, map)) return;
    this.overrides = map ? { ...map } : null;
    for (const id of this.entries.keys()) this.applyOverride(id);
  }

  /** 当前覆盖值快照（设置页读显用） */
  getOverrides(): Record<string, boolean> | null {
    return this.overrides ? { ...this.overrides } : null;
  }

  private applyOverride(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    const want = this.overrides?.[id] ?? e.mod.defaultEnabled ?? false;
    if (want === e.enabled) return;
    if (want) this.enable(id);
    else this.disable(id);
  }

  // ── 钩子派发 ──

  /**
   * 向全部已启用模块派发钩子（异常隔离，单模块失败不影响其他模块）。
   * 无负载钩子（onModuleEnabled/onModuleDisabled）不走此路径，由 safeCall 直接调用。
   */
  dispatch(hook: "onInsertSnippet" | "onCompileDone" | "onFileChanged", payload: unknown): void {
    const ctx = this.ctx();
    for (const e of [...this.entries.values()].sort((a, b) => a.seq - b.seq)) {
      if (!e.enabled) continue;
      const fn = e.mod.hooks?.[hook];
      if (!fn) continue;
      try {
        (fn as (a: unknown, c: ModuleContext) => void)(payload, ctx);
      } catch (err) {
        console.error(`[module] 「${e.mod.name}」钩子 ${String(hook)} 执行失败`, err);
      }
    }
  }

  // ── 模块上下文 ──

  private ctx(): ModuleContext {
    return { insertSnippet };
  }

  /** 无负载生命周期钩子（异常隔离 + 控制台留痕） */
  private safeCall(mod: LatexModule, hook: "onModuleEnabled" | "onModuleDisabled"): void {
    const fn = mod.hooks?.[hook];
    if (!fn) return;
    try {
      fn(this.ctx());
    } catch (err) {
      console.error(`[module] 「${mod.name}」钩子 ${hook} 执行失败`, err);
    }
  }

  /** 无法启用的原因；null = 可启用 */
  private blockedReason(mod: LatexModule): BlockedReason {
    for (const dep of mod.deps ?? []) {
      if (!this.isEnabled(dep)) return `dep:${dep}`;
    }
    for (const cap of mod.requires ?? []) {
      if (!this.hasCapability(cap)) return `cap:${cap}`;
    }
    return null;
  }
}

/** 向当前活动编辑器插入代码（替换选区）；模块 ctx.insertSnippet 与调试面板共用 */
export function insertSnippet(code: string): boolean {
  const view: EditorView | null = getActiveView();
  if (!view) {
    console.warn("[module] insertSnippet：无活动编辑器");
    return false;
  }
  view.dispatch(view.state.replaceSelection(code));
  view.focus();
  return true;
}

/** 语义别名：向活动编辑器插入文本（替换选区）；与 wrapSelection 配套构成工具条通用插入 API */
export const insertText = insertSnippet;

/**
 * 向当前活动编辑器插入代码，并把光标选区落在 (selFrom, selTo) 处（相对插入文本起点）。
 * R5 插入 figure 时用它把光标定位到空 \caption{} 内，用户直接键入标题。
 */
export function insertSnippetSelect(code: string, selFrom: number, selTo: number): boolean {
  const view: EditorView | null = getActiveView();
  if (!view) {
    console.warn("[module] insertSnippetSelect：无活动编辑器");
    return false;
  }
  const pos = view.state.selection.main.head;
  view.dispatch({
    changes: { from: pos, insert: code },
    selection: { anchor: pos + selFrom, head: pos + selTo },
  });
  view.focus();
  return true;
}

/**
 * 包裹选区（加粗/斜体/下划线等）：有选区则 prefix+选区+suffix 并重新选中内层文本；
 * 无选区则插入 prefix+suffix，光标置于两者之间。供编辑器快捷工具条调用。
 */
export function wrapSelection(prefix: string, suffix: string): boolean {
  const view: EditorView | null = getActiveView();
  if (!view) {
    console.warn("[module] wrapSelection：无活动编辑器");
    return false;
  }
  const { from, to } = view.state.selection.main;
  const sel = view.state.sliceDoc(from, to);
  const text = prefix + sel + suffix;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + prefix.length, head: from + prefix.length + sel.length },
  });
  view.focus();
  return true;
}

/** 浅比较两个字符串→布尔映射（setOverrides 空转判定） */
function sameMap(
  a: Record<string, boolean> | null,
  b: Record<string, boolean> | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a[k] === b[k]);
}

/** 总线桥接：内核/全局事件 → 模块钩子（App 根部挂一次；返回解绑） */
export function bindModuleBus(): () => void {
  const offCompile = bus.on(BusEvents.compileDone, (payload) => {
    moduleRegistry.dispatch("onCompileDone", payload);
  });
  const offFile = bus.on(BusEvents.fileChanged, (payload) => {
    moduleRegistry.dispatch("onFileChanged", payload);
  });
  return () => {
    offCompile();
    offFile();
  };
}

/** 全局单例（编辑壳与设置页共用一份注册表） */
export const moduleRegistry = new ModuleRegistry();

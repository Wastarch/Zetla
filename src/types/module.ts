// M1-1 · 功能模块协议类型（开发文档 §4.2 模块接口层落地）
// 与 Rust 无关（纯前端扩展层）；模块开关经 AppSettings.modules 持久化（见 types/settings.ts）

import type { ComponentType, LazyExoticComponent } from "react";
import type { CompileResult } from "./compile";

/** 模块 UI 挂载槽位（M1-1 仅接通 sidebar：侧栏底部；后续按需扩展） */
export type ModuleSlot = "sidebar";

/**
 * 模块自带侧栏视图声明（M1-8 协议扩展，向后兼容）。
 * 声明后：活动栏出现对应图标、菜单「视图」出现同名项、`Ctrl+B <n>` 可直达；
 * 视图 id 与内置视图共用同一命名空间（explorer/outline/math/references）。
 */
export interface ModuleViewDecl {
  /** 视图 id（建议与模块 id 同名，如 "table"） */
  id: string;
  /** 活动栏图标（index.html sprite 名，不含 "i-" 前缀） */
  icon: string;
  /** 活动栏 tooltip / 侧栏标题 */
  label: string;
  /** 快捷键提示，如 "Ctrl+B 5"（仅展示，不参与绑定） */
  hint?: string;
  /** 活动栏排序位次（同数字按注册序；缺省排在全部内置视图之后） */
  order?: number;
}

/** 模块运行上下文 —— 内核经 hooks 传给模块的能力集合 */
export interface ModuleContext {
  /** 向当前活动编辑器插入代码（替换当前选区）；无活动编辑器时返回 false */
  insertSnippet: (code: string) => boolean;
}

/** 模块能力钩子（全部可选；仅启用的模块会被派发） */
export interface ModuleHooks {
  /** 模块自行请求插入代码（如符号面板条目、图片 figure 生成） */
  onInsertSnippet?: (code: string, ctx: ModuleContext) => void;
  /** 编译完成介入（总线 compile:done；payload 见 types/compile.ts） */
  onCompileDone?: (result: CompileResult, ctx: ModuleContext) => void;
  /** 活动文件被外部改动（总线 file:changed；M1-5 接通推送） */
  onFileChanged?: (path: string, ctx: ModuleContext) => void;
  /** 本模块被启用（设置页开关 / 依赖就绪后自动启用） */
  onModuleEnabled?: (ctx: ModuleContext) => void;
  /** 本模块被停用 */
  onModuleDisabled?: (ctx: ModuleContext) => void;
}

/**
 * 功能模块声明（开发文档 §4.2）。
 * 接口向后兼容：新增字段必须可选；内核升级不破坏已注册模块。
 */
export interface LatexModule {
  /** 唯一 id（kebab-case，如 "symbol" / "diagram"）；设置页开关与配置持久化均以它为主键 */
  id: string;
  name: string;
  version: string;
  /** 设置页展示的说明（缺省只显示版本号） */
  description?: string;
  /** 依赖的内核能力（editor/compile/preview/project…）；不满足时无法启用 */
  requires?: string[];
  /** 依赖的其他模块 id；被依赖模块未启用时无法启用 */
  deps?: string[];
  /** 用户无覆盖记录时的默认启停（缺省 false） */
  defaultEnabled?: boolean;
  hooks?: ModuleHooks;
  /** 懒加载 UI 组件（React.lazy；与 slot 同时声明才会被挂载） */
  component?: LazyExoticComponent<ComponentType>;
  /** UI 挂载槽位（无 component = 纯钩子模块，不出现在界面） */
  slot?: ModuleSlot;
  /** 自带侧栏视图（M1-8）；声明后活动栏/视图菜单/快捷键自动接入，无需改内核硬编码 */
  view?: ModuleViewDecl;
}

/** 设置页/模块面板消费的运行时视图（registry.list() 产出） */
export interface ModuleEntryView {
  id: string;
  name: string;
  version: string;
  description?: string;
  /** 当前是否已启用（真实状态，非设置页草稿） */
  enabled: boolean;
  /**
   * 无法启用的原因（置灰 tooltip 用）：
   * "dep:<id>" = 依赖模块未启用；"cap:<id>" = 内核能力不满足
   */
  blockedReason: string | null;
}

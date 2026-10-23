// 事件通道封装 —— Rust → 前端（Tauri event）+ 前端内部总线事件名
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Rust 内核推送到前端的事件名（与 src-tauri 侧常量一致） */
export const RustEvents = {
  /** 编译进度 */
  compileProgress: "compile_progress",
  /** 编译完成 */
  compileFinished: "compile_finished",
  /** 项目目录文件增减（M0-9a，防抖后推送） */
  projectChanged: "project_changed",
  /** 文件被外部改动（notify） */
  fileChanged: "file_changed",
  /** 文档结构索引变更 */
  symbolsUpdated: "symbols_updated",
  /** TeX 自动安装进度（M0-15b） */
  texInstallProgress: "tex_install_progress",
  /** TeX 自动安装最终结果（M0-15b） */
  texInstallFinished: "tex_install_finished",
} as const;

/** 前端内部总线事件名（bus.emit/on，见 core/bus.ts） */
export const BusEvents = {
  compileProgress: "compile:progress",
  compileDone: "compile:done",
  fileChanged: "file:changed",
  symbolsUpdated: "symbols:updated",
  projectCreated: "project:created",
  moduleEnabled: "module:enabled",
  moduleDisabled: "module:disabled",
  editorGotoLine: "editor:goto-line",
} as const;

/**
 * 订阅 Rust 事件（类型安全包装）。
 * 返回取消订阅函数。
 */
export function onKernelEvent<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<UnlistenFn> {
  return listen<T>(event, (e) => handler(e.payload));
}

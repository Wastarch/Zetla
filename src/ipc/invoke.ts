// 类型安全 invoke 封装 —— 按域分组，签名与 Rust 命令一一对应
// 每新增一个 Tauri command，先在此补签名，再实现 Rust 端（类型即协议）
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  EntryKind,
  FileDoc,
  ProjectInfo,
  ProjectTree,
  TemplateManifest,
  TemplateMeta,
  TexDistInfo,
  TexError,
  WriteOptions,
} from "@/types";

/** 底层透传（未封装的命令临时入口） */
export function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(cmd, args);
}

// ── 环境/编译 ──────────────────────────────────────────────
export const compileApi = {
  detectTexDistribution: () => call<TexDistInfo>("detect_tex_distribution"),
  /** 开始编译（立即返回；进度/结果走 compile_progress / compile_finished 事件） */
  compileProject: (root: string, mainFile: string, engine: string) =>
    call<void>("compile_project", { root, mainFile, engine }),
  /** 取消当前编译（杀掉子进程） */
  cancelCompile: () => call<void>("cancel_compile"),
  /** M0-11：解析 .log → 结构化错误（编译结果已内联 errors，此入口供 M0-12 复用） */
  parseTexLog: (logPath: string) => call<TexError[]>("parse_tex_log", { logPath }),
};

// ── 模板 ──────────────────────────────────────────────────
export const templateApi = {
  listTemplates: () => call<TemplateMeta[]>("list_templates"),
  getTemplate: (id: string) => call<TemplateManifest>("get_template", { id }),
  createProject: (templateId: string, vars: Record<string, unknown>, targetPath: string) =>
    call<ProjectInfo>("create_project", { templateId, variables: vars, targetPath }),
  // M1（MVP 不做）：
  // importTemplate: (path: string) => call<TemplateMeta>("import_template", { path }),
};

// ── 项目/文档 ─────────────────────────────────────────────
export const projectApi = {
  scanProject: (path: string) => call<ProjectTree>("scan_project", { path }),
  /** 新建条目（M0-6），返回最终绝对路径 */
  createEntry: (path: string, kind: EntryKind) =>
    call<string>("create_entry", { path, kind }),
  removeEntry: (path: string) => call<void>("remove_entry", { path }),
  /** 重命名/移动（M0-6），返回新绝对路径 */
  renameEntry: (from: string, to: string) => call<string>("rename_entry", { from, to }),
  /** 复制文件/目录（M0-6 补充），返回新绝对路径；目标已存在会报错 */
  copyEntry: (from: string, to: string) => call<string>("copy_entry", { from, to }),
  readFile: (path: string) => call<FileDoc>("read_file", { path }),
  writeFile: (path: string, content: string, options?: WriteOptions) =>
    call<void>("write_file", { path, content, options }),
  revertFile: (path: string) => call<FileDoc>("revert_file", { path }),
  cleanAux: (path: string) => call<void>("clean_aux", { path }),
  /** M0-9a：监听项目根的文件增减（重复调用即换根） */
  watchProject: (root: string) => call<void>("watch_project", { root }),
  unwatchProject: () => call<void>("unwatch_project"),
};

// ── 应用配置 / 偏好设置（M0-14a）──────────────────────────
export const configApi = {
  loadAppConfig: () => call<AppSettings>("load_app_config"),
  saveAppConfig: (config: AppSettings) => call<void>("save_app_config", { config }),
};

// ── 基础设施（M0-1 验收用） ───────────────────────────────
export interface PingReply {
  msg: string;
  ts: number;
}

export const coreApi = {
  ping: () => call<PingReply>("ping"),
};

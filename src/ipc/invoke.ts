// 类型安全 invoke 封装 —— 按域分组，签名与 Rust 命令一一对应
// 每新增一个 Tauri command，先在此补签名，再实现 Rust 端（类型即协议）
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
  FileDoc,
  ProjectInfo,
  ProjectTree,
  TemplateManifest,
  TemplateMeta,
  TexDistInfo,
  WriteOptions,
} from "@/types";

/** 底层透传（未封装的命令临时入口） */
export function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(cmd, args);
}

// ── 环境/编译 ──────────────────────────────────────────────
export const compileApi = {
  detectTexDistribution: () => call<TexDistInfo>("detect_tex_distribution"),
  // M0-3b 实现：
  // compileProject: (root: string) => call<CompileHandle>("compile_project", { root }),
  // cancelCompile: (handle: string) => call<void>("cancel_compile", { handle }),
};

// ── 模板 ──────────────────────────────────────────────────
export const templateApi = {
  listTemplates: () => call<TemplateMeta[]>("list_templates"),
  getTemplate: (id: string) => call<TemplateManifest>("get_template", { id }),
  createProject: (templateId: string, vars: Record<string, unknown>, targetPath: string) =>
    call<ProjectInfo>("create_project", { templateId, variables: vars, targetPath }),
  // M0-4 实现：
  // importTemplate: (path: string) => call<TemplateMeta>("import_template", { path }),
};

// ── 项目/文档 ─────────────────────────────────────────────
export const projectApi = {
  scanProject: (path: string) => call<ProjectTree>("scan_project", { path }),
  readFile: (path: string) => call<FileDoc>("read_file", { path }),
  writeFile: (path: string, content: string, options?: WriteOptions) =>
    call<void>("write_file", { path, content, options }),
  revertFile: (path: string) => call<FileDoc>("revert_file", { path }),
  cleanAux: (path: string) => call<void>("clean_aux", { path }),
};

// ── 基础设施（M0-1 验收用） ───────────────────────────────
export interface PingReply {
  msg: string;
  ts: number;
}

export const coreApi = {
  ping: () => call<PingReply>("ping"),
};

// 项目/文档协议类型 —— 与 Rust src-tauri/src/{project,fsdoc}.rs 对齐

/** 文件读取结果（read_file / revert_file 返回） */
export interface FileDoc {
  content: string;
  /** 检测到的编码："utf-8" | "gbk" | ... */
  encoding: string;
  /** 换行符："lf" | "crlf" */
  eol: "lf" | "crlf";
}

/** 写文件选项 */
export interface WriteOptions {
  /** 指定编码（默认保持原编码/UTF-8） */
  encoding?: string;
  /** 指定换行符（默认保持原 EOL） */
  eol?: "lf" | "crlf";
}

/** 项目树节点 */
export interface ProjectNode {
  name: string;
  /** 绝对路径 */
  path: string;
  type: "dir" | "file";
  children?: ProjectNode[];
  /** 是否为识别出的主文件 */
  isMain?: boolean;
}

/** 项目目录变更事件负载（M0-9a，Rust 防抖后推送） */
export interface ProjectChanged {
  /** 发生变更的项目根 */
  root: string;
}

/** 文件外部改动事件负载（M1-9，notify 发现文件被修改后推送） */
export interface FileChanged {
  /** 被修改的文件绝对路径 */
  path: string;
  /** 改动类型（当前仅 "modified"） */
  kind: string;
}

/** 项目扫描结果 */
export interface ProjectTree {
  /** 项目根目录 */
  root: string;
  /** 主文件绝对路径（读 .ltex/config.json，回退启发式） */
  mainFile: string;
  /** 编译引擎（.ltex/config.json 的 engine，缺省 xelatex） */
  engine: string;
  /** 图片目录（R5 拖拽导入；.ltex/config.json 的 imageDir，缺省 "figure"；相对项目根） */
  imageDir?: string;
  nodes: ProjectNode[];
}

/** 图片导入结果（import_image / import_image_from_path 返回；与 Rust ImportImageResult 对齐） */
export interface ImportImageResult {
  /** 落盘后的绝对路径（前端算相对 .tex 目录路径用） */
  absPath: string;
  /** 相对项目根的路径，正斜杠，如 "figure/xxx.png"（仅用于回显/存储） */
  relRootPath: string;
  /** 去重后的最终文件名 */
  fileName: string;
}

/** 新建条目类型（create_entry.kind，M0-6） */
export type EntryKind = "tex" | "file" | "dir";

/** 项目信息（create_project 返回） */
export interface ProjectInfo {
  path: string;
  name: string;
  templateId: string;
  engine: string;
  mainFile: string;
  outputDir: string;
}

/** .ltex/config.json（项目权威入口） */
export interface ProjectConfig {
  engine?: string;
  mainFile?: string;
  outputDir?: string;
  templateId?: string;
  /** 模块开关 */
  modules?: Record<string, boolean>;
  /** 图片目录（R5 拖拽导入用，不写死 figures/） */
  imageDir?: string;
  /** 项目显示名（默认取目录名；M1-15a） */
  name?: string;
  /** 项目描述（M1-15c 设置面板） */
  description?: string;
  /** 项目类型（M1-15c 设置面板） */
  projectType?: "article" | "thesis" | "beamer" | "resume" | "custom";
  /** 资源管理器树过滤（glob；M1-15c 设置面板） */
  exclude?: string[];
}

/**
 * 最近项目注册表条目（M1-15a，与 Rust AppConfig.recent_projects 对齐）
 * path 即 projectId（绝对路径）
 */
export interface ProjectEntry {
  /** 项目根绝对路径（= projectId） */
  path: string;
  /** 展示名（可由 .ltex/config.json 的 name 覆盖，缺省取目录名） */
  name: string;
  /** 模板 id（来自 .ltex/config.json 的 templateId；无则 null） */
  templateId?: string | null;
  /** 置顶 */
  pinned: boolean;
  /** 归档（不移动/删除目录，仅欢迎页分组） */
  archived: boolean;
  /** 最近一次打开时间（ISO-8601；无则 null） */
  lastOpened?: string | null;
}

// 模板协议类型 —— 与 Rust src-tauri/src/template.rs 的 struct 一一对应
// manifest JSON 为 camelCase，Rust 端需 #[serde(rename_all = "camelCase")]

/** 变量类型，对应 Rust VarType 枚举（lowercase） */
export type TemplateVarType =
  | "string"
  | "text"
  | "select"
  | "multiselect"
  | "bool"
  | "number"
  | "date";

/** build 段：编译配置 */
export interface BuildConfig {
  /** 引擎：xelatex / pdflatex / lualatex */
  engine: string;
  /** 主文件（编译入口），如 "main.tex" */
  mainFile: string;
  /** 产物目录（aux/pdf/log），默认 "build" */
  outputDir: string;
  /** 是否启用源码↔PDF 同步 */
  synctex: boolean;
}

/** dependencies 段：系统宏包与随包资源 */
export interface Dependencies {
  /** 声明的系统宏包（环境检测/缺失提示用） */
  packages: string[];
  /** 随模板打包、需原样复制的 cls/sty/资源 */
  assets: string[];
}

/** 表单变量定义 */
export interface TemplateVar {
  key: string;
  label: string;
  type: TemplateVarType;
  required?: boolean;
  default?: unknown;
  options?: string[];
  /** P1：表单条件显示（其他变量为真时才显示） */
  when?: string;
  /** 变量分组（向导表单分节展示） */
  group?: string;
  placeholder?: string;
  help?: string;
}

/** 单个生成文件的规格 */
export interface FileSpec {
  /** 项目内路径 */
  target: string;
  /** 模板包内路径 */
  source: string;
  /** 是否用变量渲染（false 则原样复制），默认 true */
  render?: boolean;
  /** P1：变量为真才生成 */
  condition?: string;
}

/** structure 段：项目结构 */
export interface Structure {
  /** 需创建的空目录 */
  dirs?: string[];
  files: FileSpec[];
}

/** 完整模板清单（manifest.json） */
export interface TemplateManifest {
  schemaVersion: string;
  id: string;
  name: string;
  description?: string;
  /** 自由字符串标签（thesis/resume/slides...），内核不据此分支 */
  category?: string;
  tags?: string[];
  version?: string;
  build: BuildConfig;
  dependencies?: Dependencies;
  variables?: TemplateVar[];
  structure: Structure;
}

/** 列表展示用的精简元数据（list_templates 返回） */
export interface TemplateMeta {
  id: string;
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
  version?: string;
}

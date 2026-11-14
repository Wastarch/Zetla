// M2 · 图片插入 TikZ · P2：暂存图「转正判据」的纯逻辑（无 DOM / Tauri / React / store）。
//
// 决策 8（docs/dev/绘图模块/绘图模块-图片插入切片计划.md §2.2）：
//   保留与否绑定「主文档最终写入的 \includegraphics 路径」，而不是「点过插入按钮」这个动作。
//   · TikZ 源码模式 → 插入的是整段 tikzpicture，里面的 figure/x.png 就是暂存源图 → 命中转正；
//   · 导出并插入模式 → 插入的是 figure/diagram.png 成品，源图已烘焙进去 → 不命中，留待清理；
//   · 仅保存文件 → 不写主文档 → 全部留待清理。
//
// 决策 9①：路径解析不到（宏拼接 / 绝对路径 / 跨行 / 特殊字符）时**默认保留**，
//   宁留勿删 —— 这里把 uncertain 置真，并把全部暂存图一起加进待转正列表。
//
// 路径比对最终交给 Rust 的 fs::canonicalize 完成（吸收 Windows 盘符 / 大小写、
// macOS NFD、符号链接差异）；这里只负责把插入代码里的相对路径折算成绝对路径。
import { resolveImagePath } from "./imageRefs.ts";

/** 与 imageRefs.ts 同款：只认 \includegraphics 的 {必选参数}，[opt] 允许跨行 */
const REF_RE = /\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g;

export interface PromotionInput {
  /** 刚写入主文档的代码文本（TikZ 片段或 figure 环境） */
  insertedCode: string;
  /** 目标 .tex 所在目录：\includegraphics 相对路径的基准 */
  texDir: string;
  /** 项目根（越界校验基准） */
  root: string;
  /** manifest 里当前仍属暂存的绝对路径 */
  stagedPaths: readonly string[];
}

export interface PromotionPlan {
  /** 交给 Rust promote_staged_images 的绝对路径列表 */
  pathsToPromote: string[];
  /** 存在无法解析的引用 → 走「默认保留」保守分支 */
  uncertain: boolean;
  /** 成功折算出的绝对路径（调试 / 日志用） */
  resolved: string[];
  skipped: { path: string; reason: string }[];
}

/** 解析插入代码，产出待转正路径。一次性快照，不做持续扫描。 */
export function planPromotion(input: PromotionInput): PromotionPlan {
  const { insertedCode, texDir, root, stagedPaths } = input;
  const resolved: string[] = [];
  const skipped: { path: string; reason: string }[] = [];
  let uncertain = false;

  REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_RE.exec(insertedCode)) !== null) {
    const raw = m[1];
    const hit = resolveImagePath(texDir, root, raw);
    if ("reason" in hit) {
      skipped.push({ path: raw.trim(), reason: hit.reason });
      // 宏拼接 / 绝对路径 / 特殊字符：无法确认是否指向某张暂存图 → 保守全保留
      uncertain = true;
      continue;
    }
    if (!resolved.includes(hit.abs)) resolved.push(hit.abs);
  }

  // 解析不到就默认保留：把全部暂存图一并转正，绝不因解析失败而清理
  const pathsToPromote = uncertain
    ? [...resolved, ...stagedPaths]
    : [...resolved];
  // 去重（stagedPaths 与 resolved 可能指向同一文件）
  return {
    pathsToPromote: Array.from(new Set(pathsToPromote)),
    uncertain,
    resolved,
    skipped,
  };
}

/** 决策 9②：Tab 仍开且源码仍含图片节点时，image 模式的清理延后到关 Tab。 */
export function hasImageRefs(source: string): boolean {
  return /\\includegraphics\b/.test(source);
}

/**
 * 路径比较键（仅用于前端「同名是否已由本会话暂存」的粗判）。
 * Windows canonicalize 会带 `\\?\` 前缀，须先剥掉；macOS / Linux 保持大小写敏感。
 */
export function stagingPathKey(p: string): string {
  const n = p
    .replace(/\\/g, "/")
    .normalize("NFC")
    .replace(/^\/\/\?\//, "")
    .replace(/\/+$/, "");
  const win = /^[A-Za-z]:\//.test(n) || n.startsWith("//");
  return win ? n.toLowerCase() : n;
}

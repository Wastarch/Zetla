// 项目树拖拽移动/复制的纯逻辑（无 React / zustand 依赖，可由 Node 单测直接覆盖）
// 路径比较统一走 pathKey：Windows 事件/树节点可能混用 / 与 \，且大小写不敏感。

export type TreeDropMode = "move" | "copy";

export type TreeDropKind = "dir" | "file" | "blank";

export interface TreeDropHit {
  path: string;
  kind: TreeDropKind;
}

/** 路径归一：反斜杠转正斜杠、去尾分隔、去 UNC 前缀、小写（仅用于比较） */
export function pathKey(p: string): string {
  let s = p.replace(/\\/g, "/");
  if (s.startsWith("//?/")) s = s.slice(4);
  s = s.replace(/\/+$/, "");
  return s.toLowerCase();
}

/** p 是否就是 dir 或位于 dir 之下（目录拖入自身/子目录要拒绝） */
export function isSameOrInside(p: string, dir: string): boolean {
  const child = pathKey(p);
  const parent = pathKey(dir);
  return child === parent || child.startsWith(`${parent}/`);
}

/** 取父目录（与 useProject.parentOf 同口径，此处独立实现便于纯逻辑测试） */
export function parentDir(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(0, i) : "";
}

/**
 * 落点行 → 目标目录：目录行即自身；文件行取其父目录；空白区取项目根。
 * 这样拖到文件上也等价于「放进它所在的目录」，与 VSCode 一致。
 */
export function resolveDropDir(hit: TreeDropHit | null, root: string): string {
  if (!hit || hit.kind === "blank") return root;
  if (hit.kind === "dir") return hit.path;
  return parentDir(hit.path) || root;
}

/**
 * 复制冲突时自动生成不重名的新名字：`a.tex` → `a - 副本.tex` → `a - 副本2.tex`。
 * taken 是目标目录下现有条目名（大小写不敏感）。
 */
export function uniqueCopyName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 2; ; i++) {
    const candidate = `${stem} - 副本${i === 2 ? "" : i - 1}${ext}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * 拖拽前置校验：返回不可执行的原因，null 表示可以落。
 * - 目录不能拖进自己/自己的子目录（移动、复制都禁止，复制会造成无限套娃）
 * - 移动时目标目录就是源父目录 → 原地不动
 */
export function dropProblem(
  src: string,
  targetDir: string,
  mode: TreeDropMode,
  isDir: boolean,
): string | null {
  if (isDir && isSameOrInside(targetDir, src)) {
    return "不能把文件夹放进它自己或它的子目录";
  }
  if (mode === "move" && pathKey(targetDir) === pathKey(parentDir(src))) {
    return "文件已经在这个目录下";
  }
  return null;
}

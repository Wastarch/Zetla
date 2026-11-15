// R5 路径工具（M1-7）—— 计算相对路径与生成 slug
// 这些函数纯同步、平台无关，便于单元测试与在编辑器插入时使用。

/**
 * 用正斜杠拼接路径段（兼容 Windows 反斜杠输入 / 重复斜杠），
 * 用于以「前端同源 root」构造绝对路径，避免跨进程（Rust abs_path）表示差异。
 */
export function joinAbs(...parts: string[]): string {
  const cleaned = parts.map((p) => p.replace(/[\\/]+$/, "")).filter((p) => p.length > 0);
  return cleaned.join("/").replace(/[\\/]+/g, "/");
}

/** 把路径拆成段（兼容 Windows / 的反斜杠与正斜杠），丢弃空段 */
function segments(p: string): string[] {
  return p.split(/[\\/]+/).filter((s) => s.length > 0);
}

/**
 * 段等价判断：Mac 上项目根与当前 .tex 路径常因「大小写不敏感」「NFD/NFC 文件名」
 * 表示不一致（同源但字符串不同），严格 === 会让公共前缀提前分叉、多算 ../。
 * 这里只对「匹配判断」做 NFC 归一 + 小写折叠，输出仍用 toFile 原始段（保留真实大小写，
 * 因为 \includegraphics 在大小写敏感 FS 上必须用磁盘真实文件名）。
 */
function segEq(a: string, b: string): boolean {
  return a.normalize("NFC").toLowerCase() === b.normalize("NFC").toLowerCase();
}

/**
 * 计算 `toFile` 相对 `fromDir` 的路径，统一用正斜杠（LaTeX \includegraphics 要求）。
 * 例：fromDir="a/b" toFile="a/c/x.png" → "../c/x.png"；同目录 → "x.png"。
 */
export function relativePath(fromDir: string, toFile: string): string {
  const from = segments(fromDir);
  const to = segments(toFile);
  let i = 0;
  while (i < from.length && i < to.length && segEq(from[i]!, to[i]!)) i++;
  const up = from.length - i;
  const back = to.slice(i);
  const parts = [...Array<string>(up).fill(".."), ...back];
  return parts.join("/");
}

/** 文件名去扩展名后转 ASCII 友好 slug（空格/点/下划线/连字符归一为 -，仅小写 ASCII 字母） */
export function slugify(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, ""); // 去扩展名
  return base
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[._]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/[A-Z]/g, (c) => c.toLowerCase()); // 仅小写 ASCII，保留非 ASCII
}

// R5 路径工具（M1-7）—— 计算相对路径与生成 slug
// 这些函数纯同步、平台无关，便于单元测试与在编辑器插入时使用。

/** 把路径拆成段（兼容 Windows / 的反斜杠与正斜杠），丢弃空段 */
function segments(p: string): string[] {
  return p.split(/[\\/]+/).filter((s) => s.length > 0);
}

/**
 * 计算 `toFile` 相对 `fromDir` 的路径，统一用正斜杠（LaTeX \includegraphics 要求）。
 * 例：fromDir="a/b" toFile="a/c/x.png" → "../c/x.png"；同目录 → "x.png"。
 */
export function relativePath(fromDir: string, toFile: string): string {
  const from = segments(fromDir);
  const to = segments(toFile);
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
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

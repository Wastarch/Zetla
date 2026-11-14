// M2 · 图片插入 TikZ · P1：\includegraphics 路径 → token 映射（纯逻辑）。
//
// 背景：片段编译发生在系统临时目录，xelatex 的 CWD 就是它，源码里的相对图片路径
// （相对主文档目录）在那里必然 File not found。这里把「派发给 Rust 的源码副本」里的
// 路径换成短 token，同时给出 token → 真实绝对路径的映射表；CM6 里的源码一字不改。
//
// 硬约束：
//  · 只替换 {path} 参数本身，且路径参数不得含换行 —— 保证行数不增不减，
//    preamble_lines 的 log 行号映射仍然精确；
//  · 只收相对 texDir（主文档所在目录）的路径，绝对路径 / 宏拼接一律跳过；
//  · 只允许落在项目根内、扩展名 png/jpg/jpeg/pdf 的文件；
//  · 解析不了就跳过并记进 skipped（保守：宁可让 LaTeX 明确报 File not found，
//    也不猜一个可能指向项目外的文件）。
//
// 无 DOM / Tauri / React / store 依赖，Node --experimental-strip-types 可直测。
// 只用 import type（strip-types 会整条擦除，不会触发 @/ 别名解析），与 previewCache 同例。
import type { TikzImageAsset } from "@/types/diagram";

export interface SkippedImageRef {
  path: string;
  reason: string;
}

export interface PreparedImageSource {
  /** 行内替换后的源码副本，仅用于 IPC；行数与原 source 完全一致 */
  sourceWithTokens: string;
  assets: TikzImageAsset[];
  skipped: SkippedImageRef[];
}

/** P0 实测：-no-shell-escape 下 XeLaTeX 能直接吃这四种；SVG 需 svg 宏包 + shell-escape */
const ASSET_EXTS = new Set(["png", "jpg", "jpeg", "pdf"]);

/** 只认 \includegraphics 的 {必选参数}；[opt] 允许跨行（不会被替换，故不影响行数） */
const REF_RE = /\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g;

/** 路径参数里允许的字符：Unicode 字母/数字 + 路径分隔符/点/下划线/连字符。
 *  空格、%、#、$、&、^、~、+、反斜杠都不收 —— 它们要么是 TeX 特殊字符，
 *  要么需要 grffile/detokenize 才能用，或可能是宏拼接（\imgdir/...）。 */
const SAFE_PATH_RE = /^[\p{L}\p{N}/._-]+$/u;

/** FNV-1a 双通道 → 12 位十六进制。确定性、零依赖、无需 Web Crypto 的异步 API。
 *  仅用于生成短文件名与缓存签名，不是加密 hash。 */
export function shortHash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b);
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, "0") +
    (h2 >>> 0).toString(16).padStart(8, "0").slice(0, 4)
  );
}

interface AbsPath {
  /** "e:/" | "/" | "//server/share/" | ""（相对路径） */
  prefix: string;
  segs: string[];
}

/** 统一正斜杠 + NFC（macOS APFS 的 NFD 文件名）+ Windows 盘符小写，便于跨端比较 */
function normalizeText(p: string): string {
  return p.replace(/\\/g, "/").normalize("NFC");
}

function parseAbs(p: string): AbsPath {
  const n = normalizeText(p);
  // UNC：//server/share/...（前两段属于根，不参与 .. 折叠）
  if (n.startsWith("//")) {
    const parts = n.split("/").filter(Boolean);
    return { prefix: `//${parts.slice(0, 2).join("/")}/`, segs: parts.slice(2) };
  }
  // Windows 盘符：E:/...（盘符小写，抵消大小写不敏感）
  const drive = n.match(/^([A-Za-z]):\/(.*)$/);
  if (drive) {
    return { prefix: `${drive[1].toLowerCase()}:/`, segs: drive[2].split("/").filter(Boolean) };
  }
  if (n.startsWith("/")) {
    return { prefix: "/", segs: n.split("/").filter(Boolean) };
  }
  return { prefix: "", segs: n.split("/").filter((s) => s.length > 0 && s !== ".") };
}

function absToString(a: AbsPath): string {
  return a.prefix + a.segs.join("/");
}

/** 折叠 ..；越出根则返回 null */
function foldDots(segs: string[]): string[] | null {
  const out: string[] = [];
  for (const s of segs) {
    if (s === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else if (s !== "." && s.length > 0) {
      out.push(s.normalize("NFC"));
    }
  }
  return out;
}

/** 相对路径 → 绝对路径（规范字符串）。只接受相对 texDir 的路径。 */
export function resolveImagePath(
  texDir: string,
  root: string,
  rel: string,
): { abs: string } | { reason: string } {
  if (!root.trim()) return { reason: "未打开项目，无法解析图片路径" };
  // 必须在 trim 之前查换行：trim 会把首尾换行吃掉，让「跨行参数」看起来是合法单行路径，
  // 结果替换成 token 后少了几行，preamble_lines 的行号映射就会整体漂移。
  if (rel.includes("\n") || rel.includes("\r")) {
    return { reason: "路径参数跨行（替换会改变行数）" };
  }
  const t = rel.trim();
  if (!t) return { reason: "空路径" };
  if (t.startsWith("/") || /^[A-Za-z]:\//.test(t)) {
    return { reason: "不支持绝对路径图片引用（请用相对主文档目录的路径）" };
  }
  if (!SAFE_PATH_RE.test(t)) {
    return { reason: "路径含 TeX 特殊字符 / 空格 / 反斜杠（请改用正斜杠）" };
  }

  const base = parseAbs(texDir || root);
  if (!base.prefix) return { reason: "目标文档目录不是绝对路径" };
  const rootAbs = parseAbs(root);
  if (!rootAbs.prefix) return { reason: "项目根不是绝对路径" };
  const rootNorm = absToString({ ...rootAbs, segs: foldDots(rootAbs.segs) ?? [] });
  const baseSegs = foldDots(base.segs);
  if (!baseSegs) return { reason: "目标文档目录含越界的 .." };

  // .. 必须相对「基准目录」折叠，不能对相对路径单独折叠（否则合法上跳会被误判越界）。
  const relParts = t.split("/").filter((s) => s.length > 0 && s !== ".");
  if (relParts.length === 0) return { reason: "路径折叠后为空 / 越界" };
  const merged = foldDots([...baseSegs, ...relParts]);
  if (!merged || merged.length === 0) return { reason: "路径折叠后为空 / 越界" };
  const absNorm = absToString({ prefix: base.prefix, segs: merged });

  // 越界校验：绝对路径必须等于项目根或落在它下面。Windows 大小写不敏感 → 比较时
  // 双端小写化；但输出保留真实大小写（Rust 侧还要 canonicalize，macOS 大小写敏感）。
  const isWin = /^[a-z]:\//.test(base.prefix) || base.prefix.startsWith("//");
  const cmp = (s: string) => (isWin ? s.toLowerCase() : s);
  const a = cmp(absNorm);
  const r = cmp(rootNorm);
  const rootPrefix = r.endsWith("/") ? r : `${r}/`;
  if (a !== r && !a.startsWith(rootPrefix)) {
    return { reason: "图片路径越出项目根" };
  }

  const ext = merged[merged.length - 1].split(".").pop()?.toLowerCase() ?? "";
  if (!ASSET_EXTS.has(ext)) return { reason: `不支持的图片格式 .${ext || "?"}` };
  return { abs: absNorm };
}

/**
 * 扫描源码里的 \includegraphics 引用，产出「带 token 的派生源码 + 资源表」。
 * 同一真实路径多处引用只生成一个 asset、复用同一个 token。
 */
export function scanImageRefs(
  source: string,
  texDir: string,
  root: string,
): PreparedImageSource {
  const assets: TikzImageAsset[] = [];
  const byAbs = new Map<string, string>();
  const skipped: SkippedImageRef[] = [];
  const edits: { start: number; end: number; text: string }[] = [];

  REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_RE.exec(source)) !== null) {
    const raw = m[1];
    const resolved = resolveImagePath(texDir, root, raw);
    if ("reason" in resolved) {
      skipped.push({ path: raw.trim(), reason: resolved.reason });
      continue;
    }
    const { abs } = resolved;
    let token = byAbs.get(abs);
    if (!token) {
      const ext = abs.split(".").pop()?.toLowerCase() ?? "png";
      token = `zetla-img-${shortHash(abs)}.${ext}`;
      byAbs.set(abs, token);
      assets.push({ token, realPath: abs });
    }
    // 只替换 { } 内的路径文本；token 不含换行 ⇒ 行数不变
    const braceOpen = m.index + m[0].lastIndexOf("{") + 1;
    edits.push({ start: braceOpen, end: braceOpen + raw.length, text: token });
  }

  let sourceWithTokens = source;
  for (let i = edits.length - 1; i >= 0; i -= 1) {
    const e = edits[i];
    sourceWithTokens = sourceWithTokens.slice(0, e.start) + e.text + sourceWithTokens.slice(e.end);
  }
  return { sourceWithTokens, assets, skipped };
}

/** 预览缓存签名：资源表变化（换图 / 增删引用）时 key 必须变，否则命中旧预览。
 *  注意：同一路径下文件内容被替换时签名不变 —— 需「手动重编译」或后续补内容 hash。 */
export function assetSignature(assets: readonly TikzImageAsset[]): string {
  if (assets.length === 0) return "";
  const joined = assets
    .map((a) => `${a.token}:${a.realPath}`)
    .sort()
    .join("|");
  return shortHash(joined);
}

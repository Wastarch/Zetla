// 外部文件改动 → 已打开标签自动重载的纯判断逻辑（无 store / Tauri 依赖，Node 可直测）
// 相对 import 带 .ts 后缀，供 node --experimental-strip-types 直接跑测试。
import { pathKey } from "../modules/zotero/zoteroSync.ts";

/**
 * 比较文本时忽略换行风格：CM 缓冲内部用 LF，磁盘可能是 CRLF
 * （useBuffers.saveBuffer 的回读校验也承认 `content === written.replace(/\n/g,"\r\n")`）。
 * 自身保存到 CRLF 文件后 notify 会回显 file_changed，不做归一化会被误判成外部改动，
 * 白白重载一次文档并重置 CM 撤销栈。
 */
export function sameTextIgnoringEol(a: string, b: string): boolean {
  return a.replace(/\r\n/g, "\n") === b.replace(/\r\n/g, "\n");
}

/** 匹配所需的最小缓冲画像（避免测试引入 useBuffers store） */
export interface ExternalReloadCandidate {
  path: string;
  kind: string;
  content: string;
  savedContent: string;
}

/**
 * 这条 file_changed 事件是否值得重载该缓冲。
 * - 只处理文本标签（图片/PDF/伪 buffer 由各自机制管理）；
 * - 路径按 pathKey 归一比较（Rust 事件可能是反斜杠 / verbatim 前缀，缓冲 path 写法可能不同）；
 * - 有未保存改动的缓冲绝不自动覆盖（用户工作优先，保持既有 P1-5 口径）。
 */
export function shouldReloadOnExternalChange(
  buf: ExternalReloadCandidate,
  eventPath: string,
): boolean {
  if (buf.kind !== "text") return false;
  if (pathKey(buf.path) !== pathKey(eventPath)) return false;
  if (buf.content !== buf.savedContent) return false;
  return true;
}

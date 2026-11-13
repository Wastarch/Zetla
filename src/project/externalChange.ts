/** 外部文件变化判断所需的磁盘快照。 */
export interface DiskDocumentSnapshot {
  content: string;
  encoding: string;
  eol: "lf" | "crlf";
}

/** 编辑器中用于识别磁盘版本的最小状态。 */
export interface EditorDiskState extends DiskDocumentSnapshot {
  savedContent: string;
}

/** 比较磁盘与编辑器文本时忽略平台换行符差异，避免自身保存 CRLF 文件后误报。 */
function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** 文件格式标签统一后再比较，避免 UTF-8/utf-8 这类大小写差异。 */
function normalizeEncoding(encoding: string): string {
  return encoding.trim().toLowerCase();
}

/**
 * 只有磁盘版本既不等于上次保存基线、也不等于当前编辑内容时，才需要提醒。
 * 后者避免外部工具恰好写入了与当前缓冲一致的内容时出现无意义的重载提示。
 */
export function hasMeaningfulExternalChange(
  doc: DiskDocumentSnapshot,
  buffer: EditorDiskState,
): boolean {
  const sameFormat =
    doc.eol === buffer.eol &&
    normalizeEncoding(doc.encoding) === normalizeEncoding(buffer.encoding);
  const diskText = normalizeEol(doc.content);
  const matchesSaved = sameFormat && diskText === normalizeEol(buffer.savedContent);
  const matchesCurrent = sameFormat && diskText === normalizeEol(buffer.content);
  return !matchesSaved && !matchesCurrent;
}

/** 保存完成会改变这些字段；异步读盘期间基线变化时，旧读取结果必须作废。 */
export function savedBaselineKey(buffer: EditorDiskState): string {
  return `${buffer.eol}\u0000${normalizeEncoding(buffer.encoding)}\u0000${normalizeEol(
    buffer.savedContent,
  )}`;
}

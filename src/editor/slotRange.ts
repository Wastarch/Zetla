// M1-11 · \Box 槽位协议（纯函数，无框架依赖）
// 空槽占位符协议：空槽序列化为 \Box（LaTeX 内核命令「空心方框」，编译合法、罕见、易扫描）。
// 编辑器装饰/点击命中/Tab 跳转（mathSlots.ts）与公式树序列化（builderTypes.ts）共用此协议。

/** 空槽占位符 */
export const SLOT_MARK = "\\Box";
/** 占位符匹配（后不接字母，避免误中 \Boxfoo 之类自定义命令） */
export const SLOT_RE = /\\Box(?![a-zA-Z])/g;

/**
 * 文档文本中覆盖 pos 的 \Box 范围（点击命中判定与单测共用）。
 * 右缘（pos == to）不命中——归下一个字符，避免误拦截相邻文本点击。
 */
export function slotRangeAtDoc(
  doc: string,
  pos: number,
): { from: number; to: number } | null {
  SLOT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SLOT_RE.exec(doc)) !== null) {
    const from = m.index;
    const to = from + SLOT_MARK.length;
    if (pos >= from && pos < to) return { from, to };
    if (from > pos) break; // 后续匹配均在 pos 之后
  }
  return null;
}

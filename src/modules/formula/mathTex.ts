// M1-12a · 编写区文本的槽位预览协议（文本版 serializeSlots，纯函数无框架依赖）
// 与 builderTypes.serializeSlots 同一协议：\Box → slotCmd(i) 纯字母命令，
// KaTeX 宽容渲染为红字原文，FormulaKaTeX.injectSlots 按出现序替换为可点选方框。
import { SLOT_RE } from "@/editor/slotRange";
import { slotCmd } from "./slotCmd";

/**
 * 编写区文本 → 预览 tex（\Box → slotCmd(i)）+ 同序槽位 id（box-0/box-1…）。
 * tex 中第 i 个 \z 命令必对应 slotIds[i]（出现序一致）。
 */
export function serializeSlotsText(text: string): { tex: string; slotIds: string[] } {
  const slotIds: string[] = [];
  let i = 0;
  const tex = text.replace(SLOT_RE, () => {
    slotIds.push(`box-${i}`);
    return slotCmd(i++);
  });
  return { tex, slotIds };
}

/** 第 index 个 \Box 在文本中的起始偏移（无则 -1） */
export function boxOffset(text: string, index: number): number {
  SLOT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = SLOT_RE.exec(text)) !== null) {
    if (i === index) return m.index;
    i += 1;
  }
  return -1;
}

/** 槽位 id → 序号（box-3 → 3；非本协议 id 返回 -1） */
export function slotIdIndex(id: string): number {
  const m = /^box-(\d+)$/.exec(id);
  return m ? Number(m[1]) : -1;
}

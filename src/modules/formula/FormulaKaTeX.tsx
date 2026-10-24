// M1-11 · 公式 KaTeX 渲染（搭建器预览 / 公式库列表预览共用）
// 口径：
// - throwOnError:false + strict:false：宽容渲染（未知命令红字原文，不抛异常中断面板）
// - display 类环境（align/gather/cases…）inline 下 KaTeX 报错 → 按内容自动切 displayMode
// - 安全：katex 默认 trust:false，\text{} 内 HTML 被转义（实测 <script> → &lt;script&gt;），
//   dangerouslySetInnerHTML 可用；用户自定义公式同受此约束
// - 渲染彻底失败（罕见）回退源码 <code>，保证信息不丢
//
// M1-11 追加（预览槽位点选，MathType 式）：
// 搭建器预览传入 slots（serializeSlots 的空槽 id 序列）——空槽在 tex 中为 \z+字母
// 未定义命令，KaTeX 宽容渲染输出红字原文 span；此处按出现序把红字 span 替换为
// .zetla-slot[data-slot] 节点（class/data-slot 精准定位，免视觉坐标排序——
// KaTeX HTML 层按布局序生成，frac 分母先于分子等，DOM 序 ≠ 语义序，不可依赖）。
import { useEffect, useMemo, useRef } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

/** display 类环境（inline 模式下 KaTeX 报 katex-error，需 displayMode） */
const DISPLAY_ENV_RE =
  /\\begin\{(align\*?|gather\*?|cases|multline\*?|flalign\*?|eqnarray\*?|CD|split|alignedat)/;

/** 该公式是否需 display 模式渲染（矩阵系列 inline 可渲染，不含在内） */
export function needsDisplayMode(tex: string): boolean {
  return DISPLAY_ENV_RE.test(tex);
}

/**
 * 空槽红字 span（与 builderTypes.slotCmd 协议对应）：
 * KaTeX 0.19 对未定义命令输出 <span class="mord text[ mtight]" style="color:#cc0000;">
 * 双层结构；frac 内部等紧凑场景带 mtight，故可选。实测 8 类布局全部命中。
 */
const SLOT_SPAN_RE =
  /<span class="mord text(?: mtight)?" style="color:#cc0000;"><span class="mord(?: mtight)?" style="color:#cc0000;">\\z[a-z]+<\/span><\/span>/g;

/**
 * HTML 字符串后处理：第 i 个空槽红字 span → 第 i 个槽位节点（slotIds[i]）。
 * 出现序即 serializeSlots 的 mark 调用序（= 空槽 DFS 序 = tex 中 \z 命令出现序）。
 * 找不到 id（越界，理论上不发生）时退化为不可点选的空心方框，不丢视觉。
 */
export function injectSlots(html: string, slotIds: string[]): string {
  if (slotIds.length === 0) return html;
  let i = 0;
  return html.replace(SLOT_SPAN_RE, () => {
    const id = slotIds[i++];
    return id
      ? `<span class="mord zetla-slot" data-slot="${id}">□</span>`
      : `<span class="mord">□</span>`;
  });
}

/**
 * 渲染一段 LaTeX 公式。
 * @param tex        公式内部片段（不含外层 $/环境包裹）
 * @param display    强制 display 模式；缺省按内容自动判定
 * @param strict     true=含 katex-error 时回退源码（列表预览用）；false=宽容渲染（编辑预览用）
 * @param slots      空槽 id 序列（serializeSlots 产出；预览点选用，列表预览不传）
 * @param activeSlot 当前活动槽 id（预览中对应方框高亮）
 * @param onSlotClick 点击预览中的空槽方框 → 选中该槽为活动槽
 */
export default function FormulaKaTeX({
  tex,
  display,
  strict = false,
  slots,
  activeSlot = null,
  onSlotClick,
}: {
  tex: string;
  display?: boolean;
  strict?: boolean;
  slots?: string[];
  activeSlot?: string | null;
  onSlotClick?: (id: string) => void;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);

  const html = useMemo(() => {
    try {
      const raw = katex.renderToString(tex, {
        displayMode: display ?? needsDisplayMode(tex),
        throwOnError: false,
        strict: false,
      });
      return slots && slots.length > 0 ? injectSlots(raw, slots) : raw;
    } catch {
      return null;
    }
  }, [tex, display, slots]);

  // 槽位点击绑定（innerHTML 重建后 DOM 是新的，每次重绑）
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !onSlotClick) return;
    const cleanups: (() => void)[] = [];
    host.querySelectorAll<HTMLElement>(".zetla-slot[data-slot]").forEach((n) => {
      const h = () => {
        const id = n.dataset.slot;
        if (id) onSlotClick(id);
      };
      n.addEventListener("click", h);
      cleanups.push(() => n.removeEventListener("click", h));
    });
    return () => cleanups.forEach((fn) => fn());
  }, [html, onSlotClick]);

  // 活动槽高亮（class 切换；null = 全部取消）
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.querySelectorAll<HTMLElement>(".zetla-slot").forEach((n) => {
      n.classList.toggle("is-active", n.dataset.slot === activeSlot);
    });
  }, [html, activeSlot]);

  // 彻底失败 → 源码兜底
  if (html === null) {
    return (
      <code className="fx fx-fallback" title={tex}>
        {tex}
      </code>
    );
  }
  // 列表预览（strict）：整段含错误标记时回退源码，避免红字撑爆行高
  if (strict && html.includes("katex-error")) {
    return (
      <code className="fx fx-fallback" title={tex}>
        {tex}
      </code>
    );
  }
  return (
    <span
      ref={hostRef}
      className="fx"
      title={tex}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

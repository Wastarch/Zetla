// M1-12b · 符号 tile 懒渲染（IntersectionObserver）
// 分类展开时若一次性 KaTeX 渲染几十个公式，会带来可见的首开/切换卡顿。
// 本组件把「是否真正调用 KaTeX」推迟到 tile 进入视口附近才发生；
// 视口外的 tile 仅保留轻量占位，显著压低首开与切换分类的开销。
// 复用 FormulaKaTeX（与公式预览同引擎、同字体），保证 tile = 预览 = 最终插入内容。
import { useEffect, useRef, useState } from "react";
import FormulaKaTeX from "@/modules/formula/FormulaKaTeX";

/** 视口外预渲染缓冲：提前 200px 触发，滚动时几乎无感知延迟 */
const ROOT_MARGIN = "200px 0px";
const THRESHOLD = 0.01;

export default function LazySymbolGlyph({ tex }: { tex: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el) return;
    // 环境不支持 IntersectionObserver 时直接渲染，保证可用性（降级路径）
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            io.disconnect();
            break;
          }
        }
      },
      { root: null, rootMargin: ROOT_MARGIN, threshold: THRESHOLD },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown, tex]);

  return (
    <span ref={ref} className={shown ? "symbol-glyph" : "symbol-glyph is-pending"}>
      {shown ? <FormulaKaTeX tex={tex} /> : null}
    </span>
  );
}

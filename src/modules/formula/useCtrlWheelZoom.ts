// M1-12 · 输入/输出区域 Ctrl+滚轮缩放（2026-10-25 用户反馈）
// React 的 onWheel 是 passive，无法 preventDefault → 必须原生监听（同编辑器/PDF 的做法）。
// - 仅在按住 Ctrl/⌘ 时拦截（避免 WebView 整页缩放）；松开 Ctrl 清掉残留累积
// - deltaY 累积阈值 100 ≈ 常规鼠标一格；触控板小位移也会平滑累积
// - 向上滚（deltaY<0）= 放大（dir=+1），向下滚 = 缩小（dir=-1）
import { useEffect, useRef } from "react";

export function useCtrlWheelZoom<T extends HTMLElement = HTMLDivElement>(
  onStep: (dir: 1 | -1) => void,
) {
  const ref = useRef<T | null>(null);
  const acc = useRef(0);
  // 回调最新化：不随回调变化重建监听
  const cb = useRef(onStep);
  cb.current = onStep;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const TH = 100;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) {
        acc.current = 0;
        return;
      }
      e.preventDefault();
      acc.current += e.deltaY;
      while (Math.abs(acc.current) >= TH) {
        cb.current(acc.current > 0 ? -1 : 1);
        acc.current -= Math.sign(acc.current) * TH;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return ref;
}

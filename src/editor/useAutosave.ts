// M0-14a · 定时自动保存（设置驱动）
// setTimeout 链（不重叠）：到达间隔 → 若允许（非编译中）且存在脏缓冲 → autosaveDirty 静默落盘 → 下一轮
// 设置（开关/间隔/编译暂停）即时生效；禁用时不挂计时器
import { useEffect } from "react";
import { useAppStore } from "@/core/store";
import { useSettingsStore } from "@/core/settings";
import { useBuffersStore } from "@/editor/useBuffers";

export function useAutosave(): void {
  const autosave = useSettingsStore((s) => s.settings.autosave);
  const loaded = useSettingsStore((s) => s.loaded);

  useEffect(() => {
    if (!loaded || !autosave.enabled) return;
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      if (cancelled) return;
      const st = useAppStore.getState();
      const paused = autosave.pauseWhileCompiling && st.compileStatus === "running";
      if (!paused) {
        await useBuffersStore.getState().autosaveDirty();
      }
      if (!cancelled) {
        timer = window.setTimeout(tick, autosave.intervalSeconds * 1000);
      }
    };
    timer = window.setTimeout(tick, autosave.intervalSeconds * 1000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [loaded, autosave.enabled, autosave.intervalSeconds, autosave.pauseWhileCompiling]);
}

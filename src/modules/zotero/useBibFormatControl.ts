// Zotero 联动 · P9/P11 · 参考文献格式切换控制（偏好设置页与引用侧栏共用同一底层）
//
// 两处 UI 都通过本 hook 读写同一配置键（.ltex/config.json:zoteroBibFormat）与 store.bibFormat：
// - auto / 与当前相同：只落配置，不动文件；
// - 具体格式且不同：生成预览 → 确认窗（P11：用户可勾选是否同步改主 .tex 导言区）→ 落笔。
import { useState } from "react";
import { zoteroApi } from "@/ipc/invoke";
import { useProjectStore } from "@/project/useProject";
import { type BibFormatSwitchPreview, previewBibFormatSwitch, reloadBibFormat, switchBibFormat } from "./zoteroRuntime";
import { useZoteroStore } from "./useZoteroStore";
import type { ConcreteBibFormat } from "./zoteroFormat";

export function useBibFormatControl() {
  const bibFormat = useZoteroStore((s) => s.bibFormat);
  const [preview, setPreview] = useState<BibFormatSwitchPreview | null>(null);
  const [busy, setBusy] = useState(false);
  /** P11：确认窗里的「同步修改导言区」勾选，默认开 */
  const [applyEngine, setApplyEngine] = useState(true);
  const [note, setNote] = useState("");

  const choose = (value: string) => {
    setNote("");
    if (value === "auto" || value === bibFormat.effective) {
      const projectRoot = useProjectStore.getState().root;
      if (!projectRoot) return;
      void (async () => {
        try {
          await zoteroApi.setBibFormat(projectRoot, value);
          await reloadBibFormat(projectRoot);
          setNote(value === "auto" ? "已改为跟随主 .tex 检测" : "格式未变化");
        } catch (e) {
          setNote(`保存失败：${String(e)}`);
        }
      })();
      return;
    }
    void (async () => {
      setBusy(true);
      try {
        setPreview(await previewBibFormatSwitch(value as ConcreteBibFormat));
        setApplyEngine(true);
      } catch (e) {
        setNote(`生成预览失败：${String(e)}`);
      } finally {
        setBusy(false);
      }
    })();
  };

  const confirm = () => {
    if (!preview) return;
    setBusy(true);
    void switchBibFormat(preview.target, applyEngine)
      .then((r) => setNote(r.message))
      .catch((e) => setNote(`切换失败：${String(e)}`))
      .finally(() => {
        setBusy(false);
        setPreview(null);
      });
  };

  return {
    bibFormat, preview, busy, applyEngine, setApplyEngine, note,
    choose, confirm, close: () => setPreview(null),
  };
}

// 全局 toast 宿主（M1-15d 上提）：notice 原渲染在 EditorWorkspace 内，
// 欢迎页（无项目/无缓冲）显示时 EditorWorkspace 未挂载 → 操作反馈不可见。
// `.toast-wrap` 为 position:fixed，故可安全挂到 App 根部，覆盖所有界面。
import { useEffect } from "react";
import { useBuffersStore } from "@/editor/useBuffers";

export function ToastHost() {
  const notice = useBuffersStore((s) => s.notice);
  const clearNotice = useBuffersStore((s) => s.clearNotice);

  // 自动消失（无论编辑器是否挂载都生效）
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => clearNotice(), 4500);
    return () => clearTimeout(t);
  }, [notice, clearNotice]);

  if (!notice) return null;
  return (
    <div className="toast-wrap">
      <div className={`toast ${notice.kind}`}>{notice.text}</div>
    </div>
  );
}

export default ToastHost;

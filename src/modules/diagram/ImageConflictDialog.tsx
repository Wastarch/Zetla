// M2 · 图片插入 TikZ · P2：同名冲突弹窗（结构参考拼图模块 FigureSidebar 的冲突弹窗）。
// 选项收敛为「重命名 / 覆盖」；覆盖既有用户文件在 placeStagedImage 里再做一次系统确认。
import { useState } from "react";
import type { StagingPolicy } from "./imageStaging";

export interface ImageConflictDialogProps {
  fileName: string;
  imageDir: string;
  /** 同名目标是否本会话自己暂存的（true 时不触发二次确认） */
  owned: boolean;
  onCancel: () => void;
  onChoose: (policy: StagingPolicy) => void;
}

export function ImageConflictDialog({
  fileName,
  imageDir,
  owned,
  onCancel,
  onChoose,
}: ImageConflictDialogProps) {
  const [policy, setPolicy] = useState<StagingPolicy>("rename");
  return (
    <div className="dg-modal-overlay" role="presentation">
      <div className="dg-modal" role="dialog" aria-modal="true" aria-label="同名文件">
        <div className="dg-modal-head">同名文件</div>
        <p className="dg-modal-sub">
          <code>{imageDir}/{fileName}</code> 已存在
        </p>
        <div className="dg-modal-radios">
          <label className={`dg-radio${policy === "rename" ? " is-on" : ""}`}>
            <input
              type="radio"
              name="dg-image-conflict"
              checked={policy === "rename"}
              onChange={() => setPolicy("rename")}
            />
            重命名（自动加 -1）
          </label>
          <label className={`dg-radio${policy === "overwrite" ? " is-on" : ""}`}>
            <input
              type="radio"
              name="dg-image-conflict"
              checked={policy === "overwrite"}
              onChange={() => setPolicy("overwrite")}
            />
            覆盖
          </label>
        </div>
        {policy === "overwrite" && !owned && (
          <p className="dg-modal-warn">原文件不可恢复，确定后需再确认一次</p>
        )}
        <div className="dg-modal-actions">
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => onChoose(policy)}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

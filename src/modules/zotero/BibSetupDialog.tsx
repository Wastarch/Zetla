// P11 · 新建 .bib 后「补齐引用环境」确认窗（全局挂载，消费 store.bibSetupPrompt）
//
// 触发：ensureBibEntries 判定目标库原为空/不存在并成功写入后设置 prompt。
// 只读预览主 .tex 的补丁 diff；确认后由 applyBibliographySetup 重读重算再落笔（可撤销）。
// 取消即清空状态，本轮不再提示；不自动重新编译。
import { useEffect, useState } from "react";
import { applyBibliographySetup, previewBibliographySetup } from "./zoteroStyleApply";
import { useZoteroStore } from "./useZoteroStore";
import type { BibliographySetupPlan } from "./zoteroFormat";

export function BibSetupDialog() {
  const prompt = useZoteroStore((s) => s.bibSetupPrompt);
  const setPrompt = useZoteroStore((s) => s.setBibSetupPrompt);
  const [preview, setPreview] = useState<{ file: string; plan: BibliographySetupPlan } | null>(null);
  const [busy, setBusy] = useState(false);

  // 弹窗出现后异步读盘生成预览（读失败只显示空 diff，仍可取消）
  useEffect(() => {
    if (!prompt) {
      setPreview(null);
      return;
    }
    let alive = true;
    void previewBibliographySetup(prompt.texPath, prompt.bibPath, prompt.format)
      .then((r) => {
        if (alive) setPreview({ file: r.path.split(/[\\/]/).pop() ?? r.path, plan: r.plan });
      })
      .catch(() => {
        if (alive) setPreview(null);
      });
    return () => {
      alive = false;
    };
  }, [prompt]);

  const close = () => {
    if (busy) return;
    setPrompt(null);
  };

  useEffect(() => {
    if (!prompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, busy]);

  const confirm = () => {
    if (!prompt || busy) return;
    setBusy(true);
    void applyBibliographySetup(prompt.texPath, prompt.bibPath, prompt.format)
      .catch(() => undefined)
      .finally(() => {
        setBusy(false);
        setPrompt(null);
      });
  };

  if (!prompt) return null;
  const plan = preview?.plan;
  const name = prompt.bibPath.split(/[\\/]/).pop() ?? prompt.bibPath;

  return (
    <div
      className="zo-style-layer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="zo-style-dialog" role="dialog" aria-label="配置参考文献引用环境">
        <div className="zo-style-title">已在项目中新建 {name}</div>
        <div className="zo-style-meta">
          <span>主文档</span>
          <span className="zo-style-dot">·</span>
          <span>{preview?.file ?? (prompt.texPath.split(/[\\/]/).pop() ?? prompt.texPath)}</span>
          <span className="zo-style-dot">·</span>
          <span>{prompt.format === "biblatex" ? "biblatex" : "BibTeX"} 引用环境</span>
        </div>

        <div className="zo-fmt-block">
          <b>将添加到导言区</b>
          {plan && !plan.noop && plan.after.length > 0 ? (
            <pre className="zo-style-diff">
              {plan.before.map((s, i) => (
                <span className="zo-style-old" key={`b${i}`}>{`- ${s}`}</span>
              ))}
              {plan.before.length > 0 && plan.after.length > 0 && "\n"}
              {plan.after.map((s, i) => (
                <span className="zo-style-new" key={`a${i}`}>{`+ ${s}`}</span>
              ))}
            </pre>
          ) : (
            <div className="zo-style-hint">
              {plan?.noop
                ? "主 .tex 已具备完整的参考文献环境，无需添加。"
                : "正在读取主 .tex 以生成补丁预览…"}
            </div>
          )}
        </div>

        <div className="zo-style-note">
          添加后 LaTeX 才能识别 <code>\cite</code> 并生成参考文献列表，消除「no \bibliography」提示。
          导言区改动可用 <kbd>Ctrl</kbd>+<kbd>Z</kbd> 撤销；不会自动重新编译，请确认后自行编译验证。
        </div>

        <div className="zo-style-actions">
          <button type="button" className="zo-style-cancel" onClick={close} disabled={busy}>
            暂不添加
          </button>
          <button
            type="button"
            className="zo-style-ok"
            onClick={confirm}
            disabled={busy || !plan || plan.noop}
          >
            {busy ? "添加中…" : "添加到导言区"}
          </button>
        </div>
      </div>
    </div>
  );
}

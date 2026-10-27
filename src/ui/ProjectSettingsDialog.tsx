// M1-15c · 项目设置对话框（对齐「偏好设置」的尺寸与交互）
// 布局：.modal.settings（宽 min(820px,92vw)，固定高）→ 左 .set-nav 分页 + 右 .set-panes；
// 字段用 .fld 行式排版（左标题+说明，右控件）。
// 交互：打开时读取 .ltex/config.json 回填草稿；「取消 / Esc / 点遮罩」丢弃改动并关闭；
// 「保存设置」写回 .ltex/config.json → 刷新项目树（引擎 chip / 主文件标记 / exclude 隐树）
// → 刷新最近项目名称（欢迎页卡片）→ 关闭。
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useProjectStore, notify } from "@/project/useProject";
import { configApi, projectApi } from "@/ipc/invoke";
import { useSettingsStore } from "@/core/settings";
import { Icon } from "@/ui/Icon";
import type { ProjectConfig, ProjectNode } from "@/types";

type ProjectType = NonNullable<ProjectConfig["projectType"]>;

type PaneId = "general" | "build" | "display";

const PANES: Array<{ id: PaneId; icon: string; label: string }> = [
  { id: "general", icon: "layout", label: "常规" },
  { id: "build", icon: "play", label: "构建" },
  { id: "display", icon: "edit", label: "显示" },
];

const PROJECT_TYPE_OPTIONS: Array<{ value: ProjectType; label: string }> = [
  { value: "article", label: "论文 / 文章 (article)" },
  { value: "thesis", label: "学位论文 (thesis)" },
  { value: "beamer", label: "幻灯片 (beamer)" },
  { value: "resume", label: "简历 (resume)" },
  { value: "custom", label: "自定义 (custom)" },
];

const ENGINE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "默认（xelatex）" },
  { value: "xelatex", label: "XeLaTeX" },
  { value: "pdflatex", label: "pdfLaTeX" },
  { value: "lualatex", label: "LuaLaTeX" },
  { value: "latexmk", label: "latexmk" },
];

/** 设置行：左侧标题+说明（tooltip 可标注置灰原因），右侧控件（对齐偏好设置 Fld） */
function Fld({
  label,
  hint,
  tip,
  block,
  children,
}: {
  label: string;
  hint: string;
  tip?: string;
  block?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={block ? "fld fld-block" : "fld"} title={tip}>
      <div className="lbl">
        <b>{label}</b>
        <span>{hint}</span>
      </div>
      {children}
    </div>
  );
}

/** 收集项目树内的 .tex 文件（相对项目根、正斜杠；去重排序） */
function collectTexFiles(root: string, nodes: ProjectNode[] | undefined): string[] {
  const out: string[] = [];
  const walk = (ns: ProjectNode[] | undefined) => {
    if (!ns) return;
    for (const n of ns) {
      if (n.type === "file" && /\.tex$/i.test(n.name)) {
        const rel = n.path
          .slice(root.length)
          .replace(/^[\\/]/, "")
          .replace(/\\/g, "/");
        out.push(rel);
      }
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return [...new Set(out)].sort();
}

interface Draft {
  name: string;
  description: string;
  projectType: ProjectType | "";
  engine: string;
  mainFile: string;
  outputDir: string;
  imageDir: string;
  excludeText: string;
}

const EMPTY: Draft = {
  name: "",
  description: "",
  projectType: "",
  engine: "",
  mainFile: "",
  outputDir: "",
  imageDir: "",
  excludeText: "",
};

export function ProjectSettingsDialog() {
  const open = useProjectStore((s) => s.projectSettingsOpen);
  const close = useProjectStore((s) => s.closeProjectSettings);
  const root = useProjectStore((s) => s.root);
  const nodes = useProjectStore((s) => s.tree?.nodes);

  const [pane, setPane] = useState<PaneId>("general");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const texFiles = useMemo(
    () => (root ? collectTexFiles(root, nodes) : []),
    [root, nodes],
  );

  // 打开时读取当前配置回填（每次打开回到「常规」页）
  useEffect(() => {
    if (!open || !root) return;
    setPane("general");
    setErr(null);
    setLoading(true);
    setDraft(EMPTY);
    let alive = true;
    void (async () => {
      try {
        const cfg = await projectApi.getProjectConfig(root);
        if (!alive) return;
        setDraft({
          name: cfg.name ?? "",
          description: cfg.description ?? "",
          projectType: (cfg.projectType ?? "") as ProjectType | "",
          engine: cfg.engine ?? "",
          mainFile: cfg.mainFile ?? "",
          outputDir: cfg.outputDir ?? "",
          imageDir: cfg.imageDir ?? "",
          excludeText: (cfg.exclude ?? []).join("\n"),
        });
      } catch (e) {
        if (alive) setErr(String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, root]);

  // 取消 = 丢弃草稿并关闭（对应偏好设置「取消回滚快照」）
  const cancel = useCallback(() => {
    setDraft(EMPTY);
    close();
  }, [close]);

  // Esc / 点遮罩 = 取消
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, cancel]);

  if (!open || !root) return null;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  async function save() {
    if (!root) return;
    const mf = draft.mainFile.trim();
    if (mf && (mf.startsWith("/") || mf.startsWith("\\") || mf.includes(".."))) {
      setErr("主文件必须为项目内的相对路径");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const payload: ProjectConfig = {
        engine: draft.engine,
        mainFile: mf,
        outputDir: draft.outputDir.trim(),
        imageDir: draft.imageDir.trim(),
        name: draft.name.trim(),
        description: draft.description.trim(),
        projectType: draft.projectType || undefined,
        exclude: draft.excludeText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      };
      await projectApi.updateProjectConfig(root, payload);
      // 刷新树：mainFile 标记 / engine chip / exclude 隐树
      await useProjectStore.getState().refresh();
      // 项目名写回最近项目注册表（欢迎页卡片）
      try {
        const list = await configApi.registerRecentProject(root);
        useSettingsStore.getState().setRecentProjects(list);
      } catch (e) {
        console.warn("[register_recent_project]", e);
      }
      notify("已保存项目设置", "ok");
      close();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  const engineKnown = ENGINE_OPTIONS.some((en) => en.value === draft.engine);

  return (
    <div
      className="modal-layer"
      role="dialog"
      aria-label="项目设置"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <div
        className="modal settings"
        style={{ width: "min(820px, 92vw)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <Icon name="sliders" size={18} style={{ color: "var(--accent)" }} />
          <div>
            <h2>项目设置</h2>
            <div className="sub">Project Settings</div>
          </div>
          <button type="button" className="ibtn x" title="关闭" onClick={cancel}>
            <Icon name="x" />
          </button>
        </div>

        <div className="modal-body">
          <div className="set-nav" role="tablist">
            {PANES.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                className={pane === p.id ? "on" : ""}
                onClick={() => setPane(p.id)}
              >
                <Icon name={p.icon} />
                {p.label}
              </button>
            ))}
          </div>

          <div className="set-panes">
            {loading ? (
              <div className="set-pane">
                <p className="set-note">加载中…</p>
              </div>
            ) : (
              <>
                {pane === "general" && (
                  <div className="set-pane" role="tabpanel">
                    <h4>项目信息</h4>
                    <Fld label="项目名" hint="默认取目录名；用于欢迎页与最近项目">
                      <input
                        className="txt-in"
                        style={{ minWidth: 280 }}
                        value={draft.name}
                        onChange={(e) => set("name", e.target.value)}
                        placeholder="默认取目录名"
                        spellCheck={false}
                        autoFocus
                      />
                    </Fld>
                    <Fld label="描述" hint="可选；仅作记录">
                      <input
                        className="txt-in"
                        style={{ minWidth: 280 }}
                        value={draft.description}
                        onChange={(e) => set("description", e.target.value)}
                        placeholder="可选"
                        spellCheck={false}
                      />
                    </Fld>
                    <Fld label="类型" hint="项目类型（模板 / 展示用）">
                      <select
                        value={draft.projectType}
                        onChange={(e) =>
                          set("projectType", e.target.value as ProjectType | "")
                        }
                      >
                        <option value="">未设置</option>
                        {PROJECT_TYPE_OPTIONS.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </Fld>
                  </div>
                )}

                {pane === "build" && (
                  <div className="set-pane" role="tabpanel">
                    <h4>构建</h4>
                    <Fld label="主文件" hint="决定编译入口与资源树「主文件」标记">
                      <select
                        value={draft.mainFile}
                        onChange={(e) => set("mainFile", e.target.value)}
                      >
                        <option value="">自动识别（启发式）</option>
                        {draft.mainFile && !texFiles.includes(draft.mainFile) && (
                          <option value={draft.mainFile}>
                            {draft.mainFile}（当前）
                          </option>
                        )}
                        {texFiles.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </Fld>
                    <Fld
                      label="编译引擎"
                      hint="此项目使用的引擎（全局「跟随项目」时生效）"
                      tip="全局设置若指定了具体引擎，将覆盖此项（M1-3 优先级）"
                    >
                      <select
                        value={draft.engine}
                        onChange={(e) => set("engine", e.target.value)}
                      >
                        {!engineKnown && (
                          <option value={draft.engine}>{draft.engine}（当前）</option>
                        )}
                        {ENGINE_OPTIONS.map((en) => (
                          <option key={en.value} value={en.value}>
                            {en.label}
                          </option>
                        ))}
                      </select>
                    </Fld>
                    <Fld
                      label="输出目录（暂未接通）"
                      hint="编译产物当前固定落在主文件同目录"
                      tip="输出目录（outputDir）支持留待后续切片；此处仅保留原值，不会改变产物位置"
                    >
                      <input
                        className="txt-in"
                        style={{ minWidth: 280 }}
                        value={draft.outputDir}
                        placeholder="固定为主文件同目录"
                        spellCheck={false}
                        disabled
                      />
                    </Fld>
                  </div>
                )}

                {pane === "display" && (
                  <div className="set-pane" role="tabpanel">
                    <h4>显示</h4>
                    <Fld
                      label="图片目录"
                      hint="拖拽 / 粘贴 / 插入图片的落盘目录（相对项目根）"
                    >
                      <input
                        className="txt-in"
                        style={{ minWidth: 280 }}
                        value={draft.imageDir}
                        onChange={(e) => set("imageDir", e.target.value)}
                        placeholder="figure"
                        spellCheck={false}
                      />
                    </Fld>
                    <Fld
                      label="排除规则"
                      hint="每行一个 glob；仅影响资源管理器树的显示"
                      tip="不影响编译与文件监听；目录名匹配会隐藏整个目录"
                      block
                    >
                      <textarea
                        className="fld-area"
                        value={draft.excludeText}
                        onChange={(e) => set("excludeText", e.target.value)}
                        placeholder={"每行一个 glob，例如：\nbuild\n**/*.aux\nscratch.tex"}
                        spellCheck={false}
                      />
                    </Fld>
                    <p className="set-note">
                      支持 <code>*</code>、<code>**</code>、<code>?</code>；目录名匹配会隐藏整个目录。留空则显示全部。
                    </p>
                  </div>
                )}
              </>
            )}
            {err && <p className="proj-set-err">{err}</p>}
          </div>
        </div>

        <div className="modal-foot">
          <div className="hint">
            设置保存后写入项目配置
            <span
              style={{ fontFamily: "var(--font-mono)", color: "var(--txt-2)" }}
            >
              .ltex/config.json
            </span>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 9 }}>
            <button type="button" className="btn" onClick={cancel}>
              取消
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => void save()}
              disabled={busy || loading}
            >
              {busy ? "保存中…" : "保存设置"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProjectSettingsDialog;

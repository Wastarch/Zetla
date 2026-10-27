// M1-15a · 欢迎页（无活动项目且无打开文档时替换编辑区）
// 最近项目卡片：名称 / 路径 / 最近打开 / 模板徽标 / 置顶星 / 归档 / 打开；
// 入口：从模板新建、打开项目文件夹。
// 数据源：useSettingsStore.settings.recentProjects（与 Rust AppConfig.recent_projects 对齐）；
// 置顶/归档经 configApi 写盘并返回最新列表，同步回本地镜像。
import { useEffect, useMemo, useState } from "react";
import { configApi } from "@/ipc/invoke";
import { useSettingsStore } from "@/core/settings";
import { notify, useProjectStore } from "@/project/useProject";
import type { ProjectEntry } from "@/types";

/** ISO-8601 → 相对时间（刚刚 / N 分钟前 / N 小时前 / N 天前 / YYYY-MM-DD） */
function fmtWhen(iso?: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  if (diff < 60_000) return "刚刚";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天前`;
  const dt = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

export function WelcomeScreen() {
  const recent = useSettingsStore((s) => s.settings.recentProjects);
  const setRecent = useSettingsStore((s) => s.setRecentProjects);
  const openProject = useProjectStore((s) => s.openProject);
  const openProjectDialog = useProjectStore((s) => s.openProjectDialog);
  const openWizard = useProjectStore((s) => s.openWizard);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // 挂载时刷新（settings.load 已带 recentProjects；此处兜底设置未加载 / 外部改动）
  useEffect(() => {
    void configApi
      .listRecentProjects()
      .then((list) => setRecent(list))
      .catch((e) => console.warn("[list_recent_projects]", e));
  }, [setRecent]);

  const { active, archived } = useMemo(
    () => ({
      active: recent.filter((e) => !e.archived),
      archived: recent.filter((e) => e.archived),
    }),
    [recent],
  );

  const togglePin = async (e: ProjectEntry) => {
    setBusy(e.path);
    try {
      setRecent(await configApi.pinProject(e.path, !e.pinned));
    } catch (err) {
      notify(String(err), "err");
    } finally {
      setBusy(null);
    }
  };

  const toggleArchive = async (e: ProjectEntry) => {
    setBusy(e.path);
    try {
      setRecent(await configApi.archiveProject(e.path, !e.archived));
    } catch (err) {
      notify(String(err), "err");
    } finally {
      setBusy(null);
    }
  };

  const card = (e: ProjectEntry) => (
    <div
      key={e.path}
      className={e.archived ? "welcome-card archived" : "welcome-card"}
      title={e.path}
      role="button"
      tabIndex={0}
      onClick={() => void openProject(e.path)}
      onKeyDown={(ev) => {
        if (ev.key === "Enter") void openProject(e.path);
      }}
    >
      <div className="wc-top">
        <div className="wc-name">{e.name || "未命名项目"}</div>
        {e.templateId ? (
          <span className="wc-badge" title={`模板：${e.templateId}`}>
            {e.templateId}
          </span>
        ) : null}
      </div>
      <div className="wc-path">{e.path}</div>
      <div className="wc-foot">
        <span className="wc-when">{fmtWhen(e.lastOpened)}</span>
        <div className="wc-acts" onClick={(ev) => ev.stopPropagation()}>
          <button
            type="button"
            className={e.pinned ? "wc-star on" : "wc-star"}
            title={e.pinned ? "取消置顶" : "置顶"}
            aria-label={e.pinned ? "取消置顶" : "置顶"}
            disabled={busy === e.path}
            onClick={() => void togglePin(e)}
          >
            {e.pinned ? "★" : "☆"}
          </button>
          <button
            type="button"
            className="wc-arch"
            title={e.archived ? "取消归档" : "归档"}
            disabled={busy === e.path}
            onClick={() => void toggleArchive(e)}
          >
            {e.archived ? "还原" : "归档"}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy === e.path}
            onClick={() => void openProject(e.path)}
          >
            打开
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <section className="welcome">
      <div className="welcome-inner">
        <header className="welcome-head">
          <div className="welcome-mark">Z</div>
          <div className="welcome-title">
            <h1>Zetla</h1>
            <p>开始你的 LaTeX 写作</p>
          </div>
        </header>

        <div className="welcome-actions">
          <button type="button" className="btn primary" onClick={() => openWizard()}>
            从模板新建
          </button>
          <button type="button" className="btn" onClick={() => void openProjectDialog()}>
            打开项目文件夹…
          </button>
        </div>

        <section className="welcome-recent">
          <div className="welcome-sec-head">
            <span>最近项目</span>
            {archived.length > 0 && (
              <button
                type="button"
                className="welcome-link"
                onClick={() => setShowArchived((v) => !v)}
              >
                {showArchived ? "隐藏已归档" : `已归档 ${archived.length}`}
              </button>
            )}
          </div>

          {active.length === 0 ? (
            <div className="welcome-empty">
              尚无最近项目。从模板新建，或打开一个文件夹开始。
            </div>
          ) : (
            <div className="welcome-grid">{active.map(card)}</div>
          )}

          {showArchived && archived.length > 0 && (
            <>
              <div className="welcome-sub-head">已归档</div>
              <div className="welcome-grid">{archived.map(card)}</div>
            </>
          )}
        </section>
      </div>
    </section>
  );
}

export default WelcomeScreen;

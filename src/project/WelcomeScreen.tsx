// M1-15a/-15d · 欢迎页（无活动项目且无打开文档时替换编辑区）
// M1-15 UI 改版（参考 docs/dev/UI/projec_viewport.html）：
// 最近项目从卡片网格改为「表头 + 列表行」布局：名称 / 位置 / 最近打开 / 操作。
// 数据源：useSettingsStore.settings.recentProjects（与 Rust AppConfig.recent_projects 对齐）；
// 置顶/归档经 configApi 写盘并返回最新列表，同步回本地镜像；生命周期动作走 ProjectActionDialog。
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
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

/** 「⋯」菜单：固定定位到触发按钮下方（避免列表 overflow 裁剪） */
interface MenuState {
    entry: ProjectEntry;
    x: number;
    y: number;
}

export function WelcomeScreen() {
    const recent = useSettingsStore((s) => s.settings.recentProjects);
    const setRecent = useSettingsStore((s) => s.setRecentProjects);
    const openProject = useProjectStore((s) => s.openProject);
    const openProjectDialog = useProjectStore((s) => s.openProjectDialog);
    const openWizard = useProjectStore((s) => s.openWizard);
    const openProjectAction = useProjectStore((s) => s.openProjectAction);
    const exportProject = useProjectStore((s) => s.exportProject);
    const [showArchived, setShowArchived] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [menu, setMenu] = useState<MenuState | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // 挂载时刷新（settings.load 已带 recentProjects；此处兜底设置未加载 / 外部改动）
    useEffect(() => {
        void configApi
            .listRecentProjects()
            .then((list) => setRecent(list))
            .catch((e) => console.warn("[list_recent_projects]", e));
    }, [setRecent]);

    // 「⋯」菜单：点击外部 / Esc 关闭
    useEffect(() => {
        if (!menu) return;
        const onDown = (e: MouseEvent) => {
            if (menuRef.current?.contains(e.target as Node)) return;
            setMenu(null);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setMenu(null);
        };
        window.addEventListener("mousedown", onDown);
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("mousedown", onDown);
            window.removeEventListener("keydown", onKey);
        };
    }, [menu]);

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

    const openMenu = (e: ProjectEntry, ev: ReactMouseEvent<HTMLButtonElement>) => {
        const r = ev.currentTarget.getBoundingClientRect();
        const width = 158;
        const height = 168;
        const x = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
        const y = Math.min(r.bottom + 4, window.innerHeight - height - 8);
        setMenu({ entry: e, x, y });
    };

    const row = (e: ProjectEntry) => (
        <div
            key={e.path}
            className={e.archived ? "welcome-row archived" : "welcome-row"}
            title={e.path}
            onDoubleClick={() => void openProject(e.path)}
        >
            <div className="wl-name">
                <span className="wl-title">{e.name || "未命名项目"}</span>
                {e.templateId ? (
                    <span className="wl-tag" title={`模板：${e.templateId}`}>
                        {e.templateId}
                    </span>
                ) : null}
            </div>
            <div className="wl-path" title={e.path}>
                {e.path}
            </div>
            <div className="wl-time">{fmtWhen(e.lastOpened)}</div>
            <div className="wl-acts">
                <button
                    type="button"
                    className={e.pinned ? "wl-icon on" : "wl-icon"}
                    title={e.pinned ? "取消置顶" : "置顶"}
                    aria-label={e.pinned ? "取消置顶" : "置顶"}
                    disabled={busy === e.path}
                    onClick={() => void togglePin(e)}
                >
                    {e.pinned ? "★" : "☆"}
                </button>
                <button
                    type="button"
                    className="wl-icon"
                    title="更多操作"
                    aria-label="更多操作"
                    onClick={(ev) => {
                        ev.stopPropagation();
                        openMenu(e, ev);
                    }}
                >
                    ⋯
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
    );

    return (
        <section className="welcome">
            <div className="welcome-inner">
                <header className="welcome-head">
                    <img
                        className="welcome-mark"
                        src="/logo.svg"
                        alt="Zetla"
                        draggable={false}
                    />
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
                        <span className="welcome-sec-title">最近项目</span>
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

                    {recent.length === 0 ? (
                        <div className="welcome-empty">
                            尚无最近项目。从模板新建，或打开一个文件夹开始。
                        </div>
                    ) : (
                        <div className="welcome-list" role="list">
                            <div className="welcome-list-head">
                                <div className="wl-col-name">名称</div>
                                <div className="wl-col-path">位置</div>
                                <div className="wl-col-time">最近打开</div>
                                <div className="wl-col-acts" />
                            </div>

                            {active.length > 0 ? (
                                active.map(row)
                            ) : (
                                <div className="welcome-row empty-row">
                                    <span className="wl-none">暂无未归档项目</span>
                                </div>
                            )}

                            {showArchived && archived.length > 0 && (
                                <>
                                    <div className="welcome-list-sub">已归档</div>
                                    {archived.map(row)}
                                </>
                            )}
                        </div>
                    )}
                </section>
            </div>

            {menu && (
                <div
                    ref={menuRef}
                    className="wc-menu"
                    style={{ position: "fixed", left: menu.x, top: menu.y }}
                    onMouseDown={(ev) => ev.stopPropagation()}
                >
                    <button
                        type="button"
                        onClick={() => {
                            const e = menu.entry;
                            setMenu(null);
                            openProjectAction({ kind: "rename", path: e.path, name: e.name });
                        }}
                    >
                        重命名项目…
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            const e = menu.entry;
                            setMenu(null);
                            void exportProject(e.path);
                        }}
                    >
                        导出为 zip…
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            const e = menu.entry;
                            setMenu(null);
                            void toggleArchive(e);
                        }}
                    >
                        {menu.entry.archived ? "取消归档" : "归档"}
                    </button>
                    <div className="wc-menu-sep" />
                    <button
                        type="button"
                        className="danger"
                        onClick={() => {
                            const e = menu.entry;
                            setMenu(null);
                            openProjectAction({ kind: "delete", path: e.path, name: e.name });
                        }}
                    >
                        删除项目…
                    </button>
                </div>
            )}
        </section>
    );
}

export default WelcomeScreen;

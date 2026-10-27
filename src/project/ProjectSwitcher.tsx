// M1-15b · 项目切换器（命令面板式浮层；Ctrl+R / 文件→切换项目）
// 列出最近项目（置顶+最近，后端已排序），输入过滤，↑↓ 选择 / Enter 打开 / Esc 关闭。
// 会话保留：切换离开时把当前项目的「标签页 + 活动标签」存入内存缓存（按项目 path 索引），
// 切回时按新项目树过滤已存在文件后重开（同名/已删文件自然被过滤）。
// 说明：缓存为会话级内存（跨重启仅上次项目由 M0-13 全局 session 恢复）。
import { useEffect, useMemo, useRef, useState } from "react";
import { configApi } from "@/ipc/invoke";
import { useSettingsStore } from "@/core/settings";
import { useBuffersStore } from "@/editor/useBuffers";
import { useProjectStore } from "./useProject";
import type { ProjectEntry, ProjectNode } from "@/types";

interface CachedSession {
  openFiles: string[];
  activeFile: string | null;
}

/** 会话级「项目 → 标签页」缓存（不落盘；见文件头说明） */
const sessionCache = new Map<string, CachedSession>();

/** 路径是否属于某项目根（Windows 分隔符两态） */
function isUnder(root: string, p: string): boolean {
  return p.startsWith(`${root}\\`) || p.startsWith(`${root}/`);
}

/** 捕获当前项目已打开标签（切换离开前调用） */
function captureCurrent(root: string): void {
  const bs = useBuffersStore.getState();
  const openFiles = bs.buffers.filter((b) => isUnder(root, b.path)).map((b) => b.path);
  sessionCache.set(root, { openFiles, activeFile: bs.activePath });
}

/** 收集项目树中的文件路径（小写，用于过滤缓存中已删除的文件） */
function collectFiles(nodes: ProjectNode[]): Set<string> {
  const out = new Set<string>();
  const walk = (ns: ProjectNode[]) => {
    for (const n of ns) {
      if (n.type === "file") out.add(n.path.toLowerCase());
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export function ProjectSwitcher() {
  const open = useProjectStore((s) => s.switcherOpen);
  const close = useProjectStore((s) => s.closeSwitcher);
  const root = useProjectStore((s) => s.root);
  const openProjectDialog = useProjectStore((s) => s.openProjectDialog);
  const recent = useSettingsStore((s) => s.settings.recentProjects);
  const setRecent = useSettingsStore((s) => s.setRecentProjects);

  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时：清空输入、刷新注册表（settings 镜像可能过期）、聚焦
  useEffect(() => {
    if (!open) return;
    setQ("");
    setIdx(0);
    void configApi
      .listRecentProjects()
      .then((list) => setRecent(list))
      .catch((e) => console.warn("[list_recent_projects]", e));
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open, setRecent]);

  const items = useMemo(() => {
    const active = recent.filter((e) => !e.archived);
    const kw = q.trim().toLowerCase();
    if (!kw) return active;
    return active.filter(
      (e) =>
        e.name.toLowerCase().includes(kw) || e.path.toLowerCase().includes(kw),
    );
  }, [recent, q]);

  // 「打开其他文件夹…」固定为最后一项
  const total = items.length + 1;

  // 过滤变化时钳制游标
  useEffect(() => {
    setIdx((i) => Math.min(i, Math.max(0, total - 1)));
  }, [total]);

  if (!open) return null;

  const switchTo = async (target: string): Promise<void> => {
    const st = useProjectStore.getState();
    close();
    if (!target || st.root === target) return; // 已打开：不自我关闭重开
    if (st.root) captureCurrent(st.root);
    await st.openProject(target);
    const nowRoot = useProjectStore.getState().root;
    if (nowRoot !== target) return; // 打开失败（toast 已由 openProject 给出）
    const cached = sessionCache.get(target);
    const tree = useProjectStore.getState().tree;
    if (!cached || !tree || cached.openFiles.length === 0) return;
    const exists = collectFiles(tree.nodes);
    const files = cached.openFiles.filter((p) => exists.has(p.toLowerCase()));
    if (files.length === 0) return;
    await useBuffersStore.getState().openFiles(files);
    const active = cached.activeFile;
    if (active && files.includes(active)) {
      useBuffersStore.getState().setActive(active);
    }
  };

  const choose = (i: number): void => {
    if (i >= items.length) {
      close();
      void openProjectDialog();
      return;
    }
    const e = items[i];
    if (e) void switchTo(e.path);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => (i + 1) % total);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => (i - 1 + total) % total);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(idx);
    }
  };

  const row = (e: ProjectEntry, i: number) => {
    const isCurrent = root === e.path;
    return (
      <div
        key={e.path}
        className={
          "switcher-item" +
          (i === idx ? " on" : "") +
          (isCurrent ? " current" : "")
        }
        onMouseEnter={() => setIdx(i)}
        onClick={() => void switchTo(e.path)}
        title={e.path}
      >
        <span className={e.pinned ? "switcher-star on" : "switcher-star"}>
          {e.pinned ? "★" : ""}
        </span>
        <span className="switcher-name">{e.name || "未命名项目"}</span>
        {isCurrent && <span className="switcher-badge">当前</span>}
        <span className="switcher-path">{e.path}</span>
      </div>
    );
  };

  return (
    <div className="switcher-overlay" onMouseDown={() => close()}>
      <div
        className="switcher"
        role="dialog"
        aria-label="切换项目"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="switcher-input"
          value={q}
          placeholder="切换项目…（输入以过滤）"
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="switcher-list">
          {items.length === 0 ? (
            <div className="switcher-empty">没有匹配的最近项目</div>
          ) : (
            items.map((e, i) => row(e, i))
          )}
          <div
            className={"switcher-item switcher-open-folder" + (idx === items.length ? " on" : "")}
            onMouseEnter={() => setIdx(items.length)}
            onClick={() => {
              close();
              void openProjectDialog();
            }}
          >
            <span className="switcher-star" />
            <span className="switcher-name">打开其他文件夹…</span>
          </div>
          {items.length === 0 && (
            <div className="switcher-hint">
              提示：打开过的项目会出现在这里；归档项目可在欢迎页还原。
            </div>
          )}
        </div>
        <div className="switcher-foot">↑↓ 选择 · Enter 打开 · Esc 关闭</div>
      </div>
    </div>
  );
}

export default ProjectSwitcher;

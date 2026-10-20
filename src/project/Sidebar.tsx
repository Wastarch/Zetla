// M0-6 · 侧栏（对齐 docs/UI/code.html .sidebar）
// side-head：项目资源 + 刷新 + 项目名 + 动作（新建/打开项目/保存全部/模板导入占位）
// 树 + side-foot 项目概要（主入口/引擎占位/辅助工具/编译日志占位）
import type { CSSProperties } from "react";
import { Icon } from "@/ui/Icon";
import { useBuffersStore } from "@/editor/useBuffers";
import { base, notify, useProjectStore } from "./useProject";
import { ProjectTree } from "./ProjectTree";

export interface SidebarProps {
  /** 拖拽得到的宽度（M0-6 不持久化，M0-12 接配置） */
  style?: CSSProperties;
}

export function Sidebar({ style }: SidebarProps) {
  const root = useProjectStore((s) => s.root);
  const tree = useProjectStore((s) => s.tree);
  const openProjectDialog = useProjectStore((s) => s.openProjectDialog);
  const refresh = useProjectStore((s) => s.refresh);

  async function saveAll() {
    const saved = await useBuffersStore.getState().saveAllBuffers();
    if (saved === 0) {
      notify("没有未保存的修改", "ok");
    }
  }

  return (
    <aside className="sidebar" style={style}>
      <div className="side-head">
        <div className="side-title">
          <Icon name="folder" />
          <h2>项目资源</h2>
          <button
            type="button"
            className="ibtn"
            style={{ marginLeft: "auto" }}
            title="刷新"
            disabled={!root}
            onClick={() => void refresh()}
          >
            <Icon name="refresh" />
          </button>
        </div>

        <div className="proj-name">
          <Icon name="layout" style={{ color: "var(--accent)" }} />
          <span className="nm" title={root ?? undefined}>
            {root ? base(root) : "未打开项目"}
          </span>
          <span className="tag">Local</span>
        </div>

        <div className="side-actions">
          <button
            type="button"
            className="ibtn"
            title="从模板新建文档（M0-7）"
            onClick={() => useProjectStore.getState().openWizard()}
          >
            <Icon name="file-plus" />
          </button>
          <button
            type="button"
            className="ibtn"
            title="打开项目"
            onClick={() => void openProjectDialog()}
          >
            <Icon name="folder-plus" />
          </button>
          <button
            type="button"
            className="ibtn"
            title="保存全部"
            onClick={() => void saveAll()}
          >
            <Icon name="save" />
          </button>
          <button
            type="button"
            className="ibtn wide primary"
            style={{ marginLeft: "auto" }}
            title="从模板新建项目（M0-7）"
            onClick={() => useProjectStore.getState().openWizard()}
          >
            <Icon name="layout" />
            模板导入
          </button>
        </div>
      </div>

      <ProjectTree />

      <div className="side-foot">
        <h3>项目概要</h3>
        <div className="kv">
          <span className="k">主 tex 入口</span>
          <span className="v" title={tree?.mainFile || undefined}>
            {tree?.mainFile ? base(tree.mainFile) : "—"}
          </span>
        </div>
        <div className="kv">
          <span className="k">编译引擎</span>
          <span className="v engine" title="多引擎切换（M0-9 接通）">
            XeLaTeX
          </span>
        </div>
        <div className="kv">
          <span className="k">辅助工具</span>
          <span className="v">latexmk · synctex</span>
        </div>
        <button type="button" className="log-link" disabled title="编译日志（M0-10 接通）">
          <Icon name="terminal" />
          编译日志
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;

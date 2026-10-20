// 顶部菜单栏（M0-12 前移）—— 对齐 docs/UI/code.html .menubar/.drop/.mi
// 只接通已有能力；未到切片的功能置灰并在 tooltip 标注接通切片（编译 M0-9 已接、
// 日志解析 M0-10、PDF M0-13、设置 M1、明暗主题 M3）。撤销/重做/注释经命令桥 src/editor/activeView.ts
// 派发 CM6 命令（复制/粘贴为 WebView 原生键盘能力，菜单不重复接）。
import { useEffect, useRef, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { redo, toggleComment, undo } from "@codemirror/commands";
import { getActiveView } from "@/editor/activeView";
import { useBuffersStore } from "@/editor/useBuffers";
import { useAppStore } from "@/core/store";
import { useProjectStore } from "@/project/useProject";
import { cancelCompile, startCompile } from "@/compile/useCompile";
import { Icon } from "@/ui/Icon";

/** 菜单项：enabled=false 置灰并在 hover 时以 title 提示 */
interface MenuItemDef {
  label: string;
  /** 快捷键提示（仅真实已绑定/本切片新绑定的键才显示） */
  sc?: string;
  enabled?: boolean;
  /** 置灰原因（title 提示） */
  hint?: string;
  onClick?: () => void;
  sep?: boolean;
}

interface MenuDef {
  label: string;
  items: MenuItemDef[];
}

/** 有活动编辑器时才可执行编辑类命令 */
function withView(fn: (view: NonNullable<ReturnType<typeof getActiveView>>) => void) {
  const v = getActiveView();
  if (v) fn(v);
}

async function quitApp() {
  const bs = useBuffersStore.getState();
  const dirty = bs.dirtyCount();
  if (dirty > 0) {
    const ok = await confirm(`有 ${dirty} 个文件尚未保存，仍要退出吗？`, {
      title: "退出 Zetla",
      kind: "warning",
    });
    if (!ok) return;
  }
  await getCurrentWindow().close();
}

export function MenuBar() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  // 状态驱动菜单可用性（re-render 由 zustand 订阅触发）
  const activePath = useBuffersStore((s) => s.activePath);
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const logVisible = useAppStore((s) => s.logVisible);
  const running = useAppStore((s) => s.compileStatus === "running");
  const hasMain = useProjectStore((s) => !!s.tree?.mainFile);

  const canEdit = activePath !== null;

  const menus: MenuDef[] = [
    {
      label: "文件",
      items: [
        {
          label: "新建项目…",
          sc: "Ctrl+Shift+N",
          onClick: () => useProjectStore.getState().openWizard(),
        },
        {
          label: "打开项目…",
          sc: "Ctrl+Shift+O",
          onClick: () => void useProjectStore.getState().openProjectDialog(),
        },
        { sep: true, label: "" },
        {
          label: "保存",
          sc: "Ctrl+S",
          enabled: canEdit,
          hint: "未打开文档",
          onClick: () => {
            const p = useBuffersStore.getState().activePath;
            if (p) void useBuffersStore.getState().saveBuffer(p);
          },
        },
        {
          label: "全部保存",
          sc: "Ctrl+Shift+S",
          onClick: () => void useBuffersStore.getState().saveAllBuffers(),
        },
        { sep: true, label: "" },
        {
          label: "关闭标签",
          sc: "Ctrl+W",
          enabled: canEdit,
          hint: "未打开文档",
          onClick: () => {
            const p = useBuffersStore.getState().activePath;
            if (p) void useBuffersStore.getState().closeBuffer(p);
          },
        },
        { label: "退出", sc: "Alt+F4", onClick: () => void quitApp() },
      ],
    },
    {
      label: "编辑",
      items: [
        {
          label: "撤销",
          sc: "Ctrl+Z",
          enabled: canEdit,
          hint: "未打开文档",
          onClick: () => withView((v) => undo(v)),
        },
        {
          label: "重做",
          sc: "Ctrl+Y",
          enabled: canEdit,
          hint: "未打开文档",
          onClick: () => withView((v) => redo(v)),
        },
        { sep: true, label: "" },
        {
          label: "复制",
          sc: "Ctrl+C",
          enabled: false,
          hint: "编辑区内已由键盘接管",
        },
        {
          label: "粘贴",
          sc: "Ctrl+V",
          enabled: false,
          hint: "编辑区内已由键盘接管",
        },
        { sep: true, label: "" },
        {
          label: "查找",
          sc: "Ctrl+F",
          enabled: false,
          hint: "查找面板另做（M1）",
        },
        {
          label: "替换",
          sc: "Ctrl+H",
          enabled: false,
          hint: "查找面板另做（M1）",
        },
        {
          label: "切换注释",
          sc: "Ctrl+/",
          enabled: canEdit,
          hint: "未打开文档",
          onClick: () => withView((v) => toggleComment(v)),
        },
      ],
    },
    {
      label: "构建",
      items: [
        {
          label: "开始编译",
          sc: "Ctrl+B",
          enabled: hasMain && !running,
          hint: running
            ? "编译进行中"
            : "未打开项目或未识别主文件（.ltex/config.json）",
          onClick: () => void startCompile(),
        },
        {
          label: "终止编译",
          enabled: running,
          hint: "当前没有编译任务",
          onClick: () => void cancelCompile(),
        },
        { sep: true, label: "" },
        { label: "清理辅助文件", enabled: false, hint: "M1" },
        { label: "编译并查看 PDF", enabled: false, hint: "PDF 预览 M0-13 接通" },
      ],
    },
    {
      label: "视图",
      items: [
        {
          label: `${sidebarVisible ? "隐藏" : "显示"}资源树`,
          sc: "Ctrl+B 0",
          onClick: () => useAppStore.getState().toggleSidebar(),
        },
        { label: "显示 / 隐藏 PDF 预览", enabled: false, hint: "PDF 预览 M0-13 接通" },
        {
          label: `${logVisible ? "隐藏" : "显示"}日志面板`,
          onClick: () => useAppStore.getState().toggleLog(),
        },
        { sep: true, label: "" },
        { label: "放大", enabled: false, hint: "缩放 M1" },
        { label: "缩小", enabled: false, hint: "缩放 M1" },
        { sep: true, label: "" },
        { label: "切换明暗主题", enabled: false, hint: "暗色主题 M3" },
      ],
    },
    {
      label: "模板",
      items: [
        {
          label: "从模板新建…",
          onClick: () => useProjectStore.getState().openWizard(),
        },
        { label: "管理本地模板", enabled: false, hint: "用户模板目录 M1" },
        { label: "导入模板包…", enabled: false, hint: "模板导入 M1" },
      ],
    },
    {
      label: "设置",
      items: [{ label: "偏好设置", sc: "Ctrl+,", enabled: false, hint: "全局设置 M1" }],
    },
    {
      label: "帮助",
      items: [
        { label: "编译快捷键速查", enabled: false, hint: "M1" },
        { label: "查看日志文件", enabled: false, hint: "日志面板 M0-10 接通" },
        { sep: true, label: "" },
        { label: "关于 Zetla", onClick: () => setAboutOpen(true) },
      ],
    },
  ];

  // 点击栏外 / Esc 关闭
  useEffect(() => {
    if (openIdx === null) return;
    const onDown = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpenIdx(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIdx(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [openIdx]);

  // 全局快捷键（编辑器外也生效；编辑器内 Mod-s 由 CM 先行处理）
  useEffect(() => {
    // Ctrl+B 0 chord：Ctrl+B 后 1.2s 内按 0 → 切换资源树（VS Code 风格）
    let chordB = false;
    let chordTimer: number | undefined;
    const clearChord = () => {
      chordB = false;
      if (chordTimer !== undefined) window.clearTimeout(chordTimer);
    };

    const onKey = (e: KeyboardEvent) => {
      if (chordB) {
        const kb = e.key.toLowerCase();
        // 二次 Ctrl+B 视为「直接编译」，不等 chord 超时
        if ((e.ctrlKey || e.metaKey) && kb === "b") {
          e.preventDefault();
          clearChord();
          void startCompile();
          return;
        }
        if (e.key === "0") {
          e.preventDefault();
          clearChord();
          useAppStore.getState().toggleSidebar();
          return;
        }
        // 其它键：取消 chord，继续按普通快捷键处理
        clearChord();
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (e.shiftKey) {
        if (k === "n") {
          e.preventDefault();
          useProjectStore.getState().openWizard();
        } else if (k === "o") {
          e.preventDefault();
          void useProjectStore.getState().openProjectDialog();
        } else if (k === "s") {
          e.preventDefault();
          void useBuffersStore.getState().saveAllBuffers();
        }
        return;
      }
      if (k === "b") {
        // Ctrl+B 单键 → 编译；1.2s 内接 0 → 切资源树（VS Code 风格 chord）
        e.preventDefault();
        chordB = true;
        chordTimer = window.setTimeout(() => {
          chordB = false;
          chordTimer = undefined;
          void startCompile();
        }, 1200);
        return;
      }
      if (k === "w") {
        e.preventDefault();
        const p = useBuffersStore.getState().activePath;
        if (p) void useBuffersStore.getState().closeBuffer(p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearChord();
    };
  }, []);

  function runItem(it: MenuItemDef) {
    setOpenIdx(null);
    if (it.enabled === false) return;
    it.onClick?.();
  }

  return (
    <>
      <div className="menubar" ref={barRef} role="menubar">
        {menus.map((m, i) => (
          <div
            key={m.label}
            className={openIdx === i ? "menu open" : "menu"}
            onMouseEnter={() => {
              if (openIdx !== null) setOpenIdx(i); // 已展开时 hover 切换
            }}
          >
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={openIdx === i}
              onClick={() => setOpenIdx(openIdx === i ? null : i)}
            >
              {m.label}
            </button>
            <div className="drop" role="menu">
              {m.items.map((it, j) =>
                it.sep ? (
                  <div key={j} className="msep" />
                ) : (
                  <button
                    key={j}
                    type="button"
                    role="menuitem"
                    className={it.enabled === false ? "mi off" : "mi"}
                    title={it.enabled === false ? it.hint : undefined}
                    onClick={() => runItem(it)}
                  >
                    <span>{it.label}</span>
                    {it.sc && <span className="sc">{it.sc}</span>}
                  </button>
                ),
              )}
            </div>
          </div>
        ))}
      </div>

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </>
  );
}

/** 关于 Zetla（.modal.sm 复用 M0-6 输入框样式骨架） */
function AboutDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-layer" onMouseDown={onClose}>
      <div
        className="modal sm about"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="关于 Zetla"
      >
        <div className="modal-head">
          <h2>关于 Zetla</h2>
          <button type="button" className="ibtn x" title="关闭" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">
          <div className="about-mark">
            <div
              className="mark"
              style={{ width: 36, height: 36, fontSize: 19, borderRadius: 10 }}
            >
              Z
            </div>
            <div>
              <div className="about-name">
                Ze<span>tla</span>
              </div>
              <div className="about-ver">v0.1.0 · M0-12 前移 · 本地离线</div>
            </div>
          </div>
          <p className="about-desc">
            桌面 LaTeX 工作台：项目树 · 多标签编辑 · 一键 XeLaTeX 编译 · PDF 预览。
            当前处于 M0（MVP）迭代期，构建/预览等能力将随后续切片接通。
          </p>
          <p className="about-tech">Tauri 2 · React 19 · CodeMirror 6 · TeX Live / MiKTeX</p>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn primary" onClick={onClose}>
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

export default MenuBar;

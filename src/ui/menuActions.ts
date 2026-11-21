// 菜单动作表（M-macos-menu）：文件/编辑/插入/构建/查看/模板/设置/帮助 全部菜单项的
// id → 动作映射。Windows 自绘菜单栏（MenuBar.tsx）与 macOS 原生菜单桥
// （nativeMenuBridge.ts）共用同一份 handler，保证两端行为一致。
//
// 置灰判定 enabled() 用 store getState() 快照：自绘菜单在渲染时调用（MenuBar 的
// zustand 订阅驱动重渲染，快照即当前值）；原生菜单为静态构建、不随状态置灰，
// 点击时由 nativeMenuBridge 用 enabled() 兜底拦截。
// 注意：纯逻辑测试不 import 本模块（依赖 store/@/ 别名）。
import { confirm, open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { redo, toggleComment, undo } from "@codemirror/commands";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getActiveView } from "@/editor/activeView";
import { useBuffersStore } from "@/editor/useBuffers";
import { useAppStore } from "@/core/store";
import { useSettingsStore } from "@/core/settings";
import { EXT_IMG, useProjectStore, notify } from "@/project/useProject";
import { cancelCompile, startCompile } from "@/compile/useCompile";
import { openEnvGuide } from "@/env/useEnvCheck";
import { jumpToPdfFromSource } from "@/preview/syncTex";
import { moduleRegistry } from "@/core/moduleRegistry";
import { useUpdateStore } from "@/modules/updater/updateStore";
import { importImageFromPaths } from "@/editor/image/importImage";
import { projectApi } from "@/ipc/invoke";
import { formatCleanMessage } from "@/project/cleanOutputs";

/** 有活动编辑器时才可执行编辑类命令 */
function withView(
  fn: (view: NonNullable<ReturnType<typeof getActiveView>>) => void,
) {
  const v = getActiveView();
  if (v) fn(v);
}

// ── 置灰判定（快照版，语义与原 MenuBar 内联订阅一致） ──
function canEdit(): boolean {
  return useBuffersStore.getState().activePath !== null;
}
function canEditText(): boolean {
  const s = useBuffersStore.getState();
  if (s.activePath === null) return false;
  const kind = s.buffers.find((b) => b.path === s.activePath)?.kind ?? null;
  return kind === "text";
}
function hasProject(): boolean {
  return useProjectStore.getState().root !== null;
}
function hasMain(): boolean {
  return !!useProjectStore.getState().tree?.mainFile;
}
function isCompiling(): boolean {
  return useAppStore.getState().compileStatus === "running";
}
function hasLog(): boolean {
  return !!useAppStore.getState().lastResult?.logPath;
}
function tableEnabled(): boolean {
  return moduleRegistry.listViews().some((mv) => mv.view.id === "table");
}

/** 未打开文档 / 当前标签为查看器 的置灰提示 */
function viewerHint(what: string): () => string | undefined {
  return () => (canEdit() ? `当前标签为查看器，不可${what}` : "未打开文档");
}

/** 菜单项动作定义（label 可为动态函数：✓ 勾选、显示/隐藏 等由调用方渲染时求值） */
export interface MenuActionDef {
  label: string | (() => string);
  /** 快捷键提示（自绘菜单右侧展示；原生菜单 accelerator 在 Rust 侧定义） */
  sc?: string;
  /** 置灰判定；缺省视为可用 */
  enabled?: () => boolean;
  /** 置灰原因（title 提示） */
  hint?: () => string | undefined;
  run: () => void;
}

export const menuActions: Record<string, MenuActionDef> = {
  // ── 应用 ──
  "app.about": {
    label: "关于 Zetla",
    run: () => useAppStore.getState().openSettings("about"),
  },
  "app.preferences": {
    label: "偏好设置…",
    sc: "Ctrl+,",
    run: () => useAppStore.getState().openSettings("build"),
  },
  "app.quit": {
    // 经窗口 close() 触发 close-requested 未保存确认（MenuBar 内注册的保护）
    label: "退出",
    run: () => void getCurrentWindow().close(),
  },
  "app.close_window": {
    label: "关闭窗口",
    run: () => void getCurrentWindow().close(),
  },

  // ── 文件 ──
  "file.new_project": {
    label: "新建项目…",
    sc: "Ctrl+Shift+N",
    run: () => useProjectStore.getState().openWizard(),
  },
  "file.open_project": {
    label: "打开项目…",
    sc: "Ctrl+Shift+O",
    run: () => void useProjectStore.getState().openProjectDialog(),
  },
  "file.switch_project": {
    label: "切换项目…",
    sc: "Ctrl+R",
    run: () => useProjectStore.getState().openSwitcher(),
  },
  "file.open_media": {
    label: "打开图片 / PDF…",
    run: async () => {
      const picked = await openFileDialog({
        multiple: true,
        filters: [
          { name: "图片与 PDF", extensions: [...EXT_IMG, "pdf"] },
          { name: "图片", extensions: [...EXT_IMG] },
          { name: "PDF", extensions: ["pdf"] },
        ],
      });
      if (!picked) return;
      const paths = typeof picked === "string" ? [picked] : picked;
      // 图片/PDF 进入代码标签页查看器（不抢占右侧预览）
      await useBuffersStore.getState().openFiles(paths);
    },
  },
  "file.close_project": {
    label: "关闭项目",
    enabled: hasProject,
    hint: () => "未打开项目",
    run: () => void useProjectStore.getState().closeProject(),
  },
  "file.export_zip": {
    label: "导出当前项目为 zip…",
    enabled: hasProject,
    hint: () => "未打开项目",
    run: () => {
      const r = useProjectStore.getState().root;
      if (r) void useProjectStore.getState().exportProject(r);
    },
  },
  "file.save": {
    label: "保存",
    sc: "Ctrl+S",
    enabled: canEditText,
    hint: viewerHint("保存"),
    run: () => {
      const p = useBuffersStore.getState().activePath;
      if (p) void useBuffersStore.getState().saveBuffer(p);
    },
  },
  "file.save_all": {
    label: "全部保存",
    sc: "Ctrl+Shift+S",
    run: () => void useBuffersStore.getState().saveAllBuffers(),
  },
  "file.close_tab": {
    label: "关闭标签",
    sc: "Ctrl+W",
    enabled: canEdit,
    hint: () => "未打开文档",
    run: () => {
      const p = useBuffersStore.getState().activePath;
      if (p) void useBuffersStore.getState().closeBuffer(p);
    },
  },

  // ── 编辑 ──
  "edit.undo": {
    label: "撤销",
    sc: "Ctrl+Z",
    enabled: canEditText,
    hint: viewerHint("编辑"),
    run: () => withView((v) => undo(v)),
  },
  "edit.redo": {
    label: "重做",
    sc: "Ctrl+Y",
    enabled: canEditText,
    hint: viewerHint("编辑"),
    run: () => withView((v) => redo(v)),
  },
  "edit.copy": {
    label: "复制",
    sc: "Ctrl+C",
    enabled: () => false,
    hint: () => "编辑区内已由键盘接管",
    run: () => {},
  },
  "edit.paste": {
    label: "粘贴",
    sc: "Ctrl+V",
    enabled: () => false,
    hint: () => "编辑区内已由键盘接管",
    run: () => {},
  },
  "edit.find": {
    label: "查找",
    sc: "Ctrl+F",
    enabled: () => false,
    hint: () => "查找面板另做（M1）",
    run: () => {},
  },
  "edit.replace": {
    label: "替换",
    sc: "Ctrl+H",
    enabled: () => false,
    hint: () => "查找面板另做（M1）",
    run: () => {},
  },
  "edit.toggle_comment": {
    label: "切换注释",
    sc: "Ctrl+/",
    enabled: canEditText,
    hint: viewerHint("编辑"),
    run: () => withView((v) => toggleComment(v)),
  },
  "insert.snippet": {
    // M2-5b：快捷输入片段浮层入口（不依赖补全扩展；空前缀/非 latex 档位也能插入）
    label: "插入代码片段…",
    sc: "Ctrl+Shift+Space",
    enabled: canEditText,
    hint: viewerHint("插入"),
    run: () => useAppStore.getState().setSnippetPickerOpen(true),
  },

  // ── 插入 ──
  "insert.image": {
    label: "插入图片…",
    enabled: canEditText,
    hint: viewerHint("插入"),
    run: async () => {
      const picked = await openFileDialog({
        multiple: true,
        filters: [{ name: "图片", extensions: [...EXT_IMG] }],
      });
      if (!picked) return;
      const paths = typeof picked === "string" ? [picked] : picked;
      await importImageFromPaths(paths);
    },
  },
  "insert.table_editor": {
    // M1-8：表格编辑器（打开侧栏「表格」视图；模块停用时置灰）
    label: "表格编辑器…",
    sc: "Ctrl+B 5",
    enabled: tableEnabled,
    hint: () => "表格模块已停用（设置 → 模块）",
    run: () => useAppStore.getState().setSidebarView("table"),
  },

  // ── 构建 ──
  "build.start": {
    label: "开始编译",
    sc: "Ctrl+B",
    enabled: () => hasMain() && !isCompiling(),
    hint: () =>
      isCompiling()
        ? "编译进行中"
        : "未打开项目或未识别主文件（.ltex/config.json）",
    run: () => void startCompile(),
  },
  "build.cancel": {
    label: "终止编译",
    enabled: isCompiling,
    hint: () => "当前没有编译任务",
    run: () => void cancelCompile(),
  },
  "build.clean_aux": {
    // M1-41：清除全部编译产物（PDF 也删），用户图片/代码/配置保留；旧 cleanAux 仅供自动清理
    label: "清理构建产物",
    enabled: () => hasProject() && !isCompiling(),
    hint: () => (isCompiling() ? "编译进行中" : "未打开项目"),
    run: async () => {
      const { root, tree } = useProjectStore.getState();
      if (!root) return;
      try {
        // 后端生成快照并只回前 12 条路径；确认后按 token 删除，确认期间新增的文件不会被删
        const preview = await projectApi.previewBuildOutputs(
          root,
          tree?.mainFile ?? "",
          tree?.outputDir ?? null,
        );
        if (preview.total === 0) {
          notify("没有需要清理的构建产物", "ok");
          return;
        }
        const ok = await confirm(
          formatCleanMessage(preview.files, preview.total, preview.dirLabel),
          {
            title: "清理构建产物",
            kind: "warning",
            okLabel: "删除",
            cancelLabel: "取消",
          },
        );
        if (!ok) {
          notify("已取消清理", "ok");
          return;
        }
        const res = await projectApi.cleanBuildOutputs(preview.token);
        if (res.removed > 0 || res.dirsRemoved > 0) {
          // 清理绕过 store，notify 刷新有时序延迟/编译态丢弃风险 → 先主动刷新资源树
          await useProjectStore.getState().refresh(true);
          // 构建文件面板的 effect 不订阅 projectStore，必须单独踢一下
          useAppStore.getState().bumpBuildFilesRev();
        }
        notify(
          `已清除 ${res.removed} 个文件${res.dirsRemoved > 0 ? `、${res.dirsRemoved} 个空目录` : ""}`,
          "ok",
        );
      } catch (e) {
        notify(String(e), "err");
      }
    },
  },
  "build.compile_preview": {
    label: "编译并查看 PDF",
    enabled: () => hasMain() && !isCompiling(),
    hint: () =>
      isCompiling() ? "编译进行中" : "未打开项目或未识别主文件",
    run: () => {
      // 与「开始编译」的区别：先展开预览，编译成功后自动加载
      useAppStore.setState({ previewVisible: true });
      void startCompile();
    },
  },

  // ── 查看 ──
  "view.toggle_sidebar": {
    label: () =>
      `${useAppStore.getState().sidebarVisible ? "隐藏" : "显示"}侧栏`,
    sc: "Ctrl+B 0",
    run: () => useAppStore.getState().toggleSidebar(),
  },
  "view.explorer": {
    // M1-5a：活动栏视图切换（等同点击左侧图标，但不会折叠）
    label: () => {
      const s = useAppStore.getState();
      return `${s.sidebarVisible && s.sidebarView === "explorer" ? "✓ " : ""}资源管理器`;
    },
    sc: "Ctrl+B 1",
    run: () => useAppStore.getState().setSidebarView("explorer"),
  },
  "view.math": {
    // M1-12a：符号面板与公式合并为「公式」单视图（内部 符号/公式库 两页签）
    label: () => {
      const s = useAppStore.getState();
      return `${s.sidebarVisible && s.sidebarView === "math" ? "✓ " : ""}公式`;
    },
    sc: "Ctrl+B 3",
    run: () => useAppStore.getState().setSidebarView("math"),
  },
  "view.references": {
    // M1-14f：引用管理面板
    label: () => {
      const s = useAppStore.getState();
      return `${s.sidebarVisible && s.sidebarView === "references" ? "✓ " : ""}引用`;
    },
    sc: "Ctrl+B 4",
    run: () => useAppStore.getState().setSidebarView("references"),
  },
  "view.toggle_preview": {
    label: () =>
      `${useAppStore.getState().previewVisible ? "隐藏" : "显示"} PDF 预览`,
    run: () => useAppStore.getState().togglePreview(),
  },
  "view.toggle_log": {
    label: () =>
      `${useAppStore.getState().logVisible ? "隐藏" : "显示"}日志面板`,
    run: () => useAppStore.getState().toggleLog(),
  },
  "view.forward_sync": {
    // M1-4：synctex 正向跳转（也可在编辑器里 Ctrl/⌘+点击源码行）
    label: "跳到 PDF 中的位置",
    sc: "Ctrl+点击源码",
    enabled: hasMain,
    hint: () => "未打开项目或未识别主文件",
    run: () => {
      const bs = useBuffersStore.getState();
      if (!bs.activePath) return;
      void jumpToPdfFromSource(bs.activePath, bs.cursor.line, bs.cursor.col);
    },
  },
  "view.theme_auto": {
    // M1-2b：跟随系统（✓ 标记当前是否为 auto；点击从固定亮/暗切回跟随）
    label: () =>
      `${useSettingsStore.getState().settings.general.theme === "auto" ? "✓ " : ""}主题跟随系统`,
    hint: () =>
      useSettingsStore.getState().settings.general.theme === "auto"
        ? "当前跟随系统明暗，点击无变化"
        : "点击后跟随系统明暗（prefers-color-scheme）",
    run: () => useSettingsStore.getState().setTheme("auto"),
  },
  "view.theme_toggle": {
    // 切换项按生效主题取反：auto 时点击 = 固定为当前外观（退出跟随）
    label: () => {
      const s = useSettingsStore.getState();
      return s.effectiveTheme === "dark" ? "切换到亮色主题" : "切换到暗色主题";
    },
    hint: () =>
      useSettingsStore.getState().settings.general.theme === "auto"
        ? "当前跟随系统，点击后固定外观"
        : undefined,
    run: () => {
      const s = useSettingsStore.getState();
      s.setTheme(s.effectiveTheme === "dark" ? "light" : "dark");
    },
  },

  // ── 模板 ──
  "template.library": {
    label: "模板库",
    run: () => useProjectStore.getState().openLibrary(),
  },
  "template.save_as": {
    label: "根据本项目制作模板…",
    enabled: hasProject,
    hint: () => "未打开项目",
    run: () => useProjectStore.getState().openCraft(),
  },

  // ── 设置 ──
  "project.settings": {
    label: "项目设置…",
    enabled: hasProject,
    hint: () => "未打开项目",
    run: () => useProjectStore.getState().openProjectSettings(),
  },

  // ── 帮助 ──
  "help.check_updates": {
    label: "检查更新",
    hint: () => "检测 GitHub / Gitee 上的新版本",
    run: () => {
      const upd = useUpdateStore.getState();
      if (
        upd.status === "update" ||
        upd.status === "downloading" ||
        upd.status === "downloaded"
      ) {
        useAppStore.getState().openSettings("about");
      } else {
        void upd.check();
      }
    },
  },
  "help.env_check": {
    label: "TeX 环境检测…",
    hint: () => "检测 TeX 发行版 / 打开环境引导",
    run: () => void openEnvGuide(),
  },
  "help.open_log": {
    label: "查看日志文件",
    enabled: hasLog,
    hint: () =>
      hasLog()
        ? "用默认程序打开本次编译的 .log"
        : "尚无编译日志（先编译一次）",
    run: () => {
      const logPath = useAppStore.getState().lastResult?.logPath;
      if (!logPath) return;
      void openPath(logPath).catch((e) => notify(String(e), "err"));
    },
  },
};

/** 自绘菜单条目（渲染时由 MenuActionDef 求值成静态值） */
export interface BarItem {
  label: string;
  sc?: string;
  enabled?: boolean;
  hint?: string;
  onClick?: () => void;
  sep?: boolean;
}

/** 把动作 id 求值为自绘菜单条目（调用方需有 zustand 订阅驱动重渲染） */
export function toBarItem(id: string): BarItem {
  const def = menuActions[id];
  if (!def) return { label: id, enabled: false, hint: "未接通的动作" };
  return {
    label: typeof def.label === "function" ? def.label() : def.label,
    sc: def.sc,
    enabled: def.enabled ? def.enabled() : true,
    hint: def.hint ? (def.hint() ?? undefined) : undefined,
    onClick: def.run,
  };
}

/** 菜单分组结构（id 与 Rust native_menu.rs 的 Submenu/MenuItem id 一一对应） */
export interface MenuGroupSpec {
  id: string;
  label: string;
  items: (string | "sep")[];
}

export const MENU_GROUPS: MenuGroupSpec[] = [
  {
    id: "file",
    label: "文件",
    items: [
      "file.new_project",
      "file.open_project",
      "file.switch_project",
      "file.open_media",
      "file.close_project",
      "file.export_zip",
      "sep",
      "file.save",
      "file.save_all",
      "sep",
      "file.close_tab",
      "app.quit",
    ],
  },
  {
    id: "edit",
    label: "编辑",
    items: [
      "edit.undo",
      "edit.redo",
      "sep",
      "edit.copy",
      "edit.paste",
      "sep",
      "edit.find",
      "edit.replace",
      "edit.toggle_comment",
    ],
  },
  {
    id: "insert",
    label: "插入",
    items: ["insert.snippet", "insert.image", "insert.table_editor"],
  },
  {
    id: "build",
    label: "构建",
    items: [
      "build.start",
      "build.cancel",
      "sep",
      "build.clean_aux",
      "build.compile_preview",
    ],
  },
  {
    id: "view",
    label: "查看",
    items: [
      "view.toggle_sidebar",
      "view.explorer",
      "view.math",
      "view.references",
      "view.toggle_preview",
      "view.toggle_log",
      "sep",
      "view.forward_sync",
      "sep",
      "view.theme_auto",
      "view.theme_toggle",
    ],
  },
  {
    id: "template",
    label: "模板",
    items: ["template.library", "sep", "template.save_as"],
  },
  { id: "settings", label: "设置", items: ["app.preferences", "project.settings"] },
  {
    id: "help",
    label: "帮助",
    items: [
      "help.check_updates",
      "help.env_check",
      "help.open_log",
      "sep",
      "app.about",
    ],
  },
];

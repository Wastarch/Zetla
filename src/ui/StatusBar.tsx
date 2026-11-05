// M0-6 · 全局状态栏（对齐 mockup UI.html .statusbar）
// 左：状态点 + 编译文案 + 进度条 + 日志⛔ + 引擎 chip⛔
// 右（.right 组）：行/列 · LaTeX 语言 · 当前文件/脏 · 编码 · 换行
// M0-13 前移：光标位置从编辑器内部状态行上提到此处；移除设置/主题按钮（设置 M1 · 主题 M3）
// M0-9：编译文案按钮触发编译/取消、日志按钮开合面板、引擎 chip 显示生效引擎
// M1-3：引擎 chip 显示「设置页显式值 ?? 项目 config」的生效引擎，点击打开设置→编译设置切换
// M1-14j：文档语言 chip 不再写死 LaTeX——按扩展名识别（langByExt），点击可手动切换/恢复自动
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/ui/Icon";
import { InsertCtxMenu, type CtxAction } from "@/ui/InsertCtxMenu";
import { getLastUsedRecipe, loadRecipes, setLastUsedRecipe } from "@/compile/recipePicker";
import type { RecipeInfo } from "@/types";
import { useAppStore } from "@/core/store";
import { useBuffersStore } from "@/editor/useBuffers";
import { base, extOf, useProjectStore } from "@/project/useProject";
import { cancelCompile, effectiveEngine, engineLabel, startCompile } from "@/compile/useCompile";
import { openEnvGuide } from "@/env/useEnvCheck";
import { useSettingsStore } from "@/core/settings";
import { LANG_META, LANG_ORDER, isKnownExt, langLabel, langOf } from "@/editor/langByExt";
import { useLangOverride } from "@/editor/langOverride";

const DOT_CLASS: Record<string, string> = {
  running: "run",
  ok: "ok",
  error: "err",
};

export function StatusBar() {
  const compileStatus = useAppStore((s) => s.compileStatus);
  const active = useBuffersStore((s) =>
    s.activePath ? s.buffers.find((b) => b.path === s.activePath) ?? null : null,
  );
  const cursor = useBuffersStore((s) => s.cursor);
  const logVisible = useAppStore((s) => s.logVisible);
  const toggleLog = useAppStore((s) => s.toggleLog);
  const tree = useProjectStore((s) => s.tree);
  const hasMain = !!tree?.mainFile;
  const env = useAppStore((s) => s.env);
  // M1-3：设置页显式引擎覆盖项目 config（"auto" 时跟随项目）
  const engineSetting = useSettingsStore((s) => s.settings.build.engine);
  const activeEngine = tree ? effectiveEngine(engineSetting, tree.engine) : null;

  const running = compileStatus === "running";
  const statusText =
    compileStatus === "idle"
      ? "待编译"
      : compileStatus === "running"
        ? "编译中…"
        : compileStatus === "ok"
          ? "编译通过"
          : compileStatus === "error"
            ? "编译失败"
            : "已取消";
  const dirty = !!active && active.content !== active.savedContent;

  // M2：编译按钮右键 / 长按 → 临时指定本次编译流程；lastUsed 存 localStorage（不进配置协议）
  const [recipeMenu, setRecipeMenu] = useState<{ x: number; y: number } | null>(null);
  const [recipes, setRecipes] = useState<RecipeInfo[]>([]);
  const [lastUsed, setLastUsed] = useState<string | null>(getLastUsedRecipe());
  const holdTimer = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);
  const clearHold = () => {
    if (holdTimer.current !== undefined) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = undefined;
    }
  };
  const openRecipeMenu = (x: number, y: number) => {
    setRecipeMenu({ x, y });
    setLastUsed(getLastUsedRecipe());
    // 每次打开都重新查，保证设置页新增/删除流程后立即反映（无缓存 stale）
    void loadRecipes(engineSetting).then(setRecipes);
  };
  useEffect(() => () => clearHold(), []);

  // M1-14j：文档语言 = 手动指定 ?? 按扩展名识别；点击 chip 切换/恢复自动
  const [langMenu, setLangMenu] = useState<{ x: number; y: number } | null>(null);
  const setLang = useLangOverride((s) => s.setLang);
  const langOverride = useLangOverride((s) => (active ? s.byPath[active.path] ?? null : null));
  const detected = active ? langOf(active.path) : "latex";
  const lang = langOverride ?? detected;
  const ext = active ? extOf(active.path) : "";
  const langTitle = active
    ? [
        langLabel(lang),
        langOverride ? "手动指定" : "按扩展名自动识别",
        ext ? `.${ext}` : "无扩展名",
        isKnownExt(active.path) ? "" : "该扩展名未收录，按纯文本渲染",
        "点击切换文档语言",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <footer className="statusbar">
      {/* 编译状态（占位） */}
      <span className="stat-ico">
        <span className={`dot ${DOT_CLASS[compileStatus] ?? ""}`} />
      </span>
      <button
        type="button"
        className="sbtn"
        disabled={!running && !hasMain}
        title={
          running
            ? "取消编译 · 右键/长按可选择编译流程"
            : hasMain
              ? "开始编译 (Ctrl+B) · 右键/长按可选择编译流程"
              : "未打开项目或未识别主文件"
        }
        onClick={() => {
          // 长按已弹出菜单，随后的 click 不再触发普通编译
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          void (running ? cancelCompile() : startCompile());
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          clearHold();
          openRecipeMenu(e.clientX, e.clientY);
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          longPressed.current = false;
          const rect = e.currentTarget.getBoundingClientRect();
          clearHold();
          holdTimer.current = window.setTimeout(() => {
            longPressed.current = true;
            holdTimer.current = undefined;
            openRecipeMenu(rect.left, rect.top);
          }, 480);
        }}
        onPointerUp={clearHold}
        onPointerLeave={clearHold}
        onPointerCancel={clearHold}
      >
        {statusText}
      </button>
      <div className={running ? "bar-progress on" : "bar-progress"}>
        <i />
      </div>

      <span className="divider" />
      <button
        type="button"
        className={logVisible ? "sbtn on" : "sbtn"}
        title={logVisible ? "收起编译日志" : "打开编译日志"}
        onClick={toggleLog}
      >
        <Icon name="terminal" />
        日志
      </button>

      <span className="divider" />
      <button
        type="button"
        className="sbtn"
        title="当前生效的编译引擎 · 点击在 设置 → 编译设置 中切换（默认跟随项目 .ltex/config.json）"
        onClick={() => useAppStore.getState().openSettings("build")}
      >
        引擎 <span className="engine-chip">{tree ? engineLabel(activeEngine) : "—"}</span>
      </button>

      {/* M0-15a：TeX 环境 chip（点击打开环境引导） */}
      <span className="divider" />
      <button
        type="button"
        className="sbtn"
        title={
          env === null
            ? "尚未检测 TeX 环境 · 点击检测"
            : env.found
              ? `${env.distribution ?? "TeX"}${env.version ? ` · ${env.version}` : ""} · 点击查看详情`
              : "未检测到 TeX 发行版 · 点击打开环境引导"
        }
        onClick={() => void openEnvGuide()}
      >
        <Icon name="tex" />
        {env === null ? "TeX 未检测" : env.found ? env.distribution ?? "TeX" : "无 TeX"}
      </button>

      {/* 右侧：光标 / 语言 / 文件 / 编码 / 换行 */}
      {active && (
        <>
          <span className="divider" />
          <div className="sbtn right caret-info" title="光标位置">
            行 {cursor.line}，列 {cursor.col}
          </div>
          <button
            type="button"
            className={langOverride ? "sbtn on" : "sbtn"}
            title={langTitle}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setLangMenu({ x: r.left, y: r.top });
            }}
          >
            {langLabel(lang)}
          </button>
          <span className="divider" />
          <button
            type="button"
            className="sbtn"
            disabled
            title={active.path}
          >
            <span className="sfile">{base(active.path)}</span>
            {dirty && <span className="sdirty">● 未保存</span>}
          </button>
          <button type="button" className="sbtn" disabled title="文件编码">
            {active.encoding.toUpperCase()}
          </button>
          <button type="button" className="sbtn" disabled title="换行符">
            {active.eol === "crlf" ? "CRLF" : "LF"}
          </button>
        </>
      )}
      {/* M2：编译流程选择菜单（右键 / 长按触发；内置与自定义分组显示，主项 = 上次临时选择） */}
      {recipeMenu && (
        <InsertCtxMenu
          x={recipeMenu.x}
          y={recipeMenu.y}
          onClose={() => setRecipeMenu(null)}
          actions={[
            {
              label: "按默认流程编译",
              hint: lastUsed
                ? `使用设置 → 编译设置中的默认流程（上次临时选择：${lastUsed}）`
                : "使用设置 → 编译设置中的默认流程",
              primary: !lastUsed,
              onClick: () => {
                setLastUsedRecipe(null);
                setLastUsed(null);
                void startCompile();
              },
            },
            ...recipes.map<CtxAction>((r) => ({
              label: `${r.name}${r.builtin ? " · 内置" : " · 自定义"}`,
              hint: `步骤：${r.tools.join(" → ") || "（空流程）"}${r.builtin ? " · 不可删" : ""}`,
              primary: r.name === lastUsed,
              onClick: () => {
                setLastUsedRecipe(r.name);
                setLastUsed(r.name);
                void startCompile({ recipe: r.name });
              },
            })),
            {
              label: "管理编译流程…",
              hint: "打开 设置 → 编译设置，增删工具与流程",
              onClick: () => useAppStore.getState().openSettings("build"),
            },
          ]}
        />
      )}
      {/* M1-14j：文档语言切换菜单（复用项目树右键菜单样式；视口夹取由 InsertCtxMenu 负责） */}
      {langMenu && active && (
        <InsertCtxMenu
          x={langMenu.x}
          y={langMenu.y}
          onClose={() => setLangMenu(null)}
          actions={[
            ...LANG_ORDER.map<CtxAction>((id) => ({
              label:
                id === detected ? `${LANG_META[id].label}（自动识别）` : LANG_META[id].label,
              hint: LANG_META[id].desc,
              primary: id === lang,
              // 选中「自动识别」即清除手动覆盖，避免与扩展名冲突
              onClick: () => setLang(active.path, id === detected ? null : id),
            })),
            ...(langOverride
              ? [
                  {
                    label: "恢复自动识别",
                    hint: `清除手动指定，按 ${ext ? `.${ext}` : "扩展名"} 重新识别`,
                    onClick: () => setLang(active.path, null),
                  },
                ]
              : []),
          ]}
        />
      )}
      {/* M0-14a：偏好设置入口（mockup 状态栏右端「设置」按钮） */}
      <button
        type="button"
        className="sbtn"
        title="偏好设置 (Ctrl+,)"
        onClick={() => useAppStore.getState().openSettings()}
      >
        <Icon name="sliders" />
        设置
      </button>
    </footer>
  );
}

export default StatusBar;

// M1-17 扩展 · 语法高亮主题预设注册表（方案 A：预设数据化，不引入外部运行时依赖）
//
// 每个预设是一组「可扩展分组」（HighlightGroup[]），分组数量不限、各自携带 lezer 标签名。
// 预设配色取自各流行主题公开的标准色值（GitHub / Dracula / Solarized / Nord 等），
// 用户可继续在对话框里微调并导出/导入。新增主题只需在此追加一份 palette。
import { DEFAULT_LATEX_HIGHLIGHT, type HighlightGroup } from "@/types/settings";

/**
 * 预设覆盖的 lezer 标签（顺序即设置页展示顺序）及中文展示名。
 * 增删标签即扩充分组的能力边界；外部主题库里更多标签也可随时加入。
 */
export const PRESET_TAG_LABELS: Record<string, string> = {
  comment: "注释",
  string: "字符串",
  number: "数字",
  keyword: "控制序列（\\cmd / \\begin / \\end）",
  operator: "数学符号 / $",
  variableName: "变量名",
  propertyName: "属性名",
  className: "环境名 / 类名",
  labelName: "\\label / \\ref",
  quote: "\\cite",
  heading: "章节命令",
  emphasis: "斜体文本",
  strong: "加粗文本",
  monospace: "等宽文本",
  link: "链接",
  bool: "布尔值",
  null: "空值",
  atom: "原子常量",
  meta: "verbatim 内容 / 正文",
  bracket: "括号",
  invalid: "非法字符",
};

export const PRESET_TAG_ORDER: string[] = Object.keys(PRESET_TAG_LABELS);

interface Palette {
  light: string;
  dark: string;
}

/** 由「标签名 → 亮/暗色」的 palette 生成 HighlightGroup[]（缺省标签自动跳过） */
function buildGroups(palette: Record<string, Palette>): HighlightGroup[] {
  return PRESET_TAG_ORDER.filter((tag) => palette[tag]).map((tag) => ({
    id: tag,
    label: PRESET_TAG_LABELS[tag],
    tags: [tag],
    light: palette[tag].light,
    dark: palette[tag].dark,
  }));
}

export interface HighlightPreset {
  /** 预设 id（与分组 id 可复用；用于下拉回显与导入比对） */
  id: string;
  /** 展示名 */
  name: string;
  /** 完整分组（亮/暗双色） */
  groups: HighlightGroup[];
}

// ── 各主题 palette（亮/暗双份，使用公开标准色值） ──────────────────────────────

// GitHub Light / Dark（github.com 编辑器配色）
const GITHUB: Record<string, Palette> = {
  comment: { light: "#6e7781", dark: "#8b949e" },
  string: { light: "#0a3069", dark: "#a5d6ff" },
  number: { light: "#0550ae", dark: "#79c0ff" },
  keyword: { light: "#cf222e", dark: "#ff7b72" },
  operator: { light: "#0550ae", dark: "#79c0ff" },
  variableName: { light: "#24292f", dark: "#e6edf3" },
  propertyName: { light: "#953800", dark: "#d2a8ff" },
  className: { light: "#1f6feb", dark: "#79c0ff" },
  labelName: { light: "#1f6feb", dark: "#79c0ff" },
  quote: { light: "#0a3069", dark: "#a5d6ff" },
  heading: { light: "#0550ae", dark: "#79c0ff" },
  emphasis: { light: "#24292f", dark: "#e6edf3" },
  strong: { light: "#24292f", dark: "#e6edf3" },
  monospace: { light: "#24292f", dark: "#e6edf3" },
  link: { light: "#0969da", dark: "#58a6ff" },
  bool: { light: "#0550ae", dark: "#79c0ff" },
  null: { light: "#0550ae", dark: "#79c0ff" },
  atom: { light: "#0550ae", dark: "#79c0ff" },
  meta: { light: "#6e7781", dark: "#8b949e" },
  bracket: { light: "#24292f", dark: "#e6edf3" },
  invalid: { light: "#cf222e", dark: "#ff7b72" },
};

// Dracula（暗色为主，亮色为近似浅色变体）
const DRACULA: Record<string, Palette> = {
  comment: { light: "#7a7f9e", dark: "#6272a4" },
  string: { light: "#8954a8", dark: "#f1fa8c" },
  number: { light: "#6c49b8", dark: "#bd93f9" },
  keyword: { light: "#e02e6e", dark: "#ff79c6" },
  operator: { light: "#e02e6e", dark: "#ff79c6" },
  variableName: { light: "#282a36", dark: "#f8f8f2" },
  propertyName: { light: "#2b8a3e", dark: "#50fa7b" },
  className: { light: "#0076ad", dark: "#8be9fd" },
  labelName: { light: "#0076ad", dark: "#8be9fd" },
  quote: { light: "#8954a8", dark: "#f1fa8c" },
  heading: { light: "#6c49b8", dark: "#bd93f9" },
  emphasis: { light: "#282a36", dark: "#f8f8f2" },
  strong: { light: "#282a36", dark: "#f8f8f2" },
  monospace: { light: "#282a36", dark: "#f8f8f2" },
  link: { light: "#0076ad", dark: "#8be9fd" },
  bool: { light: "#6c49b8", dark: "#bd93f9" },
  null: { light: "#6c49b8", dark: "#bd93f9" },
  atom: { light: "#6c49b8", dark: "#bd93f9" },
  meta: { light: "#7a7f9e", dark: "#6272a4" },
  bracket: { light: "#282a36", dark: "#f8f8f2" },
  invalid: { light: "#e02e6e", dark: "#ff5555" },
};

// Solarized Light / Dark（ethanschoonover 标准调色板）
const SOLARIZED: Record<string, Palette> = {
  comment: { light: "#93a1a1", dark: "#586e75" },
  string: { light: "#2aa198", dark: "#2aa198" },
  number: { light: "#d33682", dark: "#d33682" },
  keyword: { light: "#859900", dark: "#859900" },
  operator: { light: "#cb4b16", dark: "#cb4b16" },
  variableName: { light: "#657b83", dark: "#839496" },
  propertyName: { light: "#b58900", dark: "#b58900" },
  className: { light: "#268bd2", dark: "#268bd2" },
  labelName: { light: "#268bd2", dark: "#268bd2" },
  quote: { light: "#2aa198", dark: "#2aa198" },
  heading: { light: "#268bd2", dark: "#268bd2" },
  emphasis: { light: "#657b83", dark: "#839496" },
  strong: { light: "#657b83", dark: "#839496" },
  monospace: { light: "#657b83", dark: "#839496" },
  link: { light: "#268bd2", dark: "#268bd2" },
  bool: { light: "#d33682", dark: "#d33682" },
  null: { light: "#d33682", dark: "#d33682" },
  atom: { light: "#d33682", dark: "#d33682" },
  meta: { light: "#93a1a1", dark: "#586e75" },
  bracket: { light: "#657b83", dark: "#839496" },
  invalid: { light: "#dc322f", dark: "#dc322f" },
};

// Nord（暗色为主，亮色为 Snow Storm 浅色变体）
const NORD: Record<string, Palette> = {
  comment: { light: "#8b97a8", dark: "#616e88" },
  string: { light: "#5e7d4f", dark: "#a3be8c" },
  number: { light: "#8f5da3", dark: "#b48ead" },
  keyword: { light: "#5e81ac", dark: "#81a1c1" },
  operator: { light: "#5e81ac", dark: "#81a1c1" },
  variableName: { light: "#2e3440", dark: "#d8dee9" },
  propertyName: { light: "#6c8c62", dark: "#8fbcbb" },
  className: { light: "#4a87a0", dark: "#88c0d0" },
  labelName: { light: "#4a87a0", dark: "#88c0d0" },
  quote: { light: "#5e7d4f", dark: "#a3be8c" },
  heading: { light: "#4a87a0", dark: "#88c0d0" },
  emphasis: { light: "#2e3440", dark: "#d8dee9" },
  strong: { light: "#2e3440", dark: "#d8dee9" },
  monospace: { light: "#2e3440", dark: "#d8dee9" },
  link: { light: "#4a87a0", dark: "#88c0d0" },
  bool: { light: "#8f5da3", dark: "#b48ead" },
  null: { light: "#8f5da3", dark: "#b48ead" },
  atom: { light: "#8f5da3", dark: "#b48ead" },
  meta: { light: "#8b97a8", dark: "#616e88" },
  bracket: { light: "#2e3440", dark: "#d8dee9" },
  invalid: { light: "#bf616a", dark: "#bf616a" },
};

/** 内置主题预设（zetla 默认 + 若干流行主题；数量可继续扩展） */
export const BUILTIN_HIGHLIGHT_PRESETS: HighlightPreset[] = [
  { id: "zetla", name: "Zetla 默认", groups: DEFAULT_LATEX_HIGHLIGHT },
  { id: "github", name: "GitHub", groups: buildGroups(GITHUB) },
  { id: "dracula", name: "Dracula", groups: buildGroups(DRACULA) },
  { id: "solarized", name: "Solarized", groups: buildGroups(SOLARIZED) },
  { id: "nord", name: "Nord", groups: buildGroups(NORD) },
];

export function findPreset(id: string): HighlightPreset | undefined {
  return BUILTIN_HIGHLIGHT_PRESETS.find((p) => p.id === id);
}

/** 深拷贝分组（避免应用预设后编辑误改预设常量） */
export function cloneGroups(groups: HighlightGroup[]): HighlightGroup[] {
  return groups.map((g) => ({ ...g, tags: [...g.tags] }));
}

function sameGroups(a: HighlightGroup[], b: HighlightGroup[]): boolean {
  if (a.length !== b.length) return false;
  const key = (g: HighlightGroup) =>
    `${g.id}|${[...g.tags].sort().join(",")}|${g.light}|${g.dark}`;
  const set = new Set(a.map(key));
  return b.every((g) => set.has(key(g)));
}

/** 当前分组是否完全命中某个预设（用于下拉回显「自定义」）；未命中返回 null */
export function matchPresetId(groups: HighlightGroup[] | undefined): string | null {
  if (!groups || groups.length === 0) return null;
  for (const p of BUILTIN_HIGHLIGHT_PRESETS) {
    if (sameGroups(p.groups, groups)) return p.id;
  }
  return null;
}

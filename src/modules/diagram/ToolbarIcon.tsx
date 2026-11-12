// M2 · 绘图画布工具条图标（无新增依赖、无图片请求）。
// 统一 16×16 viewBox + currentColor 描边，跟随 F3-8 主题 token；
// 纯展示组件，点击 / 禁用 / aria-pressed 仍由外层 button 负责。
export type ToolbarIconName =
  | "handles"
  | "group"
  | "ungroup"
  | "undo"
  | "redo"
  | "delete"
  | "hand"
  | "fitCanvas"
  | "fitContent"
  | "zoomOut"
  | "fitPage"
  | "zoomIn";

export function ToolbarIcon({ name }: { name: ToolbarIconName }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === "handles" && (
        <>
          <path d="M4 2v4M2 4h4M12 2v4M10 4h4M4 10v4M2 12h4M12 10v4M10 12h4" />
        </>
      )}
      {name === "group" && (
        <>
          <rect x="2" y="2" width="8" height="8" rx="1" />
          <rect x="6" y="6" width="8" height="8" rx="1" />
        </>
      )}
      {name === "ungroup" && (
        <>
          <rect x="1.5" y="6.5" width="6" height="6" rx="1" />
          <rect x="8.5" y="3.5" width="6" height="6" rx="1" />
          <path d="M6.5 4.5 8 3M8 13l1.5-1.5" />
        </>
      )}
      {name === "undo" && (
        <>
          <path d="M10 7.5H4" />
          <path d="M6.5 5 4 7.5 6.5 10" />
          <path d="M10.5 11.5H8" />
        </>
      )}
      {name === "redo" && (
        <>
          <path d="M6 7.5h6" />
          <path d="M9.5 5 12 7.5 9.5 10" />
          <path d="M5.5 11.5H8" />
        </>
      )}
      {name === "delete" && (
        <>
          <path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9" />
          <path d="M6.5 7v4M9.5 7v4" />
        </>
      )}
      {name === "hand" && (
        <>
          <path d="M5 9V4.2a1 1 0 0 1 2 0V8" />
          <path d="M7 7.2V3.2a1 1 0 0 1 2 0V7" />
          <path d="M9 7.2V4.2a1 1 0 0 1 2 0V8" />
          <path d="M11 7.5a1 1 0 0 1 2 0v3.2c0 2.4-1.8 4.3-4.2 4.3H8.4c-1.1 0-2.1-.4-2.8-1.2L3.4 11a1.1 1.1 0 0 1 1.6-1.5L7 11.5" />
        </>
      )}
      {name === "fitCanvas" && (
        <>
          <rect x="2" y="2" width="12" height="12" rx="1" />
          <path d="M5 2v2M2 5h2M11 2v2M14 5h2M5 14v-2M2 11h2M11 14v-2M14 11h2" />
        </>
      )}
      {name === "fitContent" && (
        <>
          <rect x="2" y="3" width="12" height="10" rx="1" strokeDasharray="2 2" />
          <path d="m5 10 2-3 2 2 2-3" />
        </>
      )}
      {name === "zoomOut" && (
        <>
          <circle cx="7" cy="7" r="4.5" />
          <path d="M5 7h4M10.5 10.5 14 14" />
        </>
      )}
      {name === "fitPage" && (
        <>
          <path d="M4 1.5h5l3 3v10H4z" />
          <path d="M9 1.5v3h3M6 8h4M6 11h4" />
        </>
      )}
      {name === "zoomIn" && (
        <>
          <circle cx="7" cy="7" r="4.5" />
          <path d="M5 7h4M5 5.5v3M10.5 10.5 14 14" />
        </>
      )}
    </svg>
  );
}

export default ToolbarIcon;

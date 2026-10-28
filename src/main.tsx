import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// 正式版（PROD）禁用 WebView2 原生右键菜单：WebView2 默认会弹出「返回/刷新/另存为/
// 打印/更多工具」等系统菜单，既干扰自绘菜单（src/project/CtxMenu.tsx 等），又可能暴露
// 调试入口。仅生产构建生效；开发版保留原生菜单以便右键→检查调试。
// 用捕获阶段 preventDefault，确保原生菜单一律不出现，而自绘菜单（自身已 preventDefault/
// stopPropagation）仍正常弹出。
if (import.meta.env.PROD) {
  document.addEventListener(
    "contextmenu",
    (e) => e.preventDefault(),
    true,
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

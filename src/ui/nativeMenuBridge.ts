// macOS 原生菜单事件桥（M-macos-menu）：Rust native_menu.rs 菜单点击 →
// emit("menu-action", id) → 此处查 menuActions.ts 动作表分发。
// 置灰兜底：原生菜单为静态构建、不随前端状态刷新，点击时用 enabled() 拦截。
// 模块级单例：React StrictMode 假卸载不重复注册（注册后常驻，与 App 生命周期一致）。
import { listen } from "@tauri-apps/api/event";
import { menuActions } from "./menuActions";

let unlisten: (() => void) | null = null;

export function startNativeMenuBridge(): void {
  if (unlisten) return;
  void listen<string>("menu-action", (e) => {
    const def = menuActions[e.payload];
    if (!def) return;
    if (def.enabled && !def.enabled()) return;
    def.run();
  }).then((u) => {
    unlisten = u;
  });
}

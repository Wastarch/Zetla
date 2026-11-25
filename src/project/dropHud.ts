// M1-49 · 系统文件拖入时的应用内落点提示（HUD）
//
// 系统拖拽时 Windows 只画自己的缩略图，应用内原本只有「目标行描边」这一处反馈：
// 用户看不出「松手会落到哪个目录」「一共拖进来几项」。这里在指针旁浮一块小卡：
//   [↓]  main.png
//        松手复制到 figures
// 拖离树时卡片改成「拖到左侧资源管理器内松手」，并把树整体加一圈提示描边。
//
// 为什么用命令式 DOM 而不是 React state：DRAG_OVER 是高频事件（每秒几十次），
// 每帧 setState 会带着整棵树重渲染；这里只改一个绝对定位元素的 transform / 文本。

import { externalDropHint } from "./treeDrop";

export interface DropHud {
  /** 当前落点目录（null = 指针不在树上） */
  setTarget: (dir: string | null) => void;
  /** 跟随指针（视口 CSS 坐标） */
  move: (clientX: number, clientY: number) => void;
  hide: () => void;
}

/** 同一时刻只允许一个 HUD（重复拖入先清旧的） */
let current: HTMLElement | null = null;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/**
 * 生成浮层。count 为本次拖入的条目数，names 用于单条目时显示文件名。
 * 默认浮在指针左侧 18px：Windows 的拖拽缩略图画在指针右下，放左边不易被盖住。
 */
export function createDropHud(count: number, names: string[]): DropHud {
  hideDropHud();

  const wrap = el("div", "drop-hud");
  wrap.setAttribute("aria-hidden", "true");

  const icon = el("span", "drop-hud-icon");
  icon.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">' +
    '<path d="M8 2.2v7.1M5 6.6 8 9.6l3-3M3.2 12.6h9.6" fill="none" stroke="currentColor" ' +
    'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const body = el("div", "drop-hud-body");
  const title = el("div", "drop-hud-title");
  const single = count === 1 ? (names[0] ?? null) : null;
  const initial = externalDropHint(count, single, null);
  title.textContent = initial.title;
  title.title = single ?? names.slice(0, 5).join("\n");

  const hint = el("div", "drop-hud-hint", initial.hint);
  body.append(title, hint);

  wrap.append(icon, body);
  document.body.appendChild(wrap);
  current = wrap;

  let lastX = 0;
  let lastY = 0;
  const place = () => {
    const w = wrap.offsetWidth;
    const h = wrap.offsetHeight;
    // 优先放指针**左侧**：Windows 的拖拽缩略图画在指针右下，放左边不容易被盖住
    let x = lastX - w - 18;
    if (x < 8) x = lastX + 18;
    x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    const y = Math.max(8, Math.min(lastY + 18, window.innerHeight - h - 8));
    wrap.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };

  return {
    setTarget: (dir) => {
      const inside = !!dir;
      wrap.classList.toggle("is-away", !inside);
      hint.textContent = externalDropHint(count, single, dir).hint;
    },
    move: (x, y) => {
      lastX = x;
      lastY = y;
      place();
    },
    hide: () => {
      wrap.remove();
      if (current === wrap) current = null;
    },
  };
}

/** 兜底清理（组件卸载 / 新一次拖入） */
export function hideDropHud(): void {
  current?.remove();
  current = null;
}

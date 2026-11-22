// M1-27 · 拖拽影像（drag ghost）：让标签页 / 项目树条目在拖动时看起来
// 真的被"抓起来"——鼠标旁浮一个与原节点同款的小影像跟随移动。
// 两处拖拽都用指针事件模拟（Tauri Windows 会拦截 HTML5 拖放，编辑器仍需原生
// 文件拖入），没有 dataTransfer 可用 setDragImage，故自行造 DOM 影像。

export interface DragGhost {
  /** 跟随指针移动（用 transform，不触发重排） */
  move: (x: number, y: number) => void;
  /** 切换"复制"角标（项目树 Ctrl / macOS Option 拖拽时显示 ＋） */
  setCopy: (copy: boolean) => void;
  /** 移除影像，拖拽结束/cancel 时调用 */
  hide: () => void;
}

/**
 * 克隆 node 生成一个浮在 body 上的影像。
 * - 固定宽度：clone 脱离 flex 容器后会掉宽，必须显式钉住。
 * - 保留抓取相对位置：记下指针在元素内的偏移，影像不会跳到鼠标左上角。
 * - 清掉 data-tree-* 与拖拽态 class：落点测试用 elementFromPoint +
 *   [data-tree-path]，且影像应是实心的"原物"，不能半透明或带落点高亮。
 * - count > 1 时右下角加数字徽标（M1-40 项目树多选拖拽）。
 */
export function createDragGhost(
  node: HTMLElement,
  clientX: number,
  clientY: number,
  count = 0,
): DragGhost {
  const rect = node.getBoundingClientRect();
  const clone = node.cloneNode(true) as HTMLElement;

  clone.classList.remove("is-dragging", "drop-ok", "drop-bad");
  clone.removeAttribute("data-tree-path");
  clone.removeAttribute("data-tree-kind");
  clone.querySelectorAll("[data-tree-path]").forEach((el) => {
    el.removeAttribute("data-tree-path");
    el.removeAttribute("data-tree-kind");
  });

  const inner = document.createElement("div");
  inner.className = "drag-ghost-inner";
  inner.appendChild(clone);

  const badge = document.createElement("span");
  badge.className = "drag-ghost-badge";
  badge.textContent = "+";
  inner.appendChild(badge);

  if (count > 1) {
    const cnt = document.createElement("span");
    cnt.className = "drag-ghost-count";
    cnt.textContent = count > 99 ? "99+" : String(count);
    inner.appendChild(cnt);
  }

  const wrap = document.createElement("div");
  wrap.className = "drag-ghost";
  wrap.style.width = `${rect.width}px`;
  wrap.appendChild(inner);
  document.body.appendChild(wrap);

  const offX = clientX - rect.left;
  const offY = clientY - rect.top;
  const move = (x: number, y: number) => {
    wrap.style.transform = `translate3d(${x - offX}px, ${y - offY}px, 0)`;
  };
  move(clientX, clientY);

  return {
    move,
    setCopy: (copy) => wrap.classList.toggle("is-copy", copy),
    hide: () => wrap.remove(),
  };
}

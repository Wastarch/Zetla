// M1-32：代码折叠箭头 marker —— 与项目树同款 #i-chev sprite。
// CM6 的 foldGutter({ markerDOM }) 语义：open=true 表示「当前已展开、可折叠」（原 ⌄），
// open=false 表示「当前已折叠、可展开」（原 ›）。这与 ui/Chevron 的 open 语义一致：
// 展开态朝下（rotate 90°）、折叠态朝右（rotate 0°），故直接复用同一角度口径。

/** 折叠态 → 0°（向右 chevron）；展开态 → 90°（向下 chevron） */
export function foldChevronAngle(open: boolean): 0 | 90 {
  return open ? 90 : 0;
}

/** 折叠标记尺寸，与项目树 Icon chev size=12 一致 */
export const FOLD_CHEV_SIZE = 12;

/**
 * 供 CM6 `foldGutter({ markerDOM })` 使用的 DOM 构造：
 * 用 #i-chev sprite 渲染同款 chevron，角度由 open 决定。
 * CM6 会把返回节点插入 .cm-foldGutter 的 gutterElement，居中由 CSS 负责。
 */
export function createFoldMarkerDOM(open: boolean): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "cm-fold-chev";
  // 与 ui/Chevron → Icon 的输出结构一致：svg.ic > use[href="#i-chev"]
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ic");
  svg.setAttribute("width", String(FOLD_CHEV_SIZE));
  svg.setAttribute("height", String(FOLD_CHEV_SIZE));
  svg.setAttribute("aria-hidden", "true");
  svg.style.transform = `rotate(${foldChevronAngle(open)}deg)`;
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#i-chev");
  svg.appendChild(use);
  wrap.appendChild(svg);
  return wrap;
}

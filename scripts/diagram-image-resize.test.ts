// M2 · 图片插入 TikZ · P5（缩放 8 点柄）：图片节点尺寸编辑的纯逻辑回归。
// 覆盖 planImageNodeResize / nodeHasIncludeGraphics：缩放图片节点时直接改写
// \includegraphics 宽高、移除 text width / minimum height、补 inner sep=0，不再只改文本框。
// Node --experimental-strip-types 直测，无 DOM / Tauri 依赖。
import { nodeHasIncludeGraphics, planImageNodeResize } from "../src/modules/diagram/imageNodeInsert.ts";
import type { NodeTextSpan, TikzStatement } from "../src/modules/diagram/optionsEdit.ts";

let pass = 0;
let fail = 0;
function check(cond: boolean, label: string): void {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    console.error("  ✗ " + label);
  }
}

/** 用 indexOf 推导 span，避免手写偏移出错。 */
function mkNode(opts: string, content: string): { src: string; stmt: TikzStatement } {
  const hasOpts = opts.trim().length > 0;
  const src = hasOpts
    ? `\\node[${opts}] at (0,0) {${content}};`
    : `\\node at (0,0) {${content}};`;
  const ob = src.indexOf("[");
  const cb = src.indexOf("]");
  const optionsSpan = hasOpts ? { from: ob, to: cb + 1 } : null;
  const optionsRaw = hasOpts ? src.slice(ob, cb + 1) : null;
  const afterCmd = src.indexOf("\\node") + 5;
  const openBrace = src.indexOf("{", hasOpts ? cb : afterCmd);
  const closeBrace = src.lastIndexOf("}");
  const contentSpan = { from: openBrace + 1, to: closeBrace };
  const nodeTexts: NodeTextSpan[] = [
    { id: "path:0", span: contentSpan, text: content, source: "group" },
  ];
  const stmt: TikzStatement = {
    id: "path:0",
    kind: "Path",
    command: "node",
    span: { from: 0, to: src.length },
    optionsSpan,
    optionsRaw,
    entries: [],
    insertOffset: afterCmd,
    topLevel: true,
    nodeTexts,
  };
  return { src, stmt };
}

// ── A：用户真实场景 —— 节点带 text width / minimum height，图只有 1cm ──────────────
{
  const { src, stmt } = mkNode(
    "text width=3.86cm, minimum height=0.69cm",
    "\\includegraphics[width=1cm]{figure/x.png}",
  );
  const plan = planImageNodeResize({ source: src, statement: stmt, newWidthCm: 7.72, newHeightCm: 1.38 });
  check(plan.status === "ok", "A: 状态 ok");
  check(plan.nextSource.includes("width=7.72cm, height=1.38cm"), "A: 写入新宽高");
  check(plan.nextSource.includes("figure/x.png"), "A: 路径保留");
  check(!plan.nextSource.includes("width=1cm"), "A: 旧 1cm 已被替换");
  check(!plan.nextSource.includes("text width"), "A: 移除 text width");
  check(!plan.nextSource.includes("minimum height"), "A: 移除 minimum height");
  check(plan.nextSource.includes("inner sep=0"), "A: 补 inner sep=0");
}

// ── B：保留 includegraphics 的其它选项（如 angle） ───────────────────────────────
{
  const { src, stmt } = mkNode("text width=2cm", "\\includegraphics[width=1cm, angle=30]{a.png}");
  const plan = planImageNodeResize({ source: src, statement: stmt, newWidthCm: 4, newHeightCm: 3 });
  check(plan.status === "ok", "B: ok");
  check(plan.nextSource.includes("angle=30"), "B: 保留 angle");
  check(plan.nextSource.includes("width=4cm, height=3cm"), "B: 新宽高");
}

// ── C：全新图片节点（无选项）—— 应插入 inner sep=0 ─────────────────────────────
{
  const { src, stmt } = mkNode("", "\\includegraphics[width=2cm]{a.png}");
  const plan = planImageNodeResize({ source: src, statement: stmt, newWidthCm: 1, newHeightCm: 1 });
  check(plan.status === "ok", "C: ok");
  check(plan.nextSource.includes("width=1cm, height=1cm"), "C: 新宽高");
  check(plan.nextSource.includes("\\node[inner sep=0]"), "C: 在 \\node 后插入 inner sep=0");
}

// ── D：nodeHasIncludeGraphics 判定 ──────────────────────────────────────────────
{
  const a = mkNode("text width=2cm", "\\includegraphics[width=1cm]{a.png}");
  check(nodeHasIncludeGraphics(a.stmt, a.src) === true, "D: 图片节点识别为 true");
  const b = mkNode("text width=2cm", "普通文字");
  check(nodeHasIncludeGraphics(b.stmt, b.src) === false, "D: 文字节点识别为 false");
}

// ── E：非 node 语句应拒绝 ──────────────────────────────────────────────────────
{
  const { src, stmt } = mkNode("", "\\includegraphics[width=1cm]{a.png}");
  stmt.command = "draw";
  const plan = planImageNodeResize({ source: src, statement: stmt, newWidthCm: 1, newHeightCm: 1 });
  check(plan.status === "rejected", "E: 非 node 拒绝");
}

// ── F：node 内无 includegraphics 应拒绝 ────────────────────────────────────────
{
  const { src, stmt } = mkNode("text width=2cm", "hello");
  const plan = planImageNodeResize({ source: src, statement: stmt, newWidthCm: 1, newHeightCm: 1 });
  check(plan.status === "rejected", "F: 无 includegraphics 拒绝");
}

// ── G：宽高下限钳制（避免 0 / 负值） ───────────────────────────────────────────
{
  const { src, stmt } = mkNode("text width=2cm", "\\includegraphics[width=2cm]{a.png}");
  const plan = planImageNodeResize({ source: src, statement: stmt, newWidthCm: -5, newHeightCm: 0.001 });
  check(plan.status === "ok", "G: ok");
  check(plan.nextSource.includes("width=0.05cm"), "G: 宽度下限 0.05");
  check(plan.nextSource.includes("height=0.05cm"), "G: 高度下限 0.05");
}

// ── H：尺寸完全一致时应 noop（不写无谓补丁） ───────────────────────────────────
{
  const { src, stmt } = mkNode("inner sep=0", "\\includegraphics[width=7.72cm, height=1.38cm]{a.png}");
  const plan = planImageNodeResize({ source: src, statement: stmt, newWidthCm: 7.72, newHeightCm: 1.38 });
  check(plan.status === "noop", "H: 尺寸未变化 → noop");
}

// ── I：保留节点的其它选项（如 fill），只剥离 text width / minimum height ─────────
{
  const { src, stmt } = mkNode("text width=2cm, fill=red!20", "\\includegraphics[width=1cm]{a.png}");
  const plan = planImageNodeResize({ source: src, statement: stmt, newWidthCm: 3, newHeightCm: 2 });
  check(plan.status === "ok", "I: ok");
  check(plan.nextSource.includes("fill=red!20"), "I: 保留 fill");
  check(!plan.nextSource.includes("text width"), "I: 移除 text width");
  check(plan.nextSource.includes("inner sep=0"), "I: 补 inner sep=0");
}

console.log(`diagram-image-resize: ${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);

// M1-11 · 空槽占位命令（预览专用协议；M1-12a 抽为独立小模块）
// 抽出原因：编写区预览（mathTex.serializeSlotsText）与搭建器预览
// （builderTypes.serializeSlots）共用同一协议，而 MathView 静态引入
// mathTex——若经 builderTypes 中转会把整棵模板库拖进主 bundle，故拆此文件。
//
// DFS 序第 i 个空槽 → \za…\zz、\zaa…（bijective base-26，**必须纯字母**——
// \zs1 形式会被 KaTeX 拆成 \zs + 1 两个 token，数字后缀不可用）。
// KaTeX 对未定义命令宽容渲染为红字原文 span，FormulaKaTeX.injectSlots
// 按出现序替换为可点选槽位节点（.zetla-slot[data-slot]）。
export function slotCmd(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(97 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return `\\z${s}`;
}

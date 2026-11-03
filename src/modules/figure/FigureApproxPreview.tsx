// P2 后续 · subfigure 近似预览（DOM）：绑定 subfigure 模式，反映排版决策
// （行列 / 宽度预算 / 间距 / 裁剪 / 对齐 / 编号 / 子标题）。
// 与 figureGen.computeRowLayout 共用同一宽度算法，保证“近似所见 ≈ 生成所是”。
// 缩略图按 FigureCell.source 预览（path 零拷贝 / file 对象 URL），PDF 用占位卡。
import type { CSSProperties, SyntheticEvent } from "react";
import { useFigureStore } from "./figureStore";
import { computeRowLayout } from "./figureGen";
import { subFigureLetter, FigureCell } from "@/types/figure";
import SubCaptionPreview from "./SubCaptionPreview";
import PdfThumb from "./PdfThumb";
import { cellPreviewUrl, isPdfSource } from "./figurePreviewUrl";

const hideOnErr = (e: SyntheticEvent<HTMLImageElement>) => {
  (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
};

/** 子图可见区域（crop 左上角原点）的 DOM 裁剪包装；PDF 渲染首页 canvas */
function CroppedImage({ cell, index }: { cell: FigureCell; index: number }) {
  const { l, b, r, t } = cell.crop;
  const anyCrop = l || b || r || t;
  const ns = cell.naturalSize;
  const pdf = isPdfSource(cell.source);
  const url = cellPreviewUrl(cell);
  const vw = Math.max(0.01, 1 - l - r);
  const vh = Math.max(0.01, 1 - t - b);
  // 裁剪时把可见区域放大填满 wrapper（左上角原点），img / canvas 同口径
  const cropStyle = {
    position: "absolute",
    width: `${(1 / vw) * 100}%`,
    height: `${(1 / vh) * 100}%`,
    left: `${-(l / vw) * 100}%`,
    top: `${-(t / vh) * 100}%`,
  } as const;

  if (pdf) {
    return (
      <PdfThumb
        cell={cell}
        index={index}
        canvasStyle={anyCrop ? cropStyle : { display: "block", width: "100%", height: "100%" }}
      />
    );
  }
  if (!url) {
    return <div className="fig-approx-img fig-approx-pdf">无预览</div>;
  }
  if (!anyCrop || !ns || ns.w === 0 || ns.h === 0) {
    return (
      <img className="fig-approx-img" src={url} alt="" style={{ display: "block" }} onError={hideOnErr} />
    );
  }
  // 把可见区域（l,t）→（l+vw, t+vh）映射到 wrapper：scale + translate（左上角原点）
  return (
    <img
      className="fig-approx-img"
      src={url}
      alt=""
      style={{ ...cropStyle, objectFit: "fill" }}
      onError={hideOnErr}
    />
  );
}

export default function FigureApproxPreview() {
  const layout = useFigureStore((s) => s.layout);
  const { cells, cols, gapRow } = layout;
  const totalRows = Math.max(layout.rows, Math.ceil(cells.length / cols));
  // 已渲染行计数：仅非空行、且非首行才加行间距（等价 LaTeX 行间 \vspace）
  let shown = 0;

  return (
    <div className="fig-approx">
      <div className="fig-approx-paper">
        {/* 模拟 \textwidth：整块版心 */}
        <div className="fig-approx-textwidth">
          {Array.from({ length: totalRows }, (_, r) => {
            const rl = computeRowLayout(layout, r);
            if (rl.indices.length === 0) return null;
            // 行间距 = gapRow × \textwidth：margin-top 的百分比按包含块「宽度」解析，
            // 故等价于 \vspace{gapRow\textwidth}；首行不加。水平靠 space-between 等价 \hfill。
            const topGap = shown === 0 ? 0 : gapRow * 100;
            shown += 1;
            // 对齐为行级属性（LaTeX 同行子图共享基线）：整行统一取该行首格的 align
            const rowAlign = rl.indices.length > 0 ? cells[rl.indices[0]!]!.align : "t";
            const rowSelfAlign =
              rowAlign === "c" ? "center" : rowAlign === "b" ? "flex-end" : "flex-start";
            return (
              <div
                key={r}
                className="fig-approx-row"
                style={{ marginTop: `${topGap}%`, justifyContent: "space-between" }}
              >
                {rl.indices.map((gi, i) => {
                  const cell = cells[gi]!;
                  // 诚实预览：非裁剪图靠相对 <img> 撑开真实高度；
                  // 裁剪图与 PDF 显式按真实宽高比撑高 wrapper（避免塌成 0 高）。
                  const pdf = isPdfSource(cell.source);
                  const wrapStyle: CSSProperties | undefined = (() => {
                    const { l, b, r, t } = cell.crop;
                    const anyCrop = l || b || r || t;
                    const ns = cell.naturalSize;
                    if (anyCrop && ns && ns.w > 0 && ns.h > 0) {
                      const vw = Math.max(0.01, 1 - l - r);
                      const vh = Math.max(0.01, 1 - t - b);
                      return { aspectRatio: `${(vw * ns.w) / (vh * ns.h)}` };
                    }
                    // PDF 无 <img> 撑高：按首页 pt 宽高比撑开（加载前给 4:3 兜底）
                    if (pdf) {
                      return { aspectRatio: ns && ns.h > 0 ? `${ns.w / ns.h}` : "4 / 3" };
                    }
                    return undefined;
                  })();
                  return (
                    <div
                      key={gi}
                      className="fig-approx-sub"
                      style={{ width: `${(rl.widths[i]! * 100).toFixed(2)}%`, alignSelf: rowSelfAlign }}
                    >
                      <span className="fig-approx-letter">{subFigureLetter(gi)}</span>
                      <div className={pdf ? "fig-approx-imgwrap pdf" : "fig-approx-imgwrap"} style={wrapStyle}>
                        <CroppedImage cell={cell} index={gi} />
                      </div>
                      <div className="fig-approx-scap">
                        <SubCaptionPreview text={cell.subCaption} />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {layout.caption.trim() && (
            <div className="fig-approx-cap">图：{layout.caption}</div>
          )}
        </div>
      </div>
      <div className="fig-approx-note">
        近似预览（DOM）：反映行列 / 宽度预算 / 间距 / 裁剪 / 对齐 / 编号 / 子标题；
        \textwidth 真实宽度未知，像素保真约 70–85%。
        子图高度按真实等比呈现，出现参差即提示图片尺寸不一致——请据此调整对齐 / 间距参数，或更换 / 裁剪图片。
        对齐为行级属性（同行共用一条 LaTeX 基线），设置任一子图即整行生效。
      </div>
    </div>
  );
}

// P2 后续 · subfigure 近似预览（DOM）：绑定 subfigure 模式，反映排版决策
// （行列 / 宽度预算 / 间距 / 裁剪 / 对齐 / 编号 / 子标题）。
// 与 figureGen.computeRowLayout 共用同一宽度算法，保证“近似所见 ≈ 生成所是”。
// 缩略图按 FigureCell.source 预览（path 零拷贝 / file 对象 URL），PDF 用占位卡。
import type { SyntheticEvent } from "react";
import { useFigureStore } from "./figureStore";
import { computeRowLayout } from "./figureGen";
import { subFigureLetter, FigureCell } from "@/types/figure";
import SubCaptionPreview from "./SubCaptionPreview";
import { cellPreviewUrl, isPdfSource } from "./figurePreviewUrl";

const hideOnErr = (e: SyntheticEvent<HTMLImageElement>) => {
  (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
};

/** 子图可见区域（crop 左上角原点）的 DOM 裁剪包装；PDF 显示占位卡 */
function CroppedImage({ cell }: { cell: FigureCell }) {
  const { l, b, r, t } = cell.crop;
  const anyCrop = l || b || r || t;
  const ns = cell.naturalSize;
  const pdf = isPdfSource(cell.source);
  const url = cellPreviewUrl(cell);

  if (pdf || !url) {
    return <div className="fig-approx-img fig-approx-pdf">PDF</div>;
  }
  if (!anyCrop || !ns || ns.w === 0 || ns.h === 0) {
    return (
      <img
        className="fig-approx-img"
        src={url}
        alt=""
        style={{ objectFit: "contain" }}
        onError={hideOnErr}
      />
    );
  }
  const vw = Math.max(0.01, 1 - l - r);
  const vh = Math.max(0.01, 1 - t - b);
  // 把可见区域（l,t）→（l+vw, t+vh）映射到 wrapper：scale + translate（左上角原点）
  return (
    <img
      className="fig-approx-img"
      src={url}
      alt=""
      style={{
        width: `${(1 / vw) * 100}%`,
        height: `${(1 / vh) * 100}%`,
        left: `${-(l / vw) * 100}%`,
        top: `${-(t / vh) * 100}%`,
      }}
      onError={hideOnErr}
    />
  );
}

export default function FigureApproxPreview() {
  const layout = useFigureStore((s) => s.layout);
  const { cells, cols, gapCol } = layout;
  const totalRows = Math.max(layout.rows, Math.ceil(cells.length / cols));

  return (
    <div className="fig-approx">
      <div className="fig-approx-paper">
        {/* 模拟 \textwidth：整块版心 */}
        <div className="fig-approx-textwidth">
          {Array.from({ length: totalRows }, (_, r) => {
            const rl = computeRowLayout(layout, r);
            if (rl.indices.length === 0) return null;
            return (
              <div
                key={r}
                className="fig-approx-row"
                style={{ gap: `${gapCol * 100}%`, justifyContent: "space-between" }}
              >
                {rl.indices.map((gi, i) => {
                  const cell = cells[gi]!;
                  const alignSelf =
                    cell.align === "c" ? "center" : cell.align === "b" ? "flex-end" : "flex-start";
                  return (
                    <div
                      key={gi}
                      className="fig-approx-sub"
                      style={{ width: `${(rl.widths[i]! * 100).toFixed(2)}%`, alignSelf }}
                    >
                      <span className="fig-approx-letter">{subFigureLetter(gi)}</span>
                      <div className="fig-approx-imgwrap">
                        <CroppedImage cell={cell} />
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
      </div>
    </div>
  );
}

// P3-1 · 整图属性卡：图片标题（= 总图 \caption{}；composite 模式下兼作合成 PNG 文件名）。
// 与 GapControls 同属「未选中子图」时 figside-edit 组内的两部分，共用 figside-card 外观。
import { useFigureStore } from "./figureStore";

export default function CaptionField() {
  const mode = useFigureStore((s) => s.layout.mode);
  const caption = useFigureStore((s) => s.layout.caption);
  const setCaption = useFigureStore((s) => s.setCaption);

  return (
    <div className="figside-card">
      <div className="figside-card-head">图片标题</div>

      <input
        type="text"
        className="figside-input"
        value={caption}
        placeholder={
          mode === "composite"
            ? "总图标题；留空则命名 fig-<slug>-composite.png"
            : "总图 \\caption{}"
        }
        onChange={(e) => setCaption(e.target.value)}
      />

      <span className="figside-hint">
        {"即总图 \\caption{}，生成代码时自动写入；合成模式下同时用作 PNG 文件名。"}
      </span>
    </div>
  );
}

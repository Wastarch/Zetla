// 图片查看器（标签页内嵌）—— M1：双击项目树图片 / 「打开图片」菜单进入标签页查看。
// 只读，无脏点、无编辑；复用 Tauri asset 协议（convertFileSrc）渲染本地图片；
// 支持 Ctrl+滚轮缩放（指针锚定）、拖拽平移、底部文件名与尺寸标注。
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type SyntheticEvent,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Icon } from "@/ui/Icon";

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 8;

export interface ImageViewerProps {
  /** 图片绝对路径 */
  path: string;
  /** 文件名（标签/标题展示） */
  name: string;
}

export function ImageViewer({ path, name }: ImageViewerProps) {
  const src = convertFileSrc(path);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fit, setFit] = useState(true); // 首次/重置后按容器适配

  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgWrapRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const scaleRef = useRef(1);
  const posRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  scaleRef.current = scale;
  posRef.current = pos;

  // 适配：首帧或重置后，把图片缩放到「适合容器宽度」并居中
  const fitToStage = useCallback(() => {
    const stage = stageRef.current;
    const img = imgWrapRef.current?.querySelector("img");
    if (!stage || !img) return;
    const iw = img.naturalWidth || img.clientWidth;
    const ih = img.naturalHeight || img.clientHeight;
    if (!iw || !ih) return;
    // 容器尚未布局（如刚切换到该标签页的首帧）时不缩放，避免被算成极小值
    if (stage.clientWidth < 50 || stage.clientHeight < 50) {
      setScale(1);
      setPos({ x: 0, y: 0 });
      return;
    }
    const pad = 24;
    // contain：取宽/高适配比例的较小者，保证整张图完整可见
    const raw = Math.min((stage.clientWidth - pad) / iw, (stage.clientHeight - pad) / ih);
    const s = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, raw));
    setScale(s);
    setPos({ x: 0, y: 0 });
    setFit(true);
  }, []);

  const onImgLoad = useCallback(
    (e: SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      setDims({ w: img.naturalWidth, h: img.naturalHeight });
      setErr(null);
      fitToStage();
    },
    [fitToStage],
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // 仅 Ctrl+滚轮缩放；普通滚动交给容器
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      // 以容器中心为原点（与 transform-origin: center center 一致）
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const prev = scaleRef.current;
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev * Math.exp(-e.deltaY * 0.0015)));
      if (next === prev) return;
      // 指针锚定：保持光标处的图片点不动
      const px = posRef.current.x;
      const py = posRef.current.y;
      const nx = cx - (cx - px) * (next / prev);
      const ny = cy - (cy - py) * (next / prev);
      setScale(next);
      setPos({ x: nx, y: ny });
      setFit(false);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  const onMouseDown = (e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    dragging.current = { x: e.clientX, y: e.clientY, px: posRef.current.x, py: posRef.current.y };
  };
  const onMouseMove = (e: ReactMouseEvent) => {
    const d = dragging.current;
    if (!d) return;
    setPos({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
  };
  const endDrag = () => {
    dragging.current = null;
  };

  const pct = Math.round(scale * 100);
  const cursor = dragging.current ? "grabbing" : fit ? "default" : "grab";

  return (
    <div className="image-viewer">
      <div
        className="iv-stage"
        ref={stageRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
      >
        <div
          ref={imgWrapRef}
          className="iv-canvas"
          style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`, cursor }}
        >
          {err ? (
            <div className="iv-error">
              <Icon name="alert" size={26} style={{ color: "var(--err)" }} />
              <p>图片加载失败</p>
              <p className="hint">{err}</p>
            </div>
          ) : (
            <img
              src={src}
              alt={name}
              draggable={false}
              onLoad={onImgLoad}
              onError={() => setErr(`无法读取 ${name}`)}
            />
          )}
        </div>
      </div>
      <div className="iv-bar">
        <span className="iv-name" title={path}>{name}</span>
        {dims && <span className="iv-dims">{dims.w} × {dims.h}</span>}
        <span className="iv-zoom">{pct}%</span>
        <button type="button" className="btn sm" onClick={fitToStage} title="适配窗口（重置缩放与位置）">
          适配
        </button>
        <span className="iv-hint">Ctrl+滚轮缩放 · 拖拽平移</span>
      </div>
    </div>
  );
}

export default ImageViewer;

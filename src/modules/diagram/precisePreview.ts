// M2 · 绘图模块 F1-6：XeLaTeX 精确预览通道（前端侧）。
// 与 tikzEditor/engine.ts 的同步 LRU 缓存平行：这里按「源码 + 引擎」hash 缓存成功结果，
// 相同 key 的请求单飞，失败不缓存（TeX 环境变化后重试即可恢复）。
// SVG 以文本返回，转成 data URL 用 <img> 显示 —— 浏览器把 SVG 当隔离文档，
// 不执行脚本、不受 svg.ts 白名单限制、也没有 asset:// 缓存串图问题。
import { diagramApi } from "@/ipc/invoke";
import type { TikzPreviewResult } from "@/types/diagram";
import { getCachedPreview, previewKey, setCachedPreview } from "./previewCache";

// 纯逻辑从 previewCache.ts 重新导出，保持 DiagramCanvas 的既有导入路径不变。
export { previewKey, getCachedPreview, svgDataUrl, clearPrecisePreviewCache } from "./previewCache";

/** 同 key 的并发请求复用同一个 Promise，避免连点触发多次 XeLaTeX */
const inflight = new Map<string, Promise<TikzPreviewResult>>();

/** 请求精确预览；可预期的后端失败以 status:"error" 返回，不抛异常 */
export function requestPrecisePreview(
  source: string,
  engine: string,
): Promise<TikzPreviewResult> {
  const key = previewKey(source, engine);
  const hit = getCachedPreview(key);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(key);
  if (pending) return pending;

  const task = diagramApi.tikzPreview(source, engine).then(
    (r) => {
      inflight.delete(key);
      setCachedPreview(key, r);
      return r;
    },
    (e: unknown) => {
      inflight.delete(key);
      const fallback: TikzPreviewResult = {
        status: "error",
        elapsedMs: 0,
        preambleLines: 0,
        errors: [],
        message: e instanceof Error ? e.message : String(e),
      };
      return fallback;
    },
  );
  inflight.set(key, task);
  return task;
}

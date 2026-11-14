// M2 · 图片插入 TikZ · P1：纯逻辑 imageRefs 与项目状态之间的薄桥接层。
//
// 只有这里读 store（项目根 / 锁定的主文档），精确预览与导出两条通道共用同一份
// 派生结果，避免各自算一遍导致缓存 key 与派发内容漂移。
import { parentOf, useProjectStore } from "@/project/useProject";
import { useDiagramStore } from "./store";
import {
  assetSignature,
  scanImageRefs,
  type PreparedImageSource,
} from "./imageRefs";

export interface ResolvedImageSource extends PreparedImageSource {
  /** 原样项目根（Rust 用它 canonicalize 做越界校验） */
  root: string;
  /** 并入 previewKey 的资源签名 */
  assetSig: string;
}

let lastWarn = "";

/**
 * 由当前项目状态把绘图源码派生成「带 token 的副本 + assets」。
 * 相对图片路径的基准 = targetTex 所在目录（与 R5 插图 / figureInsert 同一口径）；
 * 未锁定主文档时回落到项目根。
 */
export function resolveImageAssets(source: string): ResolvedImageSource {
  const root = useProjectStore.getState().root ?? "";
  const targetTex = useDiagramStore.getState().targetTex ?? "";
  const texDir = targetTex ? parentOf(targetTex) : root;
  const prepared = scanImageRefs(source, texDir, root);

  // P1 不接 UI 提示（P5 的「丢图红框 / 重新链接」负责）；这里只做一次性控制台告警，
  // 让用户知道「为什么这张图没进编译」，同时避免每次重渲染刷屏。
  const sig = prepared.skipped.map((s) => `${s.path}:${s.reason}`).join("|");
  if (sig && sig !== lastWarn) {
    console.warn("[diagram] 以下图片引用未注入编译工作区，精确预览 / 导出可能报 File not found：", prepared.skipped);
  }
  lastWarn = sig;

  return {
    ...prepared,
    root,
    assetSig: assetSignature(prepared.assets),
  };
}

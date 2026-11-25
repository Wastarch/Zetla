// M1-49 · 从项目树拖出到系统（原生 OLE 拖放源）的前端入口
//
// 两种拖出通道互斥，但共用一套「拖拽中的自我识别」状态：
//   - 指针拖出窗口 → beginDragOut（Rust DoDragDrop 接管，松手后 drag_out_done 回执）
//
// 为什么需要 isOwnDragOutDrop：拖出去再拖回窗口时，落地对象是**本应用自己**
// （wry 的 IDropTarget 会把它当成一次普通的外部拖入上报），若不拦，
// 自己的文件会被复制成「xxx - 副本」。拖放循环在飞期间与结束后 1.2s 内一律当自己。
import { projectApi } from "@/ipc/invoke";
import { notify } from "./useProject";

/** 拖放循环结束后的静默期（覆盖「松手后紧接着的 drop 事件」） */
const SETTLE_MS = 1200;

let inFlight = false;
let guardUntil = 0;

/** 当前是否有我们发起的系统拖出（含刚落地的余波） */
export function isOwnDragOut(): boolean {
  return inFlight || Date.now() < guardUntil;
}

/** 系统拖出是否真的在进行中（用于避免重复触发） */
export function dragOutInFlight(): boolean {
  return inFlight;
}

/**
 * 触发一次系统拖出。命令立即返回，拖放循环在 Rust 线程上跑到松手为止，
 * 落地效果由 drag_out_done 事件回执（见 useProjectWatch）。
 */
export async function beginDragOut(paths: string[], copy: boolean): Promise<void> {
  if (inFlight || paths.length === 0) return;
  inFlight = true;
  // 拖放循环可能停留很久（用户拖着不松手），先按「进行中」长期按住，
  // 结束时由 finishDragOut 收紧成 SETTLE_MS
  guardUntil = Date.now() + 10 * 60_000;
  try {
    await projectApi.startDragOut(paths, copy);
  } catch (e) {
    // 命令本身失败（例如调度不到主线程）：必须让用户看到，否则就是「拖了没反应也没提示」
    console.warn("[drag_out]", e);
    inFlight = false;
    guardUntil = 0;
    notify(String(e), "err");
  }
}

/** drag_out_done 到达：拖放循环已结束 */
export function finishDragOut(): void {
  inFlight = false;
  guardUntil = Date.now() + SETTLE_MS;
}

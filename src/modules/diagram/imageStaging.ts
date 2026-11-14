// M2 · 图片插入 TikZ · P2：暂存图生命周期的前端编排层。
//
// 纯判据在 imageStagingPlan.ts（Node 可直测），这里只负责 IPC / 项目状态 / 生命周期挂载：
//  选图 → 同名检测 → 「重命名 / 覆盖」→（覆盖既有用户文件二次确认）→ 落盘 figure/ →
//  登记 manifest → 插入成功后按路径命中转正 → 关 Tab / 换项目 / 启动扫描时安静清理。
//
// 与拼图模块的区别：清理一律走 Rust 的安静命令，绝不用 useProjectStore.removeEntry（带确认框）。
import { confirm, open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { projectApi, stagingApi } from "@/ipc/invoke";
import { useBuffersStore } from "@/editor/useBuffers";
import { relativePath } from "@/editor/image/pathUtils";
import { notify, parentOf, useProjectStore } from "@/project/useProject";
import { useDiagramStore } from "./store";
import {
  hasImageRefs,
  planPromotion,
  stagingPathKey,
} from "./imageStagingPlan.ts";

const DEFAULT_IMAGE_DIR = "figure";
/** 与 P1 / P0 一致：-no-shell-escape 下 XeLaTeX 可直接吃这四种，SVG 排除 */
const STAGE_EXTS = ["png", "jpg", "jpeg", "pdf"];
/** 本会话登记过暂存图的项目根：换项目 / 重启后仍能找到旧 manifest 做清理 */
const ROOTS_KEY = "zetla.diagram.stagingRoots.v1";

function readRoots(): string[] {
  try {
    const raw = localStorage.getItem(ROOTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
  } catch {
    return [];
  }
}

function rememberStagingRoot(root: string): void {
  const next = Array.from(new Set([...readRoots(), root]));
  try {
    localStorage.setItem(ROOTS_KEY, JSON.stringify(next));
  } catch {
    /* 隐私模式等：仅本会话内存有效，启动扫描仍有当前 root 兜底 */
  }
}

function currentImageDir(): string {
  return useProjectStore.getState().tree?.imageDir?.trim() || DEFAULT_IMAGE_DIR;
}

function currentTexDir(root: string): string {
  const targetTex = useDiagramStore.getState().targetTex;
  return targetTex ? parentOf(targetTex) : root;
}

function joinAbs(root: string, imageDir: string, fileName: string): string {
  const r = root.replace(/[\\/]+$/, "");
  const d = imageDir.replace(/^[\\/]+/, "").replace(/[\\/]+$/, "");
  return d ? `${r}/${d}/${fileName}` : `${r}/${fileName}`;
}

/** 打开系统选图框（只列出能进 TikZ 的格式，避免用户选到 SVG 再编译失败） */
export async function pickImageFile(): Promise<string | null> {
  try {
    const picked = await openFileDialog({
      multiple: false,
      filters: [{ name: "图片（PNG / JPG / PDF）", extensions: [...STAGE_EXTS] }],
    });
    if (!picked) return null;
    return Array.isArray(picked) ? (picked[0] ?? null) : picked;
  } catch (e) {
    notify(`选择图片失败：${String(e)}`, "err");
    return null;
  }
}

export interface StagingContext {
  root: string;
  imageDir: string;
  texDir: string;
  srcPath: string;
  fileName: string;
  /** figure/ 下是否已有同名文件 */
  exists: boolean;
  /** 同名文件是否为本会话自己暂存的（决定要不要二次确认） */
  owned: boolean;
}

/** 选图后、落盘前的上下文与同名冲突探测（不改动任何文件） */
export async function inspectStagingTarget(
  srcPath: string,
): Promise<StagingContext | null> {
  const root = useProjectStore.getState().root;
  if (!root) {
    notify("请先打开项目，再暂存图片", "err");
    return null;
  }
  const fileName = srcPath.split(/[\\/]/).pop() ?? "";
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!STAGE_EXTS.includes(ext)) {
    notify(`仅支持 PNG / JPG / PDF 图片（当前 .${ext || "?"}）`, "err");
    return null;
  }
  const imageDir = currentImageDir();
  let exists = false;
  try {
    // 检测失败不阻断：按「无冲突」处理，由 Rust dedupe_name 兜底
    exists = await projectApi.imageExists(root, imageDir, fileName);
  } catch {
    exists = false;
  }
  let owned = false;
  if (exists) {
    try {
      const entries = await stagingApi.listStagedImages(root);
      const want = stagingPathKey(joinAbs(root, imageDir, fileName));
      owned = entries.some((e) => e.owned && stagingPathKey(e.absPath) === want);
    } catch {
      owned = false;
    }
  }
  return {
    root,
    imageDir,
    texDir: currentTexDir(root),
    srcPath,
    fileName,
    exists,
    owned,
  };
}

export type StagingPolicy = "rename" | "overwrite";
export interface StagingOutcome {
  status: "ok" | "cancel" | "error";
  fileName?: string;
  absPath?: string;
  /** 相对 targetTex 目录的 \includegraphics 路径（P3 生成 node 语句用） */
  relPath?: string;
  message?: string;
}

/**
 * 按冲突策略落盘并登记 manifest。
 * 覆盖「既有用户文件」时在弹窗选择之后再做一次系统确认；取消则不改动任何文件。
 */
export async function placeStagedImage(
  ctx: StagingContext,
  policy: StagingPolicy,
): Promise<StagingOutcome> {
  const { root, imageDir, srcPath, fileName, texDir, exists, owned } = ctx;
  try {
    if (policy === "overwrite" && exists) {
      if (!owned) {
        const ok = await confirm(
          `将替换 ${imageDir}/${fileName} 里已有的文件，原文件不可恢复。\n确定继续吗？`,
          { title: "覆盖确认", kind: "warning", okLabel: "覆盖", cancelLabel: "取消" },
        );
        if (!ok) return { status: "cancel" };
      }
      await projectApi.removeEntry(joinAbs(root, imageDir, fileName));
    }
    // import_image_from_path 是去重语义：rename 策略下同名会自动变成 x-1.png
    const res = await projectApi.importImageFromPath(root, imageDir, srcPath);
    const entry = await stagingApi.stageImage(root, res.absPath);
    rememberStagingRoot(root);
    // 新文件进资源树（静默刷新，不弹 toast）
    void useProjectStore.getState().refresh(true);
    return {
      status: "ok",
      fileName: res.fileName,
      absPath: entry.absPath,
      relPath: relativePath(texDir, res.absPath),
    };
  } catch (e) {
    const message = `暂存图片失败：${String(e)}`;
    notify(message, "err");
    return { status: "error", message };
  }
}

/**
 * 插入主文档成功后调用：把刚写进去的代码交给纯逻辑抽路径，
 * 命中者移出 manifest（转正）。解析不到时 planPromotion 会走「默认保留」分支。
 * 一次性快照：转正后撤销插入或删掉那行 \includegraphics 不会反过来删文件。
 */
export async function promoteFromInsertedCode(insertedCode: string): Promise<void> {
  const root = useProjectStore.getState().root;
  if (!root) return;
  let entries;
  try {
    entries = await stagingApi.listStagedImages(root);
  } catch {
    return;
  }
  if (entries.length === 0) return;
  const plan = planPromotion({
    insertedCode,
    texDir: currentTexDir(root),
    root,
    stagedPaths: entries.map((e) => e.absPath),
  });
  if (plan.uncertain) {
    console.warn(
      "[diagram] 插入代码里有无法解析的图片路径，按「默认保留」处理，不清理任何暂存图：",
      plan.skipped,
    );
  }
  if (plan.pathsToPromote.length === 0) return;
  try {
    await stagingApi.promoteStagedImages(root, plan.pathsToPromote);
  } catch (e) {
    console.warn("[diagram] 暂存图转正失败（文件不会被删除）：", e);
  }
}

/**
 * 安静清理本会话登记过的所有项目。
 * keepIfEditing：决策 9② —— 绘图 Tab 仍开且源码仍含图片节点时，延后到 Tab 关闭。
 */
export async function discardSessionStagedImages(
  opts: { keepIfEditing?: boolean } = {},
): Promise<void> {
  const activeRoot = useProjectStore.getState().root;
  const roots = Array.from(
    new Set([...readRoots(), ...(activeRoot ? [activeRoot] : [])]),
  );
  if (roots.length === 0) return;
  if (opts.keepIfEditing) {
    const tabOpen = useBuffersStore
      .getState()
      .buffers.some((b) => b.kind === "diagram");
    if (tabOpen && hasImageRefs(useDiagramStore.getState().source)) return;
  }
  for (const root of roots) {
    try {
      await stagingApi.discardStagedImages(root, null);
    } catch {
      /* 项目已关闭 / 目录不存在：留待下次启动扫描，不打扰用户 */
    }
  }
}

/** 启动扫描：清掉上次会话遗留的孤儿暂存图（Rust 侧对已被引用的会保守保留） */
export async function sweepStagedImages(): Promise<void> {
  const activeRoot = useProjectStore.getState().root;
  const roots = Array.from(
    new Set([...readRoots(), ...(activeRoot ? [activeRoot] : [])]),
  );
  for (const root of roots) {
    try {
      await stagingApi.sweepStagedImages(root);
    } catch {
      /* 项目目录不存在 / 清单损坏：静默跳过 */
    }
  }
}

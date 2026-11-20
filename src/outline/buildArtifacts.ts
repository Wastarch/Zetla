// M1-39 · 构建产物列表展示用纯逻辑（无 store / 无 @ 别名，Node 可直接单测）
import type { BuildArtifact } from "../types/project.ts";

/** 产物展示类型（决定图标与配色） */
export type ArtifactKind = "pdf" | "log" | "aux" | "other";

/** 按文件名判类型：.pdf / .log / 其余构建后缀 */
export function artifactKind(name: string): ArtifactKind {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".log") || lower.endsWith(".blg") || lower.endsWith(".ilg")) return "log";
  return "aux";
}

/** 文件大小：小于 1KB 显示 B，否则 1 位小数 KB / MB */
export function formatArtifactSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 修改时间：HH:MM（今天）或 MM-DD（往年），避免面板里塞长日期 */
export function formatArtifactTime(ms: number, now = Date.now()): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.getFullYear() === new Date(now).getFullYear() &&
    d.getMonth() === new Date(now).getMonth() &&
    d.getDate() === new Date(now).getDate();
  return sameDay ? hhmm : `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 后端已排序；前端兜底按修改时间倒序，同时间按文件名 */
export function sortArtifacts(items: BuildArtifact[]): BuildArtifact[] {
  return [...items].sort(
    (a, b) => b.modified - a.modified || a.name.localeCompare(b.name),
  );
}

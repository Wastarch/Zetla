// Zotero 联动 · P0 纯逻辑：状态诊断 / 文案 / 轮询决策
// 只依赖无 @/ 别名的类型模块，可在 Node --experimental-strip-types 下直测
// （scripts/zotero-p0.test.ts）。不碰 store、不碰 Tauri，便于离线回归。
import { ZOTERO_DEFAULT_PORT } from "../../types/zotero.ts";
import type {
  ZoteroConnectionState,
  ZoteroHealth,
  ZoteroSettings,
} from "../../types/zotero.ts";

export type ZoteroTone = "ok" | "warn" | "err" | "muted";

export interface ZoteroDiagnosis {
  tone: ZoteroTone;
  title: string;
  detail: string;
  /** 可操作的排障步骤（403 / 离线时给引导） */
  steps: string[];
}

/**
 * 端口归一化：只接受 1–65535 的有限整数；0 / NaN / 越界 / 字符串垃圾一律回落默认。
 * 主机永远固定 localhost，端口可配但绝不接受主机名（防 SSRF）。
 */
export function normalizePort(value: unknown): number {
  const n = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return ZOTERO_DEFAULT_PORT;
  const i = Math.trunc(n);
  if (i <= 0 || i > 65535) return ZOTERO_DEFAULT_PORT;
  return i;
}

/** 展示用基址：固定 localhost（与 Rust base_url 一致） */
export function endpointFor(port: unknown): string {
  return `http://localhost:${normalizePort(port)}/api/`;
}

/** 解析客户端主版本号："10.0.8" → 10；"7.0.11-beta" → 7；无 → null */
export function parseMajorVersion(v: string | null | undefined): number | null {
  if (!v) return null;
  const m = /^\s*(\d+)/.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Zotero 代际：Server-ID 是 10+ 的可靠标志，其次用客户端主版本 */
export function zoteroGeneration(h: ZoteroHealth | null): "10+" | "7-9" | "unknown" {
  if (!h) return "unknown";
  if (h.serverId || h.canWrite) return "10+";
  const major = parseMajorVersion(h.zoteroVersion);
  if (major === null) return "unknown";
  return major >= 10 ? "10+" : "7-9";
}

export function stateTone(state: ZoteroConnectionState): ZoteroTone {
  switch (state) {
    case "connected":
      return "ok";
    case "disabled":
    case "checking":
      return "muted";
    case "offline":
    case "timeout":
      return "warn";
    default:
      return "err";
  }
}

/** 状态栏短文案（关闭联动时返回空串，StatusBar 据此不渲染 chip） */
export function statusLabel(
  h: ZoteroHealth | null,
  enabled: boolean,
  checking: boolean,
): string {
  if (!enabled) return "";
  if (checking) return "Zotero 检查中";
  if (!h) return "Zotero 未自检";
  switch (h.state) {
    case "connected":
      return h.bbtAvailable ? "Zotero 已连接 · BBT" : "Zotero 已连接";
    case "offline":
    case "timeout":
      return "Zotero 离线";
    case "api-disabled":
      return "Zotero API 未开启";
    case "bad-request":
      return "Zotero 请求被拒";
    default:
      return "Zotero 异常";
  }
}

/** 连接自检结果 → 人类可读诊断（403 必须给出开启本地 API 的逐步引导） */
export function diagnose(
  h: ZoteroHealth | null,
  enabled: boolean,
  checking: boolean,
): ZoteroDiagnosis {
  if (!enabled) {
    return {
      tone: "muted",
      title: "Zotero 联动已关闭",
      detail: "当前项目仍按原有方式读取 .bib，编译与引用补全完全不受影响。开启后本期只做只读连接自检，不会修改 Zotero 文献库。",
      steps: [],
    };
  }
  if (checking) {
    return { tone: "muted", title: "正在检查 Zotero 连接…", detail: "请求由 Rust 内核发往 localhost，不经过浏览器。", steps: [] };
  }
  if (!h) {
    return {
      tone: "muted",
      title: "尚未自检",
      detail: "点「一键自检」检查 Zotero 本地 API 与 Better BibTeX。",
      steps: [],
    };
  }
  switch (h.state) {
    case "connected": {
      const gen = zoteroGeneration(h);
      const steps: string[] = [];
      if (!h.bbtAvailable) {
        steps.push("如需 P1 自动导出 .bib 与稳定 citekey，建议安装 Zotero 插件 Better BibTeX；未安装时 Zetla 会走本地 API 只读降级。");
      }
      return {
        tone: "ok",
        title: "已连接 Zotero 本地 API（只读）",
        detail: `${h.message}。端点 ${endpointFor(h.port)}，${gen === "10+" ? "Zotero 10+" : gen === "7-9" ? "Zotero 7–9" : "版本未提供"}；本期不向 Zotero 写入任何数据。`,
        steps,
      };
    }
    case "api-disabled":
      return {
        tone: "err",
        title: "Zotero 本地 API 未开启（403）",
        detail: "Zotero 已启动但拒绝了请求：偏好设置里尚未允许其他应用与 Zotero 通信。Zetla 仍可正常编译，只是暂时拿不到在线文献库。",
        steps: [
          "在 Zotero 中打开「编辑 / Zotero → 设置 → 高级（Advanced）」。",
          "勾选「Allow other applications on this computer to communicate with Zotero」（允许本机其他应用与 Zotero 通信）。",
          "重启 Zotero，然后回到这里点「一键自检」。",
        ],
      };
    case "bad-request":
      return {
        tone: "err",
        title: "请求被 Zotero 拒绝（400）",
        detail: "Zotero 10 会校验 Host，并丢弃带 Origin / 浏览器 UA 的请求；Zetla 已固定使用 localhost 且由 Rust 发出，出现 400 通常是端口被别的程序占用或代理改写。",
        steps: [
          `确认 ${normalizePort(h.port)} 端口是 Zotero 的本地 API（Juris-M 为 24119）。`,
          "关闭可能占用该端口的程序，或修正上面的端口设置。",
          "检查系统代理是否把 localhost 请求转发出去，再重新自检。",
        ],
      };
    case "offline":
      return {
        tone: "warn",
        title: "未检测到 Zotero（离线）",
        detail: "连不上本地服务，通常是 Zotero 未启动或端口不对。离线降级已生效：项目内 .bib 与缓存照常使用，编译不会被阻断。",
        steps: [
          "启动 Zotero 7 或更高版本。",
          `确认本地 API 端口为 ${normalizePort(h.port)}（Juris-M 为 24119）。`,
          "启动后点「一键自检」，或等状态栏自动重试。",
        ],
      };
    case "timeout":
      return {
        tone: "warn",
        title: "Zotero 响应超时",
        detail: "本地服务有响应但超过 4 秒仍未返回，可能是 Zotero 正在同步大库。状态栏会在下一轮自动重试，编译不受影响。",
        steps: ["稍后重新自检；若持续超时，重启 Zotero 后再试。"],
      };
    default:
      return {
        tone: "err",
        title: `Zotero 返回异常${h.httpStatus ? `（HTTP ${h.httpStatus}）` : ""}`,
        detail: h.message || "本地 API 返回了未预期的状态。Zetla 已按离线降级处理，不阻断编译。",
        steps: ["确认 Zotero 版本为 7+，然后重新自检。"],
      };
  }
}

/** 设置页「能力探测」明细行 */
export function capabilityLines(h: ZoteroHealth | null): string[] {
  if (!h) return [];
  const lines: string[] = [];
  lines.push(`API 版本：${h.apiVersion ? `v${h.apiVersion}` : "未提供"}（本地只读）`);
  lines.push(`客户端：${h.zoteroVersion ?? "未提供版本号"}`);
  lines.push(`Schema：${h.schemaVersion ?? "未提供"}`);
  lines.push(
    h.serverId
      ? `Server ID：${h.serverId}（Zotero 10+，缓存按此分区）`
      : "Server ID：无（Zotero 7–9 或版本未提供）",
  );
  lines.push(
    h.canWrite
      ? "写能力：Zotero 10+ 可授权写入（本期不启用，绝不自动申请权限）"
      : "写能力：仅读取（Zotero 7–9）",
  );
  lines.push(`Better BibTeX：${h.bbtAvailable ? "在线（probe=ready）" : "未检测到"}`);
  lines.push(`检查时间：${formatCheckedAt(h.checkedAt)}`);
  return lines;
}

/** ISO-8601 → 本地 HH:MM:SS；无效值返回占位符 */
export function formatCheckedAt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export type ZoteroPollSettings = Pick<
  ZoteroSettings,
  "enabled" | "autoSync" | "pollIntervalSeconds"
>;

/** 是否允许后台轮询（离线时也要轮询，才能自动恢复） */
export function shouldPoll(s: ZoteroPollSettings): boolean {
  return s.enabled && s.autoSync;
}

/** 轮询间隔（秒）：非法/缺失回落 30，钳制到与 Rust 一致的 10–300 */
export function normalizeIntervalSeconds(value: unknown): number {
  const n = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return 30;
  const i = Math.trunc(n);
  if (i <= 0) return 30;
  return Math.min(300, Math.max(10, i));
}

/** 轮询间隔（毫秒） */
export function nextPollDelayMs(s: ZoteroPollSettings): number {
  return normalizeIntervalSeconds(s.pollIntervalSeconds) * 1000;
}

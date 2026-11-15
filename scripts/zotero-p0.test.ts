// Zotero 联动 · P0 纯逻辑单测
// 运行：node --experimental-strip-types scripts/zotero-p0.test.ts
// 只 import 无 @/ 别名的 zoteroDiagnostics.ts（相对 import 必须带 .ts 后缀）
import type { ZoteroHealth } from "../src/types/zotero.ts";
import {
  capabilityLines,
  diagnose,
  endpointFor,
  formatCheckedAt,
  nextPollDelayMs,
  normalizeIntervalSeconds,
  normalizePort,
  parseMajorVersion,
  shouldPoll,
  stateTone,
  statusLabel,
  zoteroGeneration,
} from "../src/modules/zotero/zoteroDiagnostics.ts";

let failures = 0;
let total = 0;
function check(cond: boolean, msg: string) {
  total++;
  console.log((cond ? "  ✓ " : "  ✗ ") + msg);
  if (!cond) failures++;
}

function health(over: Partial<ZoteroHealth> = {}): ZoteroHealth {
  return {
    state: "connected",
    httpStatus: 200,
    apiVersion: "3",
    schemaVersion: "2026-01-01",
    serverId: "sPMHtLD6HHBd",
    zoteroVersion: "10.0.8",
    canWrite: true,
    bbtAvailable: true,
    port: 23119,
    checkedAt: "2026-11-15T10:00:00Z",
    message: "Zotero 本地 API 已连接（只读）",
    ...over,
  };
}

console.log("== 端口与端点 normalizePort / endpointFor ==");
check(normalizePort(0) === 23119, "0 → 默认 23119");
check(normalizePort(23119) === 23119, "默认端口保留");
check(normalizePort(24119) === 24119, "Juris-M 端口保留");
check(normalizePort("  24119  ") === 24119, "字符串数字可解析");
check(normalizePort(23119.9) === 23119, "小数截断");
check(normalizePort(-1) === 23119, "负数 → 默认");
check(normalizePort(65536) === 23119, "越界 → 默认");
check(normalizePort(NaN) === 23119, "NaN → 默认");
check(normalizePort(undefined) === 23119, "undefined → 默认");
check(normalizePort("localhost:9999") === 23119, "主机名字符串 → 默认（不接受 host）");
check(endpointFor(0) === "http://localhost:23119/api/", "端点固定 localhost");
check(!endpointFor(24119).includes("127.0.0.1"), "端点不含 127.0.0.1（Zotero 10 校验 Host）");

console.log("\n== 版本解析 parseMajorVersion / zoteroGeneration ==");
check(parseMajorVersion("10.0.8") === 10, "10.0.8 → 10");
check(parseMajorVersion("7.0.11-beta") === 7, "带后缀 → 7");
check(parseMajorVersion(null) === null, "null → null");
check(parseMajorVersion("beta") === null, "非数字 → null");
check(zoteroGeneration(health()) === "10+", "有 Server-ID → 10+");
check(zoteroGeneration(health({ serverId: null, canWrite: false, zoteroVersion: "7.0.11" })) === "7-9", "无 Server-ID + 7.x → 7-9");
check(zoteroGeneration(health({ serverId: null, canWrite: false, zoteroVersion: "10.0.0" })) === "10+", "主版本兜底 → 10+");
check(zoteroGeneration(null) === "unknown", "无 health → unknown");
check(zoteroGeneration(health({ serverId: null, canWrite: false, zoteroVersion: null })) === "unknown", "无版本头 → unknown");

console.log("\n== 状态色与状态栏 stateTone / statusLabel ==");
check(stateTone("connected") === "ok", "connected → ok");
check(stateTone("offline") === "warn", "offline → warn");
check(stateTone("api-disabled") === "err", "api-disabled → err");
check(stateTone("disabled") === "muted", "disabled → muted");
check(statusLabel(health(), false, false) === "", "关闭联动 → 状态栏不显示");
check(statusLabel(health(), true, true) === "Zotero 检查中", "自检中 → 检查中文案");
check(statusLabel(null, true, false) === "Zotero 未自检", "无结果 → 未自检");
check(statusLabel(health(), true, false) === "Zotero 已连接 · BBT", "已连接 + BBT");
check(statusLabel(health({ bbtAvailable: false }), true, false) === "Zotero 已连接", "已连接但无 BBT");
check(statusLabel(health({ state: "offline" }), true, false) === "Zotero 离线", "离线");
check(statusLabel(health({ state: "timeout" }), true, false) === "Zotero 离线", "超时也算离线");
check(statusLabel(health({ state: "api-disabled" }), true, false) === "Zotero API 未开启", "403 文案");
check(statusLabel(health({ state: "bad-request" }), true, false) === "Zotero 请求被拒", "400 文案");
check(statusLabel(health({ state: "unavailable" }), true, false) === "Zotero 异常", "其他异常");

console.log("\n== 诊断 diagnose ==");
{
  const d = diagnose(health(), false, false);
  check(d.tone === "muted" && d.title.includes("已关闭"), "关闭联动 → muted + 已关闭");
  check(d.detail.includes("编译"), "关闭联动说明编译不受影响");
}
check(diagnose(null, true, true).title.includes("正在检查"), "自检中 → 检查文案");
check(diagnose(null, true, false).title.includes("尚未自检"), "无结果 → 尚未自检");
{
  const d = diagnose(health(), true, false);
  check(d.tone === "ok" && d.title.includes("只读"), "已连接 → ok + 只读");
  check(d.detail.includes("不会") || d.detail.includes("不向"), "明示不写回 Zotero");
  check(d.steps.length === 0, "BBT 在线时无额外引导");
}
{
  const d = diagnose(health({ bbtAvailable: false }), true, false);
  check(d.steps.length === 1 && d.steps[0].includes("Better BibTeX"), "无 BBT → 给安装建议");
}
{
  const d = diagnose(health({ state: "api-disabled", httpStatus: 403 }), true, false);
  check(d.tone === "err" && d.title.includes("403"), "403 → err + 标题含 403");
  check(d.steps.join(" ").includes("Allow other applications"), "403 → 引导勾选本地 API 设置");
  check(d.steps.join(" ").includes("重启 Zotero"), "403 → 引导重启");
}
{
  const d = diagnose(health({ state: "bad-request", httpStatus: 400 }), true, false);
  check(d.detail.includes("Origin") && d.detail.includes("Host"), "400 → 说明 Host/Origin 限制");
  check(d.steps.join(" ").includes("端口"), "400 → 引导检查端口");
}
{
  const d = diagnose(health({ state: "offline" }), true, false);
  check(d.tone === "warn", "离线 → warn（不是错误）");
  check(d.detail.includes("编译不会被阻断"), "离线 → 明示编译不阻断");
  check(d.steps.join(" ").includes("启动 Zotero"), "离线 → 引导启动 Zotero");
}
{
  const d = diagnose(health({ state: "timeout" }), true, false);
  check(d.tone === "warn" && d.detail.includes("4 秒"), "超时 → warn + 超时说明");
}
{
  const d = diagnose(health({ state: "unavailable", httpStatus: 500 }), true, false);
  check(d.title.includes("HTTP 500"), "异常状态 → 标题含 HTTP 码");
}

console.log("\n== 能力明细 capabilityLines / formatCheckedAt ==");
{
  const lines = capabilityLines(health()).join("\n");
  check(lines.includes("v3"), "列出 API v3");
  check(lines.includes("10.0.8"), "列出客户端版本");
  check(lines.includes("sPMHtLD6HHBd") && lines.includes("分区"), "Server ID + 缓存分区提示");
  check(lines.includes("本期不启用"), "写能力注明本期不启用");
  check(lines.includes("probe=ready"), "BBT 在线标注");
}
{
  const lines = capabilityLines(health({ serverId: null, canWrite: false, bbtAvailable: false })).join("\n");
  check(lines.includes("仅读取"), "7–9 标注仅读取");
  check(lines.includes("未检测到"), "BBT 未安装标注");
}
check(capabilityLines(null).length === 0, "无 health → 空明细");
check(formatCheckedAt(null) === "—", "空时间 → 占位符");
check(formatCheckedAt("not a date") === "—", "非法时间 → 占位符");
check(/^\d{2}:\d{2}:\d{2}$/.test(formatCheckedAt("2026-11-15T10:00:00Z")), "合法时间 → HH:MM:SS");

console.log("\n== 轮询策略 shouldPoll / nextPollDelayMs ==");
check(shouldPoll({ enabled: true, autoSync: true, pollIntervalSeconds: 30 }), "启用 + 自动同步 → 轮询");
check(!shouldPoll({ enabled: false, autoSync: true, pollIntervalSeconds: 30 }), "关闭联动 → 不轮询");
check(!shouldPoll({ enabled: true, autoSync: false, pollIntervalSeconds: 30 }), "关自动同步 → 不轮询");
check(nextPollDelayMs({ enabled: true, autoSync: true, pollIntervalSeconds: 30 }) === 30000, "30s → 30000ms");
check(nextPollDelayMs({ enabled: true, autoSync: true, pollIntervalSeconds: 1 }) === 10000, "1s 钳到 10s");
check(nextPollDelayMs({ enabled: true, autoSync: true, pollIntervalSeconds: 9999 }) === 300000, "9999s 钳到 300s");
check(nextPollDelayMs({ enabled: true, autoSync: true, pollIntervalSeconds: NaN }) === 30000, "NaN → 默认 30s");
check(normalizeIntervalSeconds("45") === 45, "字符串间隔可解析");
check(normalizeIntervalSeconds(0) === 30, "0 → 默认 30s");

console.log(`\n${failures === 0 ? "全部通过" : `${failures} 项失败`}（共 ${total} 项）`);
if (failures > 0) process.exit(1);

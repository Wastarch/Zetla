// Zotero 联动 · P0 设置页（偏好设置 →「Zotero 联动」页签）
// 独立组件是为了把 hooks/自检副作用与主对话框隔离，避免破坏 SettingsDialog
// 既有「打开时快照 / 取消回滚」的草稿语义。
import { useEffect, useState, type ReactNode } from "react";
import { useSettingsStore } from "@/core/settings";
import { zoteroApi } from "@/ipc/invoke";
import { DEFAULT_ZOTERO_SETTINGS, type ZoteroSettings } from "@/types/zotero";
import {
  capabilityLines,
  diagnose,
  endpointFor,
  formatCheckedAt,
  normalizeIntervalSeconds,
  normalizePort,
} from "./zoteroDiagnostics";
import { useZoteroStore } from "./useZoteroStore";
import { ZoteroBindingPane } from "./ZoteroBindingPane";

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="fld">
      <div className="lbl">
        <b>{label}</b>
        <span>{hint}</span>
      </div>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={checked ? "switch on" : "switch"}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  );
}

export function ZoteroPane() {
  const z = useSettingsStore((s) => s.settings.zotero ?? DEFAULT_ZOTERO_SETTINGS);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const health = useZoteroStore((s) => s.health);
  const checking = useZoteroStore((s) => s.checking);
  const lastGoodAt = useZoteroStore((s) => s.lastGoodAt);
  const check = useZoteroStore((s) => s.check);

  // 端口输入框用字符串草稿：允许用户清空重输，blur 时再归一化回写
  const [portText, setPortText] = useState(() => String(z.port));
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeNote, setProbeNote] = useState("");

  const update = (fn: (cur: ZoteroSettings) => ZoteroSettings) => {
    const cur = useSettingsStore.getState().settings;
    setSettings({
      ...cur,
      zotero: fn({ ...(cur.zotero ?? DEFAULT_ZOTERO_SETTINGS) }),
    });
  };

  // 打开页签时刷新一次（启动/轮询也会自检，check 内部会合并并发请求）
  useEffect(() => {
    const cfg = useSettingsStore.getState().settings.zotero ?? DEFAULT_ZOTERO_SETTINGS;
    if (cfg.enabled && !useZoteroStore.getState().checking) void check(cfg.port);
    // 仅挂载时执行：页签切换会重建本组件
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const diag = diagnose(health, z.enabled, checking);
  const lines = z.enabled && health ? capabilityLines(health) : [];
  const port = normalizePort(portText);

  const runProbe = async () => {
    setProbeBusy(true);
    setProbeNote("");
    try {
      const ok = await zoteroApi.probeBbt(port);
      setProbeNote(
        ok
          ? "Better BibTeX 在线（probe 返回 ready，未弹出 Zotero 选择器）"
          : "未检测到 Better BibTeX（或 Zotero 未启动）；P1 起会走本地 API 只读降级",
      );
    } catch (e) {
      setProbeNote(`探测失败：${String(e)}`);
    } finally {
      setProbeBusy(false);
    }
  };

  return (
    <div className="set-pane" role="tabpanel">
      <h4>连接</h4>
      <Row
        label="启用 Zotero 联动"
        hint="只读联动：连接自检、.bib 自动同步、引用索引刷新；不会修改 Zotero 文献库"
      >
        <Toggle
          checked={z.enabled}
          onChange={(v) => update((cur) => ({ ...cur, enabled: v }))}
        />
      </Row>
      <Row
        label="本地 API 端口"
        hint={`请求由 Rust 内核发往 ${endpointFor(port)}；主机固定 localhost，不可配置`}
      >
        <input
          className="txt-in zotero-port"
          type="number"
          min={1}
          max={65535}
          step={1}
          value={portText}
          onChange={(e) => {
            const raw = e.target.value;
            setPortText(raw);
            update((cur) => ({ ...cur, port: normalizePort(raw) }));
          }}
          onBlur={() => {
            const n = normalizePort(portText);
            setPortText(String(n));
            update((cur) => ({ ...cur, port: n }));
          }}
        />
      </Row>
      <Row label="自动同步" hint="监听受管 .bib（防抖 + hash 去重）+ 窗口获焦主动拉取（60 秒节流）">
        <Toggle
          checked={z.autoSync}
          onChange={(v) => update((cur) => ({ ...cur, autoSync: v }))}
        />
      </Row>
      <Row label="编译前校验" hint="编译前检查 .bib 与 \cite 一致性并写入日志；失败不阻断编译">
        <Toggle
          checked={z.syncOnCompile}
          onChange={(v) => update((cur) => ({ ...cur, syncOnCompile: v }))}
        />
      </Row>
      <Row label="自检间隔" hint="10–300 秒；离线时也会按此间隔自动重试恢复">
        <select
          className="zotero-port"
          value={String(normalizeIntervalSeconds(z.pollIntervalSeconds))}
          onChange={(e) =>
            update((cur) => ({
              ...cur,
              pollIntervalSeconds: normalizeIntervalSeconds(e.target.value),
            }))
          }
        >
          {[10, 20, 30, 60, 120, 300].map((n) => (
            <option key={n} value={n}>
              {n} 秒
            </option>
          ))}
        </select>
      </Row>

      <h4>连接自检</h4>
      <div className="zotero-actions">
        <button
          type="button"
          className="btn primary sm"
          disabled={checking}
          onClick={() => void check(port)}
        >
          {checking ? "检查中…" : "一键自检"}
        </button>
        <button
          type="button"
          className="btn sm"
          disabled={probeBusy}
          onClick={() => void runProbe()}
        >
          {probeBusy ? "探测中…" : "重新探测 BBT"}
        </button>
        {lastGoodAt && (
          <span className="zotero-last">上次连接 {formatCheckedAt(lastGoodAt)}</span>
        )}
      </div>

      <div className={`zotero-diag zotero-${diag.tone}`}>
        <b>{diag.title}</b>
        <p>{diag.detail}</p>
        {diag.steps.length > 0 && (
          <ol>
            {diag.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        )}
        {lines.length > 0 && (
          <ul className="zotero-caps">
            {lines.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        )}
        {probeNote && <p className="zotero-probe">{probeNote}</p>}
      </div>

      <ZoteroBindingPane />

      <p className="set-note">
        安全边界：只连接本机 127.0.0.1/localhost，不转发 23119 端口；本地读请求无需鉴权，
        本期也不申请 Zotero 10+ 的写授权。Zotero 未启动或本地 API 未开启时按离线降级，
        项目内 .bib 与缓存照常使用，编译不受影响。
      </p>
    </div>
  );
}

export default ZoteroPane;

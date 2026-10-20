import { useEffect, useRef, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { compileApi, coreApi, projectApi, type PingReply } from "@/ipc/invoke";
import { useAppStore } from "@/core/store";
import { LaTeXEditor, type LaTeXEditorHandle } from "@/editor/LaTeXEditor";
import type { FileDoc, TexDistInfo } from "@/types";
import "./App.css";

/**
 * M0-3a：TeX 发行版检测卡片
 */
function EnvCard() {
  const [info, setInfo] = useState<TexDistInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function detect() {
    setLoading(true);
    try {
      setErr(null);
      setInfo(await compileApi.detectTexDistribution());
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    detect();
  }, []);

  return (
    <div className="card">
      <h2>TeX 环境检测</h2>
      {err && <p className="error">失败: {err}</p>}
      {info && (
        <>
          {info.found ? (
            <p>
              <strong>{info.distribution}</strong>
              {info.version ? ` ${info.version}` : ""} · 推荐引擎{" "}
              <code>{info.recommended}</code>
            </p>
          ) : (
            <p className="error">
              未检测到 TeX 发行版，请先安装 MiKTeX（Windows）或 TeX Live
            </p>
          )}
          <p className="meta">
            引擎:{" "}
            {info.engines.length > 0
              ? info.engines.map((e) => <code key={e}>{e} </code>)
              : "无"}
          </p>
        </>
      )}
      <button onClick={detect} disabled={loading}>
        {loading ? "检测中…" : "重新检测"}
      </button>
    </div>
  );
}

/**
 * M0-4 验收界面：编辑器核心（打开 → 编辑 → Ctrl+S 保存 → 跳行）
 *
 * 验收项（开发计划 M0-4）：
 * 1. GBK 老文档打开不乱码，状态栏显示 encoding/eol
 * 2. 编辑 → Ctrl+S 保存 → 回读校验内容/编码/换行无损
 * 3. 脏状态提示（未保存 ●）
 * 4. gotoLine 程序化跳行（M0-11 错误定位依赖）
 *
 * M0-6 编辑壳落地后整体替换为 项目树 + 多标签 + 状态栏
 */
function EditorLab() {
  const [path, setPath] = useState("");
  const [doc, setDoc] = useState<FileDoc | null>(null);
  const [value, setValue] = useState("");
  const [savedValue, setSavedValue] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lineInput, setLineInput] = useState("1");
  const editorRef = useRef<LaTeXEditorHandle>(null);

  const dirty = path !== "" && value !== savedValue;

  function report(text: string, isError = false) {
    setErr(isError ? text : null);
    setMsg(isError ? null : text);
  }

  async function doOpen() {
    try {
      const picked = await openFileDialog({
        multiple: false,
        filters: [{ name: "LaTeX 源文件", extensions: ["tex", "ltx", "cls", "sty"] }],
      });
      if (typeof picked !== "string") return; // 用户取消
      const d = await projectApi.readFile(picked);
      setPath(picked);
      setDoc(d);
      setValue(d.content);
      setSavedValue(d.content);
      report(`已打开 · encoding=${d.encoding} · eol=${d.eol}`);
    } catch (e) {
      report(String(e), true);
    }
  }

  async function doSave() {
    if (!path) return;
    try {
      await projectApi.writeFile(path, value);
      const d = await projectApi.readFile(path); // 回读校验往返
      const intact = d.content === value || d.content === value.replace(/\n/g, "\r\n");
      setDoc(d);
      setSavedValue(value);
      report(
        `保存成功 · encoding=${d.encoding} · eol=${d.eol} · 往返${intact ? "无损" : "内容有差异"}`,
        !intact,
      );
    } catch (e) {
      report(String(e), true);
    }
  }

  function doGoto() {
    const n = parseInt(lineInput, 10);
    if (!Number.isFinite(n)) return;
    editorRef.current?.gotoLine(n);
  }

  return (
    <div className="card editor-card">
      <h2>M0-4 · 编辑器核心</h2>
      <div className="fs-row">
        <button onClick={doOpen}>打开文件…</button>
        <button onClick={doSave} disabled={!path}>
          保存 (Ctrl+S)
        </button>
        <input
          className="line-input"
          value={lineInput}
          onChange={(e) => setLineInput(e.currentTarget.value)}
          placeholder="行号"
          spellCheck={false}
        />
        <button onClick={doGoto} disabled={!path}>
          跳行
        </button>
      </div>
      <p className="meta">
        {path ? (
          <>
            文件：<code>{path}</code>
            {dirty && <strong className="dirty"> ● 未保存</strong>}
            {doc && (
              <>
                {" "}
                · encoding <b>{doc.encoding}</b> · eol <b>{doc.eol}</b>
              </>
            )}
          </>
        ) : (
          "点击「打开文件…」选择一个 .tex 开始编辑"
        )}
      </p>
      {path ? (
        <LaTeXEditor
          ref={editorRef}
          value={value}
          onChange={setValue}
          onSave={doSave}
          placeholder="开始输入 LaTeX…"
        />
      ) : (
        <div className="editor-empty">（未打开文件）</div>
      )}
      {msg && <p className="ok">{msg}</p>}
      {err && <p className="error">失败: {err}</p>}
    </div>
  );
}

/**
 * M0-1 / M0-2 / M0-3a / M0-4 验收界面
 * M0-6 编辑壳落地后整体替换为 项目树 + 多标签编辑器 + 状态栏
 */
function App() {
  const [ping, setPing] = useState<PingReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const compileStatus = useAppStore((s) => s.compileStatus);

  async function doPing() {
    try {
      setError(null);
      setPing(await coreApi.ping());
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    doPing();
  }, []);

  return (
    <main className="container">
      <h1>LaTeX 工作台</h1>
      <p className="milestone">M0-4 · 编辑器核心（CM6 打开/保存/跳行）</p>

      <EnvCard />

      <div className="card">
        <h2>IPC 往返（ping）</h2>
        {error ? (
          <p className="error">失败: {error}</p>
        ) : ping ? (
          <p>
            {ping.msg} · <code>ts={ping.ts}</code>
          </p>
        ) : (
          <p>等待内核响应…</p>
        )}
        <button onClick={doPing}>重新 Ping</button>
      </div>

      <EditorLab />

      <div className="card">
        <h2>全局状态（zustand）</h2>
        <p>
          编译状态: <strong>{compileStatus}</strong>
        </p>
      </div>
    </main>
  );
}

export default App;

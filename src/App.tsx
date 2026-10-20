import { useEffect, useState } from "react";
import { coreApi, projectApi, type PingReply } from "@/ipc/invoke";
import { useAppStore } from "@/core/store";
import type { FileDoc } from "@/types";
import "./App.css";

/**
 * M0-2 验收界面：持久层读写测试（M0-6 编辑壳落地后整体替换）
 *
 * 验收项：
 * 1. GBK + CRLF 文件 → 读取不乱码，encoding=eol 元数据正确
 * 2. 读→写（不改内容）→ 再读：编码/EOL/内容无损往返
 * 3. 新内容含 LF → 保存后按原 EOL 转 CRLF
 * 4. revert_file 重读
 */
function FsLab() {
  const [path, setPath] = useState("");
  const [doc, setDoc] = useState<FileDoc | null>(null);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function report(ok: string, e?: unknown) {
    setErr(e === undefined ? null : String(e));
    setMsg(e === undefined ? ok : null);
  }

  async function doRead() {
    try {
      const d = await projectApi.readFile(path.trim());
      setDoc(d);
      setDraft(d.content);
      report(`读取成功 · encoding=${d.encoding} · eol=${d.eol}`);
    } catch (e) {
      report("", e);
    }
  }

  async function doWrite() {
    try {
      await projectApi.writeFile(path.trim(), draft);
      const d = await projectApi.readFile(path.trim());
      setDoc(d);
      setDraft(d.content);
      const intact = d.content === draft || d.content === draft.replace(/\n/g, "\r\n");
      report(
        `写入成功 · encoding=${d.encoding} · eol=${d.eol} · 往返${intact ? "无损" : "内容有差异"}`,
      );
    } catch (e) {
      report("", e);
    }
  }

  async function doRevert() {
    try {
      const d = await projectApi.revertFile(path.trim());
      setDoc(d);
      setDraft(d.content);
      report(`已重读磁盘 · encoding=${d.encoding} · eol=${d.eol}`);
    } catch (e) {
      report("", e);
    }
  }

  return (
    <div className="card">
      <h2>持久层 · 读写测试</h2>
      <div className="fs-row">
        <input
          value={path}
          onChange={(e) => setPath(e.currentTarget.value)}
          placeholder="文件绝对路径，如 E:\test\gbk.tex"
          spellCheck={false}
        />
      </div>
      <div className="fs-row">
        <button onClick={doRead}>读取</button>
        <button onClick={doWrite}>写回</button>
        <button onClick={doRevert}>Revert 重读</button>
      </div>
      {doc && (
        <p className="meta">
          encoding: <strong>{doc.encoding}</strong> · eol: <strong>{doc.eol}</strong>
        </p>
      )}
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        rows={8}
        spellCheck={false}
      />
      {msg && <p className="ok">{msg}</p>}
      {err && <p className="error">失败: {err}</p>}
    </div>
  );
}

/**
 * M0-1/M0-2 验收界面
 * M0-6 编辑壳落地后整体替换为 项目树 + 编辑器 + 状态栏
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
      <p className="milestone">M0-2 · 持久层</p>

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

      <FsLab />

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

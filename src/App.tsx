import { useEffect, useState } from "react";
import { coreApi, type PingReply } from "@/ipc/invoke";
import { useAppStore } from "@/core/store";
import "./App.css";

/**
 * M0-1 验收界面：IPC 往返验证 + 状态/总线占位
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
      <p className="milestone">M0-1 · 基础设施骨架</p>

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

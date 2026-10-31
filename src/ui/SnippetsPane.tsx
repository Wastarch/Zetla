// M2-5c · 「代码片段」设置页：双栏管理（左列表 / 右编辑）+ 校验 + 导入导出。
// 数据流：用户自定义片段存独立 snippets.json（snippetsApi），与 AppSettings 的
// 「保存设置」解耦——本页自带「保存片段」按钮，保存即落盘并 refreshUserSnippets，
// 编辑器内立刻可用；未保存的改动在关闭对话框时丢弃（与底部取消语义一致）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirm, open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import {
  DEFAULT_SNIPPETS,
  MAX_SNIPPETS,
  isValidTrigger,
  newSnippetId,
  normalizeSnippets,
  type SnippetDef,
} from "@/types/snippets";
import { projectApi, snippetsApi } from "@/ipc/invoke";
import { setUserSnippets } from "@/editor/snippetsSupport";
import { notify } from "@/project/useProject";
import { Icon } from "@/ui/Icon";
import { registerSnippetsBridge } from "@/ui/snippetsPaneBridge";

/** 左侧选中项：内置（只读）或自定义（可编辑） */
type Selection = { kind: "builtin" | "custom"; id: string } | null;

const BUILTIN_TRIGGERS = new Set(DEFAULT_SNIPPETS.map((s) => s.trigger.toLowerCase()));

// 模块级草稿缓存：设置页切换页签会卸载本组件（{pane === "snippets" && …}），
// 未保存的改动必须跨挂载保留，否则「改一半 → 看一眼编辑器页 → 切回」就丢了。
let cachedDraft: SnippetDef[] | null = null;
let cachedDirty = false;

/** 取消/关闭设置对话框时丢弃草稿（下次打开重新从 snippets.json 读） */
export function resetSnippetsDraft(): void {
  cachedDraft = null;
  cachedDirty = false;
}

export function SnippetsPane() {
  const [user, setUser] = useState<SnippetDef[]>(() => cachedDraft ?? []);
  const [dirty, setDirty] = useState(() => cachedDirty);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<Selection>(null);
  const [q, setQ] = useState("");

  // 草稿回写缓存（切页签/关闭后重新挂载时恢复）
  useEffect(() => {
    cachedDraft = user;
  }, [user]);
  useEffect(() => {
    cachedDirty = dirty;
  }, [dirty]);

  // 打开页签即从后端读取（缺失/损坏回空列表，不影响内置包）；
  // 已有未保存草稿时跳过，避免覆盖用户的编辑。
  useEffect(() => {
    if (cachedDraft !== null) return;
    void (async () => {
      try {
        const list = await snippetsApi.loadUserSnippets();
        setUser((prev) => (prev.length > 0 ? prev : normalizeSnippets(list)));
      } catch (e) {
        console.warn("[snippets] 读取用户片段失败", e);
      }
    })();
  }, []);

  /** 触发词校验：返回 id → 错误说明（空对象 = 全部合法） */
  const problems = useMemo(() => {
    const errs: Record<string, string> = {};
    const seen = new Map<string, string>();
    for (const s of user) {
      const t = s.trigger.trim();
      if (!t) {
        errs[s.id] = "触发词不能为空";
        continue;
      }
      if (!isValidTrigger(t)) {
        errs[s.id] = "触发词不能含反斜杠或空白";
        continue;
      }
      if (!s.body.trim()) {
        errs[s.id] = "展开内容不能为空";
        continue;
      }
      const low = t.toLowerCase();
      if (BUILTIN_TRIGGERS.has(low)) {
        errs[s.id] = "与内置片段触发词冲突";
        continue;
      }
      if (seen.has(low)) {
        errs[s.id] = `与「${seen.get(low)}」重复`;
        continue;
      }
      seen.set(low, t);
    }
    return errs;
  }, [user]);

  const hasError = Object.keys(problems).length > 0;

  const patch = useCallback((id: string, p: Partial<SnippetDef>) => {
    setUser((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));
    setDirty(true);
  }, []);

  const addNew = useCallback(() => {
    if (user.length >= MAX_SNIPPETS) {
      notify(`自定义片段已达上限（${MAX_SNIPPETS} 条）`, "err");
      return;
    }
    const snip: SnippetDef = {
      id: newSnippetId(),
      trigger: "",
      desc: "",
      category: "自定义",
      body: "",
    };
    setUser((prev) => [snip, ...prev]);
    setSel({ kind: "custom", id: snip.id });
    setDirty(true);
  }, [user.length]);

  /** 内置片段「复制为自定义」：触发词冲突时加数字后缀 */
  const copyBuiltin = useCallback(
    (src: SnippetDef) => {
      if (user.length >= MAX_SNIPPETS) {
        notify(`自定义片段已达上限（${MAX_SNIPPETS} 条）`, "err");
        return;
      }
      let trigger = `${src.trigger}2`;
      while (BUILTIN_TRIGGERS.has(trigger.toLowerCase()) || user.some((s) => s.trigger.toLowerCase() === trigger.toLowerCase())) {
        trigger += "2";
      }
      const snip: SnippetDef = { ...src, id: newSnippetId(), trigger, desc: `${src.desc ?? ""}（副本）` };
      setUser((prev) => [snip, ...prev]);
      setSel({ kind: "custom", id: snip.id });
      setDirty(true);
    },
    [user],
  );

  const removeItem = useCallback(
    async (id: string) => {
      const target = user.find((s) => s.id === id);
      if (!target) return;
      const ok = await confirm(`删除片段「${target.trigger || "(未命名)"}」？`, { title: "删除片段" });
      if (!ok) return;
      setUser((prev) => prev.filter((s) => s.id !== id));
      setSel(null);
      setDirty(true);
    },
    [user],
  );

  const save = useCallback(async () => {
    if (hasError) {
      notify("请先修正标记为红色的片段（触发词为空/冲突/重复）", "err");
      return;
    }
    setBusy(true);
    try {
      // category 空白兜底（否则 Rust 归一化会整条丢弃）
      const cleaned = user.map((s) => ({ ...s, category: s.category.trim() || "自定义" }));
      const saved = await snippetsApi.saveUserSnippets(cleaned);
      setUser(saved);
      setUserSnippets(saved); // 编辑器补全立即生效，无需重启
      setDirty(false);
      notify(`已保存 ${saved.length} 条自定义片段`, "ok");
    } catch (e) {
      notify(String(e), "err");
    } finally {
      setBusy(false);
    }
  }, [user, hasError]);

  // 设置对话框底部「保存设置 / 取消」经桥接感知本页草稿：
  // 保存时先落盘（非法片段已被 hasError 拦住，不阻塞设置保存）；取消时提示确认。
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const canSaveRef = useRef(false);
  canSaveRef.current = !hasError && !busy;
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(
    () =>
      registerSnippetsBridge(
        async () => {
          if (dirtyRef.current && canSaveRef.current) await saveRef.current();
        },
        () => dirtyRef.current,
      ),
    [],
  );

  const doExport = useCallback(async () => {
    try {
      const path = await saveFileDialog({
        title: "导出片段包",
        defaultPath: "zetla-snippets.json",
        filters: [{ name: "片段包", extensions: ["json"] }],
      });
      if (!path) return;
      const payload = { schemaVersion: 1, custom: user };
      await projectApi.writeFile(path, JSON.stringify(payload, null, 2));
      notify(`已导出 ${user.length} 条自定义片段`, "ok");
    } catch (e) {
      notify(`导出失败：${String(e)}`, "err");
    }
  }, [user]);

  const doImport = useCallback(async () => {
    try {
      const picked = await openFileDialog({
        title: "导入片段包",
        multiple: false,
        filters: [{ name: "片段包", extensions: ["json"] }],
      });
      if (!picked || Array.isArray(picked)) return;
      const doc = await projectApi.readFile(picked);
      const raw: unknown = JSON.parse(doc.content);
      const arr = Array.isArray(raw)
        ? raw
        : (raw as { custom?: unknown } | null)?.custom;
      if (!Array.isArray(arr)) {
        notify("不是有效的片段包（需要数组或 { custom: [...] }）", "err");
        return;
      }
      const incoming = normalizeSnippets(arr as SnippetDef[]);
      if (incoming.length === 0) {
        notify("片段包里没有可用片段", "err");
        return;
      }
      const overwrite = await confirm(
        `导入 ${incoming.length} 条片段。\n\n确定 = 覆盖现有 ${user.length} 条自定义片段\n取消 = 追加合并（同触发词以导入的为准）`,
        { title: "导入片段" },
      );
      const merged = overwrite ? incoming : normalizeSnippets([...user, ...incoming]);
      setUser(merged);
      setSel(null);
      setDirty(true);
      notify(`已导入 ${incoming.length} 条，点「保存片段」生效`, "ok");
    } catch (e) {
      notify(`导入失败：${String(e)}`, "err");
    }
  }, [user]);

  const kw = q.trim().toLowerCase();
  const match = (s: SnippetDef) =>
    !kw ||
    s.trigger.toLowerCase().includes(kw) ||
    (s.desc ?? "").toLowerCase().includes(kw) ||
    s.category.toLowerCase().includes(kw);

  const builtinList = DEFAULT_SNIPPETS.filter(match);
  const customList = user.filter(match);

  const current: SnippetDef | null =
    sel === null
      ? null
      : sel.kind === "builtin"
        ? (DEFAULT_SNIPPETS.find((s) => s.id === sel.id) ?? null)
        : (user.find((s) => s.id === sel.id) ?? null);

  return (
    <div className="set-pane snip-pane" role="tabpanel">
      <h4>代码片段</h4>
      <div className="set-note">
        在 <code>.tex</code> 中键入触发词后按 <kbd>Tab</kbd> 展开；选中文字后经「编辑 → 插入代码片段…」
        可包裹（如 <code>bf</code> → <code>\textbf{"{选中文字}"}</code>）。模板支持{" "}
        <code>{"${1:占位}"}</code> 占位符与 <code>$SELECTION</code> 选中包裹。片段独立保存，
        改完点「保存片段」立即生效。
      </div>

      <div className="snip-cols">
        <aside className="snip-list">
          <div className="snip-list-head">
            <input
              className="txt-in"
              placeholder="搜索触发词 / 描述"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button type="button" className="ibtn" title="新建片段" onClick={addNew}>
              <Icon name="plus" size={14} />
            </button>
          </div>

          {builtinList.length > 0 && (
            <div className="snip-group">内置（{builtinList.length}）</div>
          )}
          {builtinList.map((s) => (
            <button
              key={s.id}
              type="button"
              className={
                sel?.kind === "builtin" && sel.id === s.id ? "snip-item on" : "snip-item"
              }
              onClick={() => setSel({ kind: "builtin", id: s.id })}
              title={s.desc}
            >
              <span className="snip-trigger">{s.trigger}</span>
              <span className="snip-desc">{s.desc ?? s.category}</span>
            </button>
          ))}

          <div className="snip-group">自定义（{user.length}）</div>
          {customList.length === 0 && (
            <div className="snip-empty">
              {user.length === 0 ? "还没有自定义片段，点右上 + 新建" : "无匹配项"}
            </div>
          )}
          {customList.map((s) => (
            <button
              key={s.id}
              type="button"
              className={[
                "snip-item",
                sel?.kind === "custom" && sel.id === s.id ? "on" : "",
                problems[s.id] ? "err" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setSel({ kind: "custom", id: s.id })}
              title={problems[s.id] ?? s.desc}
            >
              <span className="snip-trigger">{s.trigger || "(未命名)"}</span>
              <span className="snip-desc">{problems[s.id] ?? (s.desc || s.category)}</span>
            </button>
          ))}
        </aside>

        <section className="snip-edit">
          {current === null ? (
            <div className="snip-hint">
              <Icon name="list" size={22} />
              <p>从左侧选择片段查看/编辑，或点列表右上角 + 新建一条。</p>
              <p className="dim">
                自定义片段存于用户配置目录的 <code>snippets.json</code>，可通过「导出」分享给他人。
              </p>
            </div>
          ) : sel?.kind === "builtin" ? (
            <>
              <div className="snip-edit-head">
                <b>{current.trigger}</b>
                <span className="tag">内置 · 只读</span>
                <span className="spacer" />
                <button
                  type="button"
                  className="btn"
                  onClick={() => copyBuiltin(current)}
                  title="以当前内容创建一条自定义副本"
                >
                  复制为自定义
                </button>
              </div>
              <div className="snip-meta">
                {current.category}
                {current.desc ? ` · ${current.desc}` : ""}
              </div>
              <pre className="snip-body-ro">{current.body}</pre>
            </>
          ) : (
            <>
              <div className="snip-edit-head">
                <b>{current.trigger || "(未命名)"}</b>
                <span className="spacer" />
                <button
                  type="button"
                  className="ibtn"
                  title="删除该片段"
                  onClick={() => void removeItem(current.id)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>

              <label className="snip-field">
                <span>触发词</span>
                <input
                  className="txt-in"
                  placeholder="如 mkxw（不含反斜杠与空格）"
                  value={current.trigger}
                  onChange={(e) => patch(current.id, { trigger: e.target.value })}
                />
              </label>
              {problems[current.id] && (
                <div className="snip-alert">{problems[current.id]}</div>
              )}

              <div className="snip-row">
                <label className="snip-field">
                  <span>描述</span>
                  <input
                    className="txt-in"
                    placeholder="补全弹窗里显示的说明"
                    value={current.desc ?? ""}
                    onChange={(e) => patch(current.id, { desc: e.target.value })}
                  />
                </label>
                <label className="snip-field">
                  <span>分类</span>
                  <input
                    className="txt-in"
                    placeholder="如 数学 / 结构"
                    value={current.category}
                    onChange={(e) => patch(current.id, { category: e.target.value })}
                  />
                </label>
              </div>

              <label className="snip-field grow">
                <span>
                  展开内容（LaTeX；<code>{"${1:占位}"}</code> 逐位跳转，<code>$SELECTION</code> 选中包裹）
                </span>
                <textarea
                  className="snip-body-in"
                  spellCheck={false}
                  value={current.body}
                  onChange={(e) => patch(current.id, { body: e.target.value })}
                  placeholder={"\\begin{equation}\n\t${1:x}\n\\end{equation}${0}"}
                />
              </label>
            </>
          )}
        </section>
      </div>

      <div className="snip-actions">
        <button type="button" className="btn" onClick={() => void doImport()}>
          导入…
        </button>
        <button type="button" className="btn" onClick={() => void doExport()} disabled={user.length === 0}>
          导出…
        </button>
        <span className="spacer" />
        {dirty && <span className="snip-dirty">有未保存的改动</span>}
        <button
          type="button"
          className="btn primary"
          onClick={() => void save()}
          disabled={!dirty || hasError || busy}
          title={hasError ? "存在非法片段，无法保存" : "保存并立即生效"}
        >
          保存片段
        </button>
      </div>
    </div>
  );
}

export default SnippetsPane;

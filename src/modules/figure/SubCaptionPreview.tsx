// F3 · 子标题内联预览：解析 $...$（inline）与 $$...$$（display），复用公式模块 FormulaKaTeX。
// 纯文本段原样输出；公式段交给 KaTeX（strict 模式，出错回退源码，保证编辑中不崩）。
import FormulaKaTeX from "@/modules/formula/FormulaKaTeX";

type Segment = { type: "text" | "math"; content: string; display: boolean };

/** 把混合文本切成 文本 / 公式 片段（按 $ 包裹识别，贪婪匹配 $$…$$ 优先） */
function parseMixed(text: string): Segment[] {
  const out: Segment[] = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ type: "text", content: text.slice(last, m.index), display: false });
    }
    if (m[1] !== undefined) out.push({ type: "math", content: m[1], display: true });
    else out.push({ type: "math", content: m[2], display: false });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ type: "text", content: text.slice(last), display: false });
  return out;
}

export default function SubCaptionPreview({ text }: { text: string }) {
  if (!text.trim()) return <span className="fig-scap-empty">（无子标题预览）</span>;
  const segs = parseMixed(text);
  return (
    <span className="fig-scap">
      {segs.map((s, i) =>
        s.type === "text" ? (
          <span key={i}>{s.content}</span>
        ) : (
          <FormulaKaTeX key={i} tex={s.content} display={s.display} strict />
        )
      )}
    </span>
  );
}

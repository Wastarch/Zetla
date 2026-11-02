// 公式定位器（M1-19，M1-20 修订）：全文单遍扫描，产出所有公式容器 region，供常驻 ✎ 标记扫描全文。
// 覆盖：$…$（inline）、$$…$$（display）、公式环境（equation/align/gather/cases/…）。
// 鲁棒性：转义（\$ \% \\）、% 注释、\verb、verbatim/lstlisting/minted 整段快进均不触发数学态；
//         未闭合的 opener 丢弃（不产生 region），envStack 通用压栈保证 \begin/\end 配对，
//         嵌套公式环境（align 内套 cases）产出内外两个 region，各在自身开头生成独立标记。
// 纯函数 + doc 引用缓存（同一 doc 字符串重复扫描不重算）。
import { fingerprintOf } from "@/editor/envEdit";

export type FormulaWrapKind = "inline" | "display" | "env";

export interface FormulaHit {
  /** 整体区间（含包裹定界符） */
  from: number;
  to: number;
  /** body 区间（剥包裹，未 trim） */
  bodyFrom: number;
  bodyTo: number;
  /** trim 后的 body（载入编写区用；\label 等原样保留，重包裹时自然带回） */
  body: string;
  wrapKind: FormulaWrapKind;
  /** wrapKind==="env" 时的环境名 */
  envName?: string;
  /** 区间原文指纹（djb2，与表格同口径） */
  fingerprint: string;
  /** 区间源码原文（未改动时原样写回的保底依据） */
  sourceText: string;
  /** ✎ 标记锚点：紧接开头定界符之后（\begin{…} 之后 / $ 之后） */
  markAt: number;
}

/** 公式容器环境（\begin{name}…\end{name} 整体作为一个可编辑公式） */
const FORMULA_ENV_RE =
  /^(equation\*?|align\*?|gather\*?|multline\*?|flalign\*?|eqnarray\*?|cases|split|aligned|alignedat|gathered|CD|displaymath|math)$/;

/** verbatim 类环境：内部 $ % \begin 全是字面量，整段快进 */
const VERBATIM_ENV_RE = /^(verbatim\*?|lstlisting|minted)$/;

interface Region {
  from: number;
  to: number;
  bodyFrom: number;
  bodyTo: number;
  wrapKind: FormulaWrapKind;
  envName?: string;
}

/** 读一个平衡花括号组（s[i] 必须是 '{'）；与 tableParse.readGroup 同款实现（模块间不互依，各自持有） */
function readGroup(s: string, i: number): { text: string; end: number } | null {
  if (s[i] !== "{") return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const ch = s[j];
    if (ch === "\\") {
      j++; // 跳过转义字符（\{ \} 不参与配对）
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { text: s.slice(i + 1, j), end: j + 1 };
    }
  }
  return null;
}

/** 从位置 i 起读 \begin/\end 的 {name} 组（容忍空白）；返回组名与组后位置 */
function readEnvName(doc: string, i: number): { name: string; end: number } | null {
  let k = i;
  while (k < doc.length && /\s/.test(doc[k])) k++;
  const g = readGroup(doc, k);
  if (!g) return null;
  return { name: g.text.trim(), end: g.end };
}

/**
 * 从 from 起找非转义的闭合 $（double=true 时要求 $$ 成对）。
 * 返回闭合 $ 的下标；未闭合返回 -1。
 */
function findClosingDollar(doc: string, from: number, double: boolean): number {
  const n = doc.length;
  let k = from;
  while (k < n) {
    const ch = doc[k];
    if (ch === "\\") {
      k += 2;
      continue;
    }
    if (ch === "$") {
      if (double) {
        if (doc[k + 1] === "$") return k;
        k++;
        continue;
      }
      return k;
    }
    k++;
  }
  return -1;
}

/** 全文单遍扫描，产出全部公式 region */
function scanRegions(doc: string): Region[] {
  const regions: Region[] = [];
  /** 通用 \begin 压栈（保证 \end 配对与嵌套正确；非公式环境也入栈占位） */
  const envStack: { name: string; from: number; bodyFrom: number }[] = [];
  const n = doc.length;
  let i = 0;
  while (i < n) {
    const ch = doc[i];
    if (ch === "\\") {
      const next = doc[i + 1];
      if (next === undefined) {
        i++;
        continue;
      }
      if (/[a-zA-Z]/.test(next)) {
        let j = i + 1;
        while (j < n && /[a-zA-Z]/.test(doc[j])) j++;
        const cmd = doc.slice(i + 1, j);
        if (cmd === "begin" || cmd === "end") {
          const g = readEnvName(doc, j);
          if (!g) {
            i = j;
            continue;
          }
          if (cmd === "begin") {
            if (VERBATIM_ENV_RE.test(g.name)) {
              // verbatim 类：整段快进到 \end{name}（内部一切皆字面量）
              const endTag = `\\end{${g.name}}`;
              const endIdx = doc.indexOf(endTag, g.end);
              i = endIdx >= 0 ? endIdx + endTag.length : g.end;
              continue;
            }
            envStack.push({ name: g.name, from: i, bodyFrom: g.end });
            i = g.end;
            continue;
          }
          // \end{name}：栈内向下找同名项（中间未闭合的丢弃），公式环境收集 region
          for (let k = envStack.length - 1; k >= 0; k--) {
            if (envStack[k].name === g.name) {
              if (FORMULA_ENV_RE.test(g.name)) {
                regions.push({
                  from: envStack[k].from,
                  to: g.end,
                  bodyFrom: envStack[k].bodyFrom,
                  bodyTo: i, // i = 该 \end 命令的反斜杠处
                  wrapKind: "env",
                  envName: g.name,
                });
              }
              envStack.length = k; // 弹出该项及其间所有未闭合
              break;
            }
          }
          i = g.end;
          continue;
        }
        // \verb / \verb*：读到下一个同分隔符（分隔符不能是 *）
        if (cmd === "verb" || cmd === "verb*") {
          const delim = doc[j];
          if (delim !== undefined && delim !== "*") {
            let k = j + 1;
            while (k < n && doc[k] !== delim) k++;
            i = k < n ? k + 1 : n;
            continue;
          }
        }
        i = j;
        continue;
      }
      // 非字母转义（\\ \$ \% \{ …）：整体跳过，不触发任何状态
      i += 2;
      continue;
    }
    if (ch === "%") {
      // 注释：跳到行尾（注释内的 $ \begin 均不计数）
      const nl = doc.indexOf("\n", i);
      i = nl >= 0 ? nl + 1 : n;
      continue;
    }
    if (ch === "$") {
      if (doc[i + 1] === "$") {
        // $$…$$（display 优先于 inline 判定）
        const close = findClosingDollar(doc, i + 2, true);
        if (close >= 0) {
          regions.push({
            from: i,
            to: close + 2,
            bodyFrom: i + 2,
            bodyTo: close,
            wrapKind: "display",
          });
          i = close + 2;
        } else {
          i += 2; // 未闭合：丢弃，继续扫
        }
        continue;
      }
      const close = findClosingDollar(doc, i + 1, false);
      if (close >= 0) {
        regions.push({
          from: i,
          to: close + 1,
          bodyFrom: i + 1,
          bodyTo: close,
          wrapKind: "inline",
        });
        i = close + 1;
      } else {
        i += 1;
      }
      continue;
    }
    i++;
  }
  return regions;
}

/** doc 引用级缓存：同一 doc 字符串重复 hover 不重扫 */
let cacheDoc: string | null = null;
let cacheRegions: Region[] = [];

function scanCached(doc: string): Region[] {
  if (cacheDoc === doc) return cacheRegions;
  cacheRegions = scanRegions(doc);
  cacheDoc = doc;
  return cacheRegions;
}

/**
 * 全文扫描所有公式环境（M1-20 常驻 ✎ 标记用）：把单遍状态机的全部 region 转成
 * FormulaHit（含 from、to、body 区间、wrapKind、envName、fingerprint、sourceText），按 from 升序返回。
 */
export function scanFormulas(doc: string): FormulaHit[] {
  const regions = scanCached(doc);
  return regions.map((r) => {
    const sourceText = doc.slice(r.from, r.to);
    return {
      from: r.from,
      to: r.to,
      bodyFrom: r.bodyFrom,
      bodyTo: r.bodyTo,
      body: doc.slice(r.bodyFrom, r.bodyTo).trim(),
      wrapKind: r.wrapKind,
      envName: r.envName,
      fingerprint: fingerprintOf(sourceText),
      sourceText,
      // ✎ 标记锚点 = 开头定界符之后（\begin{…} 之后 / $ 之后），envMark 以 side:-1 紧贴右侧
      markAt: r.bodyFrom,
    };
  });
}

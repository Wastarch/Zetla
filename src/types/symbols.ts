// 符号索引类型 —— 与 Rust 结构解析产出对齐（开发文档 §3.4-C）

export interface SectionSym {
  /** 章节层级：part/chapter/section/subsection... */
  level: number;
  title: string;
  line: number;
}

export interface LabelSym {
  key: string;
  /** label 语境（figure/table/eq/section...，未知为 ""） */
  kind: string;
  line: number;
}

export interface RefSym {
  key: string;
  /** \ref / \eqref / \autoref ... */
  cmd: string;
  line: number;
}

export interface CiteSym {
  key: string;
  line: number;
}

export interface GraphicSym {
  path: string;
  line: number;
}

export interface EnvironmentSym {
  name: string;
  beginLine: number;
  endLine: number;
}

/** 单文件符号索引 */
export interface SymbolIndex {
  sections: SectionSym[];
  labels: LabelSym[];
  refs: RefSym[];
  cites: CiteSym[];
  graphics: GraphicSym[];
  environments: EnvironmentSym[];
}

/** symbols_updated 事件负载 */
export interface SymbolsUpdatedPayload {
  path: string;
  index: SymbolIndex;
}

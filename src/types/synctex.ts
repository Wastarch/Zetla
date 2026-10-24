// M1-4 · SyncTeX 双向跳转协议类型（与 src-tauri/src/commands/synctex.rs 的 SyncTexHit 一一对应）
// 正向：源码行 → PDF 位置；反向：PDF 点击点 → 源码行。坐标单位 pt，y 自页顶向下。

export interface SyncTexHit {
  /** 源文件绝对路径 */
  file: string;
  /** 1-based 行 */
  line: number;
  /** 1-based 列（引擎未记录列时为 0） */
  column: number;
  /** 1-based 页码 */
  page: number;
  /** pt，距页顶 */
  x: number;
  /** pt，距页顶 */
  y: number;
  /** 命中盒子宽（pt） */
  width: number;
  /** 命中盒子高（pt） */
  height: number;
}

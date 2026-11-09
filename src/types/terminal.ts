// 内置终端协议（feat/terminal）—— 与 src-tauri/src/commands/terminal.rs 一一对应
// 输入/输出均为 base64 字节（shell 输出是任意字节流，不走 UTF-8 字符串以免跨界截断）

/** terminal_create 返回 */
export interface TerminalCreated {
  id: number;
  /** 实际使用的 shell 可执行文件名（欢迎行展示） */
  shell: string;
}

/** terminal_output 事件负载（data = base64 输出字节） */
export interface TerminalOutputEvent {
  id: number;
  data: string;
}

/** terminal_exit 事件负载（code 为 null 表示被信号终止/取不回退出码） */
export interface TerminalExitEvent {
  id: number;
  code: number | null;
}

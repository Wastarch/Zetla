// 图标组件 —— 引用 index.html 内的 SVG sprite（来源 docs/UI/code.html）
import type { CSSProperties } from "react";

export interface IconProps {
  /** sprite 符号名（不含 "i-" 前缀），如 "tex" / "x" / "search" */
  name: string;
  /** 尺寸 px，默认 15（.ic 基准） */
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 15, className, style }: IconProps) {
  return (
    <svg
      className={className ? `ic ${className}` : "ic"}
      width={size}
      height={size}
      style={style}
      aria-hidden="true"
    >
      <use href={`#i-${name}`} />
    </svg>
  );
}

export default Icon;

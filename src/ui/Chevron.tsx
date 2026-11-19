// 统一折叠 / 下拉箭头：一律使用项目树同款 i-chev sprite（右向 chevron 旋转得到四个方向）。
// 语义：open=true 向下（已展开），open=false 向右（可展开）；dir 用于固定方向的下拉/侧边收起。
import type { CSSProperties } from "react";
import { Icon } from "./Icon";

type Direction = "right" | "down" | "left" | "up";

const ROTATION: Record<Direction, number> = {
  right: 0,
  down: 90,
  left: 180,
  up: 270,
};

export interface ChevronProps {
  /** 展开态→向下，折叠态→向右；显式给 dir 时以 dir 为准 */
  open?: boolean;
  dir?: Direction;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export function Chevron({ open = false, dir, size = 12, className, style }: ChevronProps) {
  const angle = ROTATION[dir ?? (open ? "down" : "right")];
  return (
    <Icon
      name="chev"
      size={size}
      className={className ? `ui-chev ${className}` : "ui-chev"}
      style={{ width: size, height: size, transform: `rotate(${angle}deg)`, ...style }}
    />
  );
}

export default Chevron;

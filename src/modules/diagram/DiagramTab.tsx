// M2·绘图模块（F1-1）：主区面板宿主（经模块协议懒加载挂载）。
// 作为「标签页容器」语义根：F4-1 多图管理时在此之上叠加图导航条；
// F1-1 仅承载单工作台 DiagramPanel。
import { DiagramPanel } from "./DiagramPanel";

export default function DiagramTab() {
  return <DiagramPanel />;
}

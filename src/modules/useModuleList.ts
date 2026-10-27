// M1-1 · 模块列表 React 订阅（设置页「模块」页签与 ModuleDock 共用）
// 注册表是普通类（非 zustand store），这里经总线 module:enabled/module:disabled
// 触发重渲染，读取时取最新 list() 快照。
import { useEffect, useState } from "react";
import { bus } from "@/core/bus";
import { BusEvents } from "@/ipc/events";
import { moduleRegistry } from "@/core/moduleRegistry";
import type { LatexModule, ModuleEntryView, ModuleViewDecl } from "@/types/module";

export function useModuleList(): ModuleEntryView[] {
  const [, setRev] = useState(0);
  useEffect(() => {
    const bump = () => setRev((r) => r + 1);
    const off1 = bus.on(BusEvents.moduleEnabled, bump);
    const off2 = bus.on(BusEvents.moduleDisabled, bump);
    return () => {
      off1();
      off2();
    };
  }, []);
  return moduleRegistry.list();
}

/** 指定槽位中已启用且带组件的模块（ModuleDock 用，同样经总线刷新） */
export function useSlotModules(slot: LatexModule["slot"]): LatexModule[] {
  const [, setRev] = useState(0);
  useEffect(() => {
    const bump = () => setRev((r) => r + 1);
    const off1 = bus.on(BusEvents.moduleEnabled, bump);
    const off2 = bus.on(BusEvents.moduleDisabled, bump);
    return () => {
      off1();
      off2();
    };
  }, []);
  return moduleRegistry.listSlot(slot);
}

/**
 * M1-8：已启用模块自带视图列表（活动栏 + 侧栏渲染消费）。
 * 与 useModuleList 同一套总线订阅：模块启停即刷新，视图项出现/消失。
 */
export function useModuleViews(): Array<{ module: LatexModule; view: ModuleViewDecl }> {
  const [, setRev] = useState(0);
  useEffect(() => {
    const bump = () => setRev((r) => r + 1);
    const off1 = bus.on(BusEvents.moduleEnabled, bump);
    const off2 = bus.on(BusEvents.moduleDisabled, bump);
    return () => {
      off1();
      off2();
    };
  }, []);
  return moduleRegistry.listViews();
}

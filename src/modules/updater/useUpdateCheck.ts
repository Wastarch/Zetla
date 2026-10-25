// M1-13 · 挂载后自动检测一次 + 监听下载进度事件
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useUpdateStore } from "./updateStore";
import type { UpdateProgress } from "./types";

export function useUpdateCheck() {
  useEffect(() => {
    void useUpdateStore.getState().check();
    const task = listen<UpdateProgress>("update-progress", (e) => {
      useUpdateStore.getState().setProgress(e.payload);
    });
    return () => {
      task.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);
}

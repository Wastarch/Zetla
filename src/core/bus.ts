// 轻量前端事件总线 —— 模块间解耦通信（模块间不直接调用，一律走总线）
// 与 zustand store 分工：bus 管"事件/通知"，store 管"状态"

type Handler = (payload: unknown) => void;

class EventBus {
  private handlers = new Map<string, Set<Handler>>();

  /** 订阅；返回取消订阅函数 */
  on(event: string, handler: Handler): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
    };
  }

  /** 一次性订阅 */
  once(event: string, handler: Handler): () => void {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  /** 广播 */
  emit(event: string, payload?: unknown): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of [...set]) {
      try {
        h(payload);
      } catch (err) {
        console.error(`[bus] handler error on "${event}"`, err);
      }
    }
  }

  /** 清空全部订阅（慎用） */
  clear(): void {
    this.handlers.clear();
  }
}

export const bus = new EventBus();

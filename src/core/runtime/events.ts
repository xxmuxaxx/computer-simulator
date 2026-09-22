export interface RuntimeEventMap {
  'instance:started': { pid: number; appId: string };
  'instance:paused': { pid: number; appId: string };
  'instance:resumed': { pid: number; appId: string };
  'instance:stopped': { pid: number; appId: string };
  'instance:crashed': { pid: number; appId: string; message?: string };
  'manifest:installed': { appId: string };
  'manifest:removed': { appId: string };
}

export type RuntimeEventName = keyof RuntimeEventMap;

type Listener<K extends RuntimeEventName> = (payload: RuntimeEventMap[K]) => void;

/**
 * Small typed pub/sub for runtime lifecycle events (the Runtime Monitor debug view and tests
 * subscribe here instead of polling RuntimeManager's version counter every frame).
 */
export class RuntimeEventBus {
  private listeners = new Map<RuntimeEventName, Set<Listener<never>>>();

  on<K extends RuntimeEventName>(event: K, listener: Listener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => {
      set!.delete(listener as Listener<never>);
    };
  }

  emit<K extends RuntimeEventName>(event: K, payload: RuntimeEventMap[K]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) (listener as Listener<K>)(payload);
  }
}

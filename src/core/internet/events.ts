import type { InternetEventMap, InternetEventName } from './types';

type Listener<K extends InternetEventName> = (payload: InternetEventMap[K]) => void;

/** Typed pub/sub for the Virtual Internet layer, mirroring network/events.ts's NetworkEventBus. */
export class InternetEventBus {
  private listeners = new Map<InternetEventName, Set<Listener<never>>>();

  on<K extends InternetEventName>(event: K, listener: Listener<K>): () => void {
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

  emit<K extends InternetEventName>(event: K, payload: InternetEventMap[K]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) (listener as Listener<K>)(payload);
  }
}

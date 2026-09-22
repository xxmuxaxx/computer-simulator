import type { NetworkEventMap, NetworkEventName } from './types';

type Listener<K extends NetworkEventName> = (payload: NetworkEventMap[K]) => void;

/**
 * Small typed pub/sub so Network Monitor and other consumers can subscribe to specific
 * network events (packet sent, service stopped, ...) without polling NetworkManager's
 * version counter on every tick.
 */
export class NetworkEventBus {
  private listeners = new Map<NetworkEventName, Set<Listener<never>>>();

  on<K extends NetworkEventName>(event: K, listener: Listener<K>): () => void {
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

  emit<K extends NetworkEventName>(event: K, payload: NetworkEventMap[K]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) (listener as Listener<K>)(payload);
  }
}

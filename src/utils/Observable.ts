export type Listener = () => void;

/** Minimal observable base compatible with React's useSyncExternalStore. */
export class Observable {
  private listeners = new Set<Listener>();
  private _version = 0;

  /** Increments on every change; usable as a cheap snapshot. */
  get version(): number {
    return this._version;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = (): number => this._version;

  protected emit(): void {
    this._version++;
    for (const l of [...this.listeners]) l();
  }
}

import type { RuntimePermission } from './types';

export interface RuntimeInputSnapshot {
  keys: ReadonlySet<string>;
  mouseX: number;
  mouseY: number;
  mouseButtons: number;
}

/**
 * Buffers keyboard/mouse events pushed by the host component and exposes a plain, serialisable
 * snapshot each tick - never a global `window`/`document` listener the sandboxed module could
 * reach on its own. Permission-gated: a runtime app without `input:keyboard`/`input:mouse` simply
 * never sees those events (fails closed, doesn't throw, since the host component drives this,
 * not the sandboxed code itself).
 */
export class RuntimeInput {
  private permissions: ReadonlySet<RuntimePermission>;
  private keys = new Set<string>();
  private mouseX = 0;
  private mouseY = 0;
  private mouseButtons = 0;
  private _connected = false;

  constructor(permissions: ReadonlySet<RuntimePermission>) {
    this.permissions = permissions;
  }

  get connected(): boolean {
    return this._connected;
  }

  pushKey(code: string, down: boolean): void {
    if (!this.permissions.has('input:keyboard')) return;
    this._connected = true;
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  pushMouse(x: number, y: number, buttons: number): void {
    if (!this.permissions.has('input:mouse')) return;
    this._connected = true;
    this.mouseX = x;
    this.mouseY = y;
    this.mouseButtons = buttons;
  }

  /** Called when the hosting window loses focus - releases all held keys/buttons. */
  blur(): void {
    this.keys.clear();
    this.mouseButtons = 0;
  }

  snapshot(): RuntimeInputSnapshot {
    return { keys: new Set(this.keys), mouseX: this.mouseX, mouseY: this.mouseY, mouseButtons: this.mouseButtons };
  }

  /** Packs the current state into a single word for the WASM import boundary (`env.get_input`). */
  packed(): number {
    let bits = this.mouseButtons & 0x7;
    if (this.keys.size > 0) bits |= 0x8;
    return bits;
  }
}

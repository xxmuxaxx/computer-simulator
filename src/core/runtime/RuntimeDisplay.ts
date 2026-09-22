import { permissionDenied } from './RuntimeError';
import type { RuntimePermission } from './types';

/**
 * Owns the RGBA frame buffer a runtime application renders into. The WASM module never touches a
 * `<canvas>` directly - it writes pixels into its own linear memory, and `ApplicationRuntime.tick()`
 * copies them into this buffer, which the host component then paints with `putImageData`.
 */
export class RuntimeDisplay {
  readonly width: number;
  readonly height: number;
  private buffer: Uint8ClampedArray;
  private permissions: ReadonlySet<RuntimePermission>;

  constructor(width: number, height: number, permissions: ReadonlySet<RuntimePermission>) {
    this.width = width;
    this.height = height;
    this.buffer = new Uint8ClampedArray(width * height * 4);
    this.permissions = permissions;
  }

  /** The raw RGBA pixels, ready to hand to `new ImageData(...)` at the UI boundary. Core itself
   * never touches `ImageData` - that's a browser global, not something this DOM-free layer needs. */
  getFrameBuffer(): Uint8ClampedArray {
    if (!this.permissions.has('display:render')) throw permissionDenied(undefined, 'Missing display:render permission');
    return this.buffer;
  }

  clear(): void {
    this.buffer.fill(0);
  }
}

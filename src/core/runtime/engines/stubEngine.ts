import { runtimeError } from '../RuntimeError';
import type { EngineAdapter, EngineHost } from './types';

const PAGE_BYTES = 64 * 1024;

/** Grows the module's memory, if needed, so a `minBytes`-sized RGBA frame fits at offset 0.
 * A manifest's display size is arbitrary while the stub's initial memory is fixed at build
 * time - this is what lets the two disagree without a trap. */
function ensureCapacity(memory: WebAssembly.Memory, minBytes: number): void {
  const currentPages = memory.buffer.byteLength / PAGE_BYTES;
  const neededPages = Math.ceil(minBytes / PAGE_BYTES);
  if (neededPages > currentPages) memory.grow(neededPages - currentPages);
}

/**
 * Adapter for the placeholder engine in `core/runtime/stub/`: a host-driven module with a tiny
 * bespoke `env.get_input`/`update`/`render` surface, used to prove the generic runtime pipeline
 * without any real engine involved. Also usable as a lightweight fixture for any future test
 * WASM app that wants the same trivial shape.
 */
export function createStubEngineAdapter(host: EngineHost): EngineAdapter {
  let instance: WebAssembly.Instance;
  let memory: WebAssembly.Memory;

  return {
    createImports(): WebAssembly.Imports {
      return {
        env: {
          get_input: () => host.input.packed(),
        },
      };
    },

    bind(inst, mem) {
      instance = inst;
      memory = mem;
    },

    init() {
      // The stub has no exported init function - update()/render() are self-contained.
    },

    tick(dtMs) {
      const width = host.display.width;
      const height = host.display.height;
      const bytes = width * height * 4;
      ensureCapacity(memory, bytes);
      const exports = instance.exports as {
        update?: (dt: number) => void;
        render?: (ptr: number, width: number, height: number) => void;
      };
      try {
        exports.update?.(Math.round(dtMs));
        exports.render?.(0, width, height);
      } catch (e) {
        throw runtimeError(undefined, e instanceof Error ? e.message : String(e));
      }
      const target = host.display.getFrameBuffer();
      const view = new Uint8Array(memory.buffer, 0, Math.min(bytes, memory.buffer.byteLength));
      target.set(view.subarray(0, target.byteLength));
    },
  };
}

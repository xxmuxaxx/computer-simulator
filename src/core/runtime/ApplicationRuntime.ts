import { runtimeError } from './RuntimeError';

export interface RuntimeImports {
  /** Packed keyboard/mouse state - the only thing a module can ask about the outside world. */
  getInput: () => number;
}

export interface LoadedModule {
  instance: WebAssembly.Instance;
  memory: WebAssembly.Memory;
}

/**
 * Builds the exact import object a sandboxed module is instantiated with. This is the whole
 * security boundary: no `fetch`, no DOM, no globals - only the handful of host functions listed
 * here, all of which are pure functions of already permission-checked state.
 */
export function buildImportObject(imports: RuntimeImports): WebAssembly.Imports {
  return {
    env: {
      get_input: imports.getInput,
    },
  };
}

/** Instantiates a WASM module against the sandboxed import object. Never touches the network. */
export async function instantiate(wasmBytes: Uint8Array, imports: RuntimeImports): Promise<LoadedModule> {
  const buffer = wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength) as ArrayBuffer;
  let result: WebAssembly.WebAssemblyInstantiatedSource;
  try {
    result = await WebAssembly.instantiate(buffer, buildImportObject(imports));
  } catch (e) {
    throw runtimeError(undefined, `Failed to load WASM module: ${e instanceof Error ? e.message : String(e)}`);
  }
  const memory = result.instance.exports.memory;
  if (!(memory instanceof WebAssembly.Memory)) throw runtimeError(undefined, 'WASM module does not export memory');
  return { instance: result.instance, memory };
}

const PAGE_BYTES = 64 * 1024;

/** Grows the module's memory, if needed, so a `minBytes`-sized RGBA frame fits at offset 0.
 * A manifest's display size is arbitrary while a stub/engine's initial memory is fixed at build
 * time - this is what lets the two disagree without a trap. */
function ensureCapacity(memory: WebAssembly.Memory, minBytes: number): void {
  const currentPages = memory.buffer.byteLength / PAGE_BYTES;
  const neededPages = Math.ceil(minBytes / PAGE_BYTES);
  if (neededPages > currentPages) memory.grow(neededPages - currentPages);
}

/** Advances the module by one frame and copies its rendered pixels into `target`. */
export function tick(module: LoadedModule, dtMs: number, target: Uint8ClampedArray, width: number, height: number): void {
  const bytes = width * height * 4;
  ensureCapacity(module.memory, bytes);
  const exports = module.instance.exports as {
    update?: (dt: number) => void;
    render?: (ptr: number, width: number, height: number) => void;
  };
  try {
    exports.update?.(Math.round(dtMs));
    exports.render?.(0, width, height);
  } catch (e) {
    throw runtimeError(undefined, e instanceof Error ? e.message : String(e));
  }
  const view = new Uint8Array(module.memory.buffer, 0, Math.min(bytes, module.memory.buffer.byteLength));
  target.set(view.subarray(0, target.byteLength));
}

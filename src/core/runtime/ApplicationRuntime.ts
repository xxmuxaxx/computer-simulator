import { runtimeError } from './RuntimeError';
import type { EngineAdapter } from './engines/types';

/**
 * The sandboxed WASM host: a thin, completely engine-agnostic driver. It knows nothing about any
 * specific engine's import/export shape - all of that lives behind the `EngineAdapter` passed in
 * (see `engines/`). This is what makes swapping the placeholder stub for real doom.wasm, or
 * adding a future engine entirely, a matter of writing a new adapter rather than touching this
 * file.
 */

/** Instantiates a WASM module against the adapter's import object. Never touches the network. */
export async function instantiate(wasmBytes: Uint8Array, adapter: EngineAdapter): Promise<WebAssembly.Instance> {
  const buffer = wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength) as ArrayBuffer;
  let result: WebAssembly.WebAssemblyInstantiatedSource;
  try {
    result = await WebAssembly.instantiate(buffer, adapter.createImports());
  } catch (e) {
    throw runtimeError(undefined, `Failed to load WASM module: ${e instanceof Error ? e.message : String(e)}`);
  }
  const memory = result.instance.exports.memory;
  if (!(memory instanceof WebAssembly.Memory)) throw runtimeError(undefined, 'WASM module does not export memory');
  adapter.bind(result.instance, memory);
  try {
    adapter.init();
  } catch (e) {
    throw runtimeError(undefined, e instanceof Error ? e.message : String(e));
  }
  return result.instance;
}

/** Advances the module by one frame. The adapter is responsible for writing any rendered pixels
 * into the `RuntimeDisplay` it was constructed with - this function only owns error translation. */
export function tick(adapter: EngineAdapter, dtMs: number): void {
  try {
    adapter.tick(dtMs);
  } catch (e) {
    throw runtimeError(undefined, e instanceof Error ? e.message : String(e));
  }
}

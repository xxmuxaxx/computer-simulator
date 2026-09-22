import type { RuntimeDisplay } from '../RuntimeDisplay';
import type { RuntimeFileProvider } from '../RuntimeFileProvider';
import type { RuntimeInput } from '../RuntimeInput';

/**
 * The sandboxed capabilities an EngineAdapter's import implementations are allowed to touch.
 * Every field is already permission-checked/sandboxed (RuntimeFileProvider can't escape its
 * root, RuntimeDisplay/RuntimeInput enforce their own permission grants) - an adapter never
 * gets a raw VirtualFileSystem, DOM canvas or browser event listener.
 */
export interface EngineHost {
  fileProvider: RuntimeFileProvider;
  input: RuntimeInput;
  display: RuntimeDisplay;
  now: () => number;
  log: (level: 'info' | 'error', message: string) => void;
}

/**
 * Translates one specific WASM engine's own import/export surface onto the generic runtime.
 * `ApplicationRuntime`/`RuntimeInstance` only ever talk to this interface - they have zero
 * knowledge of any particular engine's calling convention (host-driven "update/render" like the
 * placeholder stub, or module-driven "tickGame/drawFrame callback" like real doom.wasm).
 */
export interface EngineAdapter {
  /** Builds the WASM import object this engine needs. This is the entire sandboxing boundary:
   * only what's implemented here is reachable by the module - no fetch, no DOM, no globals. */
  createImports(): WebAssembly.Imports;
  /** Called once, right after the instance and its exported memory exist, before `init()` -
   * lets the adapter capture them for later use by import closures built in `createImports()`
   * (which necessarily ran before the instance existed). */
  bind(instance: WebAssembly.Instance, memory: WebAssembly.Memory): void;
  /** Called once, after `bind()`, to perform the engine's own startup. */
  init(): void;
  /** Called once per host tick to advance the engine. */
  tick(dtMs: number): void;
  /** Optional: forward a keyboard event for engines that drive input via direct exported calls
   * (e.g. doom.wasm's reportKeyDown/reportKeyUp) rather than a polled snapshot. */
  handleKeyDown?(domKey: string): void;
  handleKeyUp?(domKey: string): void;
  /** Optional hint: how often (ms) this engine wants `tick()` called. RuntimeInstance's frame
   * loop paces itself to this instead of every animation frame when set - real DOOM only wants
   * ~35 Hz and would otherwise busy-wait internally if ticked at 60 Hz. */
  preferredTickIntervalMs?: number;
}

export type EngineAdapterFactory = (host: EngineHost) => EngineAdapter;

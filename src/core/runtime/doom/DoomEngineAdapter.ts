import { runtimeError } from '../RuntimeError';
import type { EngineAdapter, EngineHost } from '../engines/types';
import { DOOM_WAD_RELATIVE_PATH, isValidWadHeader } from './DoomRuntimeAdapter';

/**
 * Translates doom.wasm's own interface (https://github.com/jacobenget/doom.wasm, GPL-2.0 -
 * see docs/runtime.md for full attribution) onto the generic EngineAdapter contract. All of
 * DOOM's specifics - its 10 imports, BGRA pixel format, WAD-loading protocol, save-game
 * protocol and key-code table - live in this one file; ApplicationRuntime/RuntimeInstance never
 * see any of it.
 */

const SAVE_SLOT_PATH = (id: number) => `saves/slot${id}.dsg`;

/** JS `KeyboardEvent.key` values that don't map to a single printable ASCII character - matched
 * against doom.wasm's own exported KEY_* globals, exactly like the project's own browser example. */
const NAMED_KEY_EXPORTS: Record<string, string> = {
  ArrowLeft: 'KEY_LEFTARROW',
  ArrowRight: 'KEY_RIGHTARROW',
  ArrowUp: 'KEY_UPARROW',
  ArrowDown: 'KEY_DOWNARROW',
  ',': 'KEY_STRAFE_L',
  '.': 'KEY_STRAFE_R',
  Control: 'KEY_FIRE',
  ' ': 'KEY_USE',
  Shift: 'KEY_SHIFT',
  Tab: 'KEY_TAB',
  Escape: 'KEY_ESCAPE',
  Enter: 'KEY_ENTER',
  Backspace: 'KEY_BACKSPACE',
  Alt: 'KEY_ALT',
};

function readGlobal(instance: WebAssembly.Instance, name: string): number | undefined {
  const g = instance.exports[name];
  return g instanceof WebAssembly.Global ? (g.value as number) : undefined;
}

function readUtf8(memory: WebAssembly.Memory, ptr: number, length: number): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(memory.buffer, ptr, length));
}

export function createDoomEngineAdapter(host: EngineHost): EngineAdapter {
  let instance: WebAssembly.Instance;
  let memory: WebAssembly.Memory;
  let doomKeyFromKey: Map<string, number> = new Map();
  let width = 0;
  let height = 0;
  /** Resolved during wadSizes(), consumed by the following readWads() call - keeps both looking
   * at the exact same bytes and validated exactly once. */
  let pendingWad: Uint8Array | null = null;

  /** A stored WAD only counts if it's actually well-formed - see isValidWadHeader()'s doc comment
   * for why a bad file must never reach the engine at all, not even to let it fail on its own. */
  function readValidCustomWad(): Uint8Array | null {
    if (!host.fileProvider.exists(DOOM_WAD_RELATIVE_PATH)) return null;
    const bytes = host.fileProvider.readFile(DOOM_WAD_RELATIVE_PATH);
    if (!isValidWadHeader(bytes)) {
      host.log('error', `${DOOM_WAD_RELATIVE_PATH} doesn't have a valid IWAD/PWAD header - falling back to the built-in Shareware WAD`);
      return null;
    }
    return bytes;
  }

  const view = () => new DataView(memory.buffer);

  return {
    createImports(): WebAssembly.Imports {
      return {
        loading: {
          onGameInit: (w: number, h: number) => {
            width = w;
            height = h;
            if (w !== host.display.width || h !== host.display.height) {
              host.log('info', `doom.wasm reported a ${w}x${h} frame, manifest declared ${host.display.width}x${host.display.height}`);
            }
          },
          wadSizes: (numberOfWadsPtr: number, numberOfTotalBytesPtr: number) => {
            // Left at 0 (its value on entry) means "load the built-in Doom Shareware WAD" -
            // only report a WAD here if the user supplied one through the sandboxed file
            // provider (never a bundled commercial IWAD) *and* it's well-formed.
            pendingWad = readValidCustomWad();
            if (!pendingWad) return;
            view().setInt32(numberOfWadsPtr, 1, true);
            view().setUint32(numberOfTotalBytesPtr, pendingWad.byteLength, true);
          },
          readWads: (wadDataDestPtr: number, byteLengthOfEachWadPtr: number) => {
            const bytes = pendingWad ?? readValidCustomWad();
            if (!bytes) return;
            new Uint8Array(memory.buffer, wadDataDestPtr, bytes.byteLength).set(bytes);
            view().setInt32(byteLengthOfEachWadPtr, bytes.byteLength, true);
          },
        },
        runtimeControl: {
          timeInMilliseconds: (): bigint => BigInt(Math.trunc(host.now())),
        },
        ui: {
          drawFrame: (screenBufferPtr: number) => {
            const pixelCount = width * height;
            const doomFrame = new Uint8Array(memory.buffer, screenBufferPtr, pixelCount * 4);
            const target = host.display.getFrameBuffer();
            const n = Math.min(pixelCount, (width * height * 4) / 4, target.byteLength / 4);
            for (let i = 0; i < n; i++) {
              // doom.wasm packs pixels as 32-bit little-endian ARGB, i.e. bytes ordered BGRA -
              // ImageData wants RGBA, so red and blue are swapped per pixel.
              target[i * 4 + 0] = doomFrame[i * 4 + 2]!; // R
              target[i * 4 + 1] = doomFrame[i * 4 + 1]!; // G
              target[i * 4 + 2] = doomFrame[i * 4 + 0]!; // B
              target[i * 4 + 3] = 255; // A
            }
          },
        },
        gameSaving: {
          sizeOfSaveGame: (gameSaveId: number): number => {
            try {
              return host.fileProvider.exists(SAVE_SLOT_PATH(gameSaveId)) ? host.fileProvider.readFile(SAVE_SLOT_PATH(gameSaveId)).byteLength : 0;
            } catch {
              return 0;
            }
          },
          readSaveGame: (gameSaveId: number, dataDestPtr: number): number => {
            try {
              const bytes = host.fileProvider.readFile(SAVE_SLOT_PATH(gameSaveId));
              new Uint8Array(memory.buffer, dataDestPtr, bytes.byteLength).set(bytes);
              return bytes.byteLength;
            } catch {
              return 0;
            }
          },
          writeSaveGame: (gameSaveId: number, dataPtr: number, length: number): number => {
            try {
              const bytes = new Uint8Array(memory.buffer, dataPtr, length).slice();
              host.fileProvider.writeFile(SAVE_SLOT_PATH(gameSaveId), bytes);
              return length;
            } catch {
              return 0;
            }
          },
        },
        console: {
          onInfoMessage: (ptr: number, length: number) => host.log('info', readUtf8(memory, ptr, length)),
          onErrorMessage: (ptr: number, length: number) => host.log('error', readUtf8(memory, ptr, length)),
        },
      };
    },

    bind(inst, mem) {
      instance = inst;
      memory = mem;
    },

    init() {
      doomKeyFromKey = new Map(
        Object.entries(NAMED_KEY_EXPORTS)
          .map(([key, exportName]) => [key, readGlobal(instance, exportName)] as const)
          .filter((entry): entry is [string, number] => entry[1] !== undefined),
      );
      const exports = instance.exports as { initGame?: () => void };
      if (typeof exports.initGame !== 'function') throw runtimeError(undefined, 'doom.wasm does not export initGame()');
      exports.initGame();
    },

    tick() {
      const exports = instance.exports as { tickGame?: () => void };
      exports.tickGame?.();
    },

    handleKeyDown(domKey) {
      const doomKey = doomKeyFromKey.get(domKey) ?? (domKey.length === 1 ? domKey.charCodeAt(0) : undefined);
      if (doomKey === undefined) return;
      (instance.exports as { reportKeyDown?: (k: number) => void }).reportKeyDown?.(doomKey);
    },

    handleKeyUp(domKey) {
      const doomKey = doomKeyFromKey.get(domKey) ?? (domKey.length === 1 ? domKey.charCodeAt(0) : undefined);
      if (doomKey === undefined) return;
      (instance.exports as { reportKeyUp?: (k: number) => void }).reportKeyUp?.(doomKey);
    },

    // doom.wasm self-paces its tic timing internally but does so by busy-waiting on its imported
    // clock, so the host must still avoid calling tickGame() far more often than Doom's native
    // 35 tics/sec - matches the project's own reference browser example (`setInterval(tickGame,
    // 1000/35)`) instead of driving it from every ~16ms animation frame.
    preferredTickIntervalMs: 1000 / 35,
  };
}

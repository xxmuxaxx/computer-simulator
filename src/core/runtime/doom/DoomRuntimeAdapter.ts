import { decodeStubDoomWasm } from '../stub/stub-doom-bytes';
import type { RuntimeFileProvider } from '../RuntimeFileProvider';
import type { RuntimeManager } from '../RuntimeManager';
import type { RuntimeManifest } from '../types';

/**
 * DOOM's adapter onto the generic Virtual Application Runtime. Ships with a hand-assembled
 * placeholder WASM module (see `core/runtime/stub/`) instead of id Software's engine - it proves
 * the full install/launch/sandbox/display/input/persistence pipeline end-to-end without any real
 * game code. Swapping in a real Emscripten build of a GPL source port later means dropping in a
 * new manifest + wasm binary here; nothing in `core/runtime/` changes.
 */
export const DOOM_APP_ID = 'doom';
export const DOOM_WAD_RELATIVE_PATH = 'wad/DOOM.WAD';

export function createDoomManifest(): RuntimeManifest {
  return {
    id: DOOM_APP_ID,
    name: 'DOOM',
    version: '1.0.0-stub',
    type: 'game',
    executable: 'doom.wasm',
    icon: 'gamepad',
    description: 'A placeholder game engine proving the Virtual Application Runtime end-to-end.',
    memoryUsage: 32,
    cpuUsage: 8,
    display: { width: 320, height: 200 },
    permissions: ['fs:read', 'fs:write', 'input:keyboard', 'input:mouse', 'display:render'],
  };
}

export function doomStubFiles(): Record<string, Uint8Array> {
  return { 'doom.wasm': decodeStubDoomWasm() };
}

/** One-call installer: `installDoom(computer.runtime)`. */
export function installDoom(runtime: RuntimeManager): void {
  runtime.install(createDoomManifest(), doomStubFiles());
}

/** Existence-only check - the stub engine doesn't parse WAD contents, only that one was supplied. */
export function hasWad(fileProvider: RuntimeFileProvider): boolean {
  return fileProvider.exists(DOOM_WAD_RELATIVE_PATH);
}

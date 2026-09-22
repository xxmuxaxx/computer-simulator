import { describe, expect, it, vi } from 'vitest';
import { VirtualFileSystem } from '../filesystem/VirtualFileSystem';
import { createDoomEngineAdapter } from '../runtime/doom/DoomEngineAdapter';
import {
  createDoomManifest,
  DOOM_WAD_RELATIVE_PATH,
  fetchDoomEngineBytes,
  installDoom,
  installDoomFromBytes,
  isValidWadHeader,
  isValidWasmHeader,
} from '../runtime/doom/DoomRuntimeAdapter';
import { RuntimeManager } from '../runtime/RuntimeManager';
import { NotificationCenter } from '../notifications/NotificationCenter';
import { ProcessManager } from '../process/ProcessManager';
import { InstalledApplications } from '../applications/InstalledApplications';
import { decodeStubDoomWasm } from '../runtime/stub/stub-doom-bytes';
import type { EngineHost } from '../runtime/engines/types';
import { RuntimeDisplay } from '../runtime/RuntimeDisplay';
import { RuntimeFileProvider } from '../runtime/RuntimeFileProvider';
import { RuntimeInput } from '../runtime/RuntimeInput';
import type { RuntimePermission } from '../runtime/types';

/**
 * Unit tests for DoomEngineAdapter's own translation logic (WAD protocol, BGRA->RGBA conversion,
 * save games, key mapping) - deliberately without ever instantiating the real doom.wasm binary.
 * These call the adapter's import functions directly, exactly as `WebAssembly.instantiate` would,
 * against a hand-built fake `WebAssembly.Instance` (real `WebAssembly.Global`s, a real
 * `WebAssembly.Memory`) - so this suite is fully CI-safe and never needs the real, gitignored,
 * ~4.5 MB engine file on disk.
 */

const ALL_PERMISSIONS: RuntimePermission[] = ['fs:read', 'fs:write', 'input:keyboard', 'input:mouse', 'display:render'];

function makeHost(permissions: RuntimePermission[] = ALL_PERMISSIONS): { host: EngineHost; fs: VirtualFileSystem; log: ReturnType<typeof vi.fn> } {
  const fs = new VirtualFileSystem();
  fs.createDirectory('/root', { recursive: true });
  const permSet = new Set(permissions);
  const log = vi.fn();
  const host: EngineHost = {
    fileProvider: new RuntimeFileProvider(fs, '/root', permSet),
    input: new RuntimeInput(permSet),
    display: new RuntimeDisplay(2, 2, permSet),
    now: () => 12345,
    log,
  };
  return { host, fs, log };
}

const global32 = (value: number) => new WebAssembly.Global({ value: 'i32', mutable: false }, value);

function makeFakeInstance(memory: WebAssembly.Memory, overrides: Record<string, unknown> = {}): WebAssembly.Instance {
  return {
    exports: {
      memory,
      initGame: vi.fn(),
      tickGame: vi.fn(),
      reportKeyDown: vi.fn(),
      reportKeyUp: vi.fn(),
      KEY_ALT: global32(1),
      KEY_BACKSPACE: global32(2),
      KEY_DOWNARROW: global32(3),
      KEY_ENTER: global32(4),
      KEY_ESCAPE: global32(5),
      KEY_FIRE: global32(6),
      KEY_LEFTARROW: global32(7),
      KEY_RIGHTARROW: global32(8),
      KEY_SHIFT: global32(9),
      KEY_STRAFE_L: global32(10),
      KEY_STRAFE_R: global32(11),
      KEY_TAB: global32(12),
      KEY_UPARROW: global32(13),
      KEY_USE: global32(14),
      ...overrides,
    },
  } as unknown as WebAssembly.Instance;
}

describe('createDoomManifest', () => {
  it('declares the display size the real engine actually reports (640x400, not vanilla 320x200)', () => {
    // doom.wasm auto-scales its native 320x200 framebuffer 2x internally and reports 640x400 via
    // onGameInit() - confirmed against the real engine's own startup log. A mismatch here isn't
    // just cosmetic: RuntimeDisplay is sized from this before the module loads, and drawFrame()
    // copies exactly width*height*4 bytes out of the engine's real buffer each frame.
    expect(createDoomManifest().display).toEqual({ width: 640, height: 400 });
  });
});

describe('isValidWadHeader', () => {
  it('accepts real WAD magic bytes', () => {
    expect(isValidWadHeader(new Uint8Array([...new TextEncoder().encode('IWAD'), 1, 2]))).toBe(true);
    expect(isValidWadHeader(new TextEncoder().encode('PWAD'))).toBe(true);
  });

  it('rejects anything else, including short or empty buffers', () => {
    expect(isValidWadHeader(new Uint8Array(32))).toBe(false);
    expect(isValidWadHeader(new Uint8Array([73, 87, 65]))).toBe(false); // "IWA", too short
    expect(isValidWadHeader(new Uint8Array(0))).toBe(false);
  });
});

describe('isValidWasmHeader', () => {
  it('accepts the real WASM magic bytes', () => {
    expect(isValidWasmHeader(decodeStubDoomWasm())).toBe(true);
    expect(isValidWasmHeader(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 2]))).toBe(true);
  });

  it('rejects anything else, including short or empty buffers', () => {
    expect(isValidWasmHeader(new Uint8Array([73, 87, 65, 68]))).toBe(false); // "IWAD"
    expect(isValidWasmHeader(new Uint8Array([0x00, 0x61, 0x73]))).toBe(false); // too short
    expect(isValidWasmHeader(new Uint8Array(0))).toBe(false);
  });
});

describe('installDoomFromBytes', () => {
  function makeManager(): RuntimeManager {
    return new RuntimeManager({
      fileSystem: new VirtualFileSystem(),
      processManager: new ProcessManager(),
      notifications: new NotificationCenter(),
      installedApps: new InstalledApplications(),
    });
  }

  it('installs a well-formed uploaded engine binary', () => {
    const runtime = makeManager();
    expect(() => installDoomFromBytes(runtime, decodeStubDoomWasm())).not.toThrow();
    expect(runtime.registry.get('doom')?.name).toBe('DOOM');
  });

  it('refuses an upload that is not a WASM module, before ever touching the registry', () => {
    const runtime = makeManager();
    expect(() => installDoomFromBytes(runtime, new Uint8Array([1, 2, 3, 4]))).toThrowError('not a valid WebAssembly module');
    expect(runtime.registry.get('doom')).toBeUndefined();
  });
});

describe('fetchDoomEngineBytes / installDoom', () => {
  function makeManager(): RuntimeManager {
    return new RuntimeManager({
      fileSystem: new VirtualFileSystem(),
      processManager: new ProcessManager(),
      notifications: new NotificationCenter(),
      installedApps: new InstalledApplications(),
    });
  }

  function htmlResponse(): Response {
    return new Response('<!doctype html><html>...</html>', { status: 200, headers: { 'content-type': 'text/html' } });
  }

  it('accepts a real WASM response', async () => {
    const bytes = decodeStubDoomWasm();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const fetchImpl = vi.fn().mockResolvedValue(new Response(buffer, { status: 200 }));
    await expect(fetchDoomEngineBytes(fetchImpl)).resolves.toEqual(bytes);
  });

  it('rejects a 200 OK response whose body is not actually WASM (regression: a dev server\'s SPA fallback answers a missing static file with 200 + index.html instead of a 404, which was silently accepted and wrote HTML into the VFS as "doom.wasm")', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(htmlResponse());
    await expect(fetchDoomEngineBytes(fetchImpl)).rejects.toThrow('not a WASM module');
  });

  it('installDoom() surfaces the same rejection and never installs a broken package', async () => {
    const runtime = makeManager();
    const fetchImpl = vi.fn().mockResolvedValue(htmlResponse());
    await expect(installDoom(runtime, fetchImpl)).rejects.toThrow('not a WASM module');
    expect(runtime.registry.get('doom')).toBeUndefined();
  });

  it('rejects a non-ok HTTP response with a clear message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 404 }));
    await expect(fetchDoomEngineBytes(fetchImpl)).rejects.toThrow('not found (HTTP 404)');
  });
});

describe('DoomEngineAdapter', () => {
  it('exposes exactly the 10 imports across doom.wasm\'s 5 module namespaces', () => {
    const { host } = makeHost();
    const adapter = createDoomEngineAdapter(host);
    const imports = adapter.createImports();
    expect(Object.keys(imports).sort()).toEqual(['console', 'gameSaving', 'loading', 'runtimeControl', 'ui']);
    expect(Object.keys(imports.loading as object).sort()).toEqual(['onGameInit', 'readWads', 'wadSizes']);
    expect(Object.keys(imports.runtimeControl as object)).toEqual(['timeInMilliseconds']);
    expect(Object.keys(imports.ui as object)).toEqual(['drawFrame']);
    expect(Object.keys(imports.gameSaving as object).sort()).toEqual(['readSaveGame', 'sizeOfSaveGame', 'writeSaveGame']);
    expect(Object.keys(imports.console as object).sort()).toEqual(['onErrorMessage', 'onInfoMessage']);
  });

  it('leaves wadSizes untouched (defaulting to the built-in shareware WAD) when no WAD was supplied', () => {
    const { host } = makeHost();
    const memory = new WebAssembly.Memory({ initial: 2 });
    const adapter = createDoomEngineAdapter(host);
    adapter.bind(makeFakeInstance(memory), memory);
    const view = new DataView(memory.buffer);
    view.setInt32(0, 0, true);
    view.setUint32(4, 0, true);

    (adapter.createImports().loading as { wadSizes: (a: number, b: number) => void }).wadSizes(0, 4);

    expect(view.getInt32(0, true)).toBe(0);
    expect(view.getUint32(4, true)).toBe(0);
  });

  it('reports and delivers a user-supplied, well-formed WAD through wadSizes/readWads', () => {
    const { host } = makeHost();
    const wad = new Uint8Array([...new TextEncoder().encode('IWAD'), 9, 9, 9]);
    host.fileProvider.writeFile(DOOM_WAD_RELATIVE_PATH, wad);
    const memory = new WebAssembly.Memory({ initial: 2 });
    const adapter = createDoomEngineAdapter(host);
    adapter.bind(makeFakeInstance(memory), memory);
    const imports = adapter.createImports().loading as {
      wadSizes: (a: number, b: number) => void;
      readWads: (a: number, b: number) => void;
    };
    const view = new DataView(memory.buffer);

    imports.wadSizes(0, 4);
    expect(view.getInt32(0, true)).toBe(1);
    expect(view.getUint32(4, true)).toBe(wad.byteLength);

    imports.readWads(100, 8);
    expect(new Uint8Array(memory.buffer, 100, wad.byteLength)).toEqual(wad);
    expect(view.getInt32(8, true)).toBe(wad.byteLength);
  });

  it('falls back to the built-in Shareware WAD when the stored file has no valid IWAD/PWAD header (regression: a malformed WAD hung the real engine instead of failing gracefully)', () => {
    const { host, log } = makeHost();
    host.fileProvider.writeFile(DOOM_WAD_RELATIVE_PATH, new Uint8Array(32)); // no magic header
    const memory = new WebAssembly.Memory({ initial: 2 });
    const adapter = createDoomEngineAdapter(host);
    adapter.bind(makeFakeInstance(memory), memory);
    const imports = adapter.createImports().loading as { wadSizes: (a: number, b: number) => void };
    const view = new DataView(memory.buffer);
    view.setInt32(0, 0, true);
    view.setUint32(4, 0, true);

    imports.wadSizes(0, 4);

    expect(view.getInt32(0, true)).toBe(0);
    expect(view.getUint32(4, true)).toBe(0);
    expect(log).toHaveBeenCalledWith('error', expect.stringContaining('valid IWAD/PWAD header'));
  });

  it('converts doom.wasm\'s BGRA frame buffer to RGBA, forcing full alpha', () => {
    const { host } = makeHost();
    const memory = new WebAssembly.Memory({ initial: 2 });
    const adapter = createDoomEngineAdapter(host);
    adapter.bind(makeFakeInstance(memory), memory);
    // host.display is 2x2 (4 pixels); onGameInit reports the real dimensions.
    (adapter.createImports().loading as { onGameInit: (w: number, h: number) => void }).onGameInit(2, 2);

    // One BGRA pixel: B=10, G=20, R=30, A=ignored(99)
    const src = new Uint8Array(memory.buffer, 0, 4 * 4);
    src.set([10, 20, 30, 99, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    (adapter.createImports().ui as { drawFrame: (ptr: number) => void }).drawFrame(0);

    const rgba = host.display.getFrameBuffer();
    expect([rgba[0], rgba[1], rgba[2], rgba[3]]).toEqual([30, 20, 10, 255]);
  });

  it('reports the host clock as a BigInt millisecond count', () => {
    const { host } = makeHost();
    const memory = new WebAssembly.Memory({ initial: 2 });
    const adapter = createDoomEngineAdapter(host);
    adapter.bind(makeFakeInstance(memory), memory);
    const result = (adapter.createImports().runtimeControl as { timeInMilliseconds: () => bigint }).timeInMilliseconds();
    expect(result).toBe(12345n);
  });

  it('forwards info/error messages to the host log, decoded as UTF-8', () => {
    const { host, log } = makeHost();
    const memory = new WebAssembly.Memory({ initial: 2 });
    const adapter = createDoomEngineAdapter(host);
    adapter.bind(makeFakeInstance(memory), memory);
    const bytes = new TextEncoder().encode('hello doom');
    new Uint8Array(memory.buffer, 0, bytes.length).set(bytes);

    const console_ = adapter.createImports().console as { onInfoMessage: (p: number, l: number) => void; onErrorMessage: (p: number, l: number) => void };
    console_.onInfoMessage(0, bytes.length);
    console_.onErrorMessage(0, bytes.length);

    expect(log).toHaveBeenCalledWith('info', 'hello doom');
    expect(log).toHaveBeenCalledWith('error', 'hello doom');
  });

  it('round-trips a save game through the sandboxed file provider', () => {
    const { host } = makeHost();
    const memory = new WebAssembly.Memory({ initial: 2 });
    const adapter = createDoomEngineAdapter(host);
    adapter.bind(makeFakeInstance(memory), memory);
    const gameSaving = adapter.createImports().gameSaving as {
      sizeOfSaveGame: (id: number) => number;
      readSaveGame: (id: number, dest: number) => number;
      writeSaveGame: (id: number, ptr: number, length: number) => number;
    };

    expect(gameSaving.sizeOfSaveGame(0)).toBe(0);

    const payload = new Uint8Array([9, 8, 7, 6]);
    new Uint8Array(memory.buffer, 0, 4).set(payload);
    expect(gameSaving.writeSaveGame(0, 0, 4)).toBe(4);
    expect(host.fileProvider.readFile('saves/slot0.dsg')).toEqual(payload);

    expect(gameSaving.sizeOfSaveGame(0)).toBe(4);
    expect(gameSaving.readSaveGame(0, 200)).toBe(4);
    expect(new Uint8Array(memory.buffer, 200, 4)).toEqual(payload);
  });

  it('gameSaving functions fail closed (return 0) instead of throwing when fs:write is missing', () => {
    const { host } = makeHost(['fs:read', 'input:keyboard', 'input:mouse', 'display:render']);
    const memory = new WebAssembly.Memory({ initial: 2 });
    const adapter = createDoomEngineAdapter(host);
    adapter.bind(makeFakeInstance(memory), memory);
    const gameSaving = adapter.createImports().gameSaving as { writeSaveGame: (id: number, ptr: number, length: number) => number };
    expect(() => gameSaving.writeSaveGame(0, 0, 4)).not.toThrow();
    expect(gameSaving.writeSaveGame(0, 0, 4)).toBe(0);
  });

  it('init() builds the key map from exported globals and calls initGame()', () => {
    const { host } = makeHost();
    const memory = new WebAssembly.Memory({ initial: 2 });
    const adapter = createDoomEngineAdapter(host);
    const instance = makeFakeInstance(memory);
    adapter.bind(instance, memory);

    adapter.init();

    expect(instance.exports.initGame).toHaveBeenCalledTimes(1);
    adapter.handleKeyDown?.('ArrowLeft');
    expect(instance.exports.reportKeyDown).toHaveBeenCalledWith(7); // KEY_LEFTARROW
    adapter.handleKeyDown?.('1');
    expect(instance.exports.reportKeyDown).toHaveBeenCalledWith(49); // ASCII fallback
    adapter.handleKeyUp?.('Escape');
    expect(instance.exports.reportKeyUp).toHaveBeenCalledWith(5); // KEY_ESCAPE
  });

  it('init() throws ERUNTIME when the module does not export initGame', () => {
    const { host } = makeHost();
    const memory = new WebAssembly.Memory({ initial: 2 });
    const adapter = createDoomEngineAdapter(host);
    adapter.bind(makeFakeInstance(memory, { initGame: undefined }), memory);
    expect(() => adapter.init()).toThrowError('initGame');
  });

  it('tick() calls tickGame(), and preferredTickIntervalMs paces at ~35Hz', () => {
    const { host } = makeHost();
    const memory = new WebAssembly.Memory({ initial: 2 });
    const adapter = createDoomEngineAdapter(host);
    const instance = makeFakeInstance(memory);
    adapter.bind(instance, memory);
    adapter.tick(16);
    expect(instance.exports.tickGame).toHaveBeenCalledTimes(1);
    expect(adapter.preferredTickIntervalMs).toBeCloseTo(1000 / 35, 5);
  });
});

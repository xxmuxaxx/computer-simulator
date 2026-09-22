import { describe, expect, it } from 'vitest';
import { VirtualFileSystem } from '../filesystem/VirtualFileSystem';
import { instantiate, tick } from '../runtime/ApplicationRuntime';
import { createStubEngineAdapter } from '../runtime/engines/stubEngine';
import type { EngineHost } from '../runtime/engines/types';
import { RuntimeDisplay } from '../runtime/RuntimeDisplay';
import { RuntimeFileProvider } from '../runtime/RuntimeFileProvider';
import { RuntimeInput } from '../runtime/RuntimeInput';
import { decodeStubDoomWasm } from '../runtime/stub/stub-doom-bytes';
import type { RuntimePermission } from '../runtime/types';

const ALL_PERMISSIONS: RuntimePermission[] = ['fs:read', 'fs:write', 'input:keyboard', 'input:mouse', 'display:render'];

function makeHost(width: number, height: number): EngineHost {
  const permissions = new Set(ALL_PERMISSIONS);
  const fs = new VirtualFileSystem();
  fs.createDirectory('/root', { recursive: true });
  return {
    fileProvider: new RuntimeFileProvider(fs, '/root', permissions),
    input: new RuntimeInput(permissions),
    display: new RuntimeDisplay(width, height, permissions),
    now: () => 0,
    log: () => {},
  };
}

describe('the placeholder stub engine', () => {
  it('decodes to a real WASM binary with the WASM magic header', () => {
    const bytes = decodeStubDoomWasm();
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect([...bytes.slice(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]);
  });

  it('exposes nothing beyond env.get_input on the sandboxed import boundary', () => {
    const host = makeHost(4, 4);
    const adapter = createStubEngineAdapter(host);
    const importObject = adapter.createImports();
    expect(Object.keys(importObject)).toEqual(['env']);
    expect(Object.keys(importObject.env as object)).toEqual(['get_input']);
  });

  it('instantiates for real and exports memory/update/render', async () => {
    const host = makeHost(4, 4);
    const adapter = createStubEngineAdapter(host);
    const instance = await instantiate(decodeStubDoomWasm(), adapter);
    expect(instance.exports.memory).toBeInstanceOf(WebAssembly.Memory);
    expect(typeof instance.exports.update).toBe('function');
    expect(typeof instance.exports.render).toBe('function');
  });

  it('actually executes each tick: the frame buffer changes between ticks', async () => {
    const host = makeHost(4, 4);
    const adapter = createStubEngineAdapter(host);
    await instantiate(decodeStubDoomWasm(), adapter);

    tick(adapter, 0);
    const frame1 = new Uint8ClampedArray(host.display.getFrameBuffer());
    tick(adapter, 16);
    const frame2 = new Uint8ClampedArray(host.display.getFrameBuffer());

    expect(frame1).not.toEqual(frame2);
    // Alpha channel is always fully opaque.
    for (let i = 3; i < frame1.length; i += 4) {
      expect(frame1[i]).toBe(255);
      expect(frame2[i]).toBe(255);
    }
  });

  it('rejects a malformed module instead of hanging', async () => {
    const host = makeHost(4, 4);
    const adapter = createStubEngineAdapter(host);
    await expect(instantiate(new Uint8Array([1, 2, 3]), adapter)).rejects.toThrow('Failed to load WASM module');
  });

  it('grows memory to fit a frame larger than the module started with (regression: real DOOM manifest is 320x200, the module only declares 1 page)', async () => {
    const host = makeHost(320, 200);
    const adapter = createStubEngineAdapter(host);
    const instance = await instantiate(decodeStubDoomWasm(), adapter);
    const memory = instance.exports.memory as WebAssembly.Memory;
    expect(memory.buffer.byteLength).toBeLessThan(320 * 200 * 4);
    expect(() => tick(adapter, 16)).not.toThrow();
    expect(memory.buffer.byteLength).toBeGreaterThanOrEqual(320 * 200 * 4);
  });
});

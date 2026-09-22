import { describe, expect, it } from 'vitest';
import { buildImportObject, instantiate, tick } from '../runtime/ApplicationRuntime';
import { decodeStubDoomWasm } from '../runtime/stub/stub-doom-bytes';

describe('the placeholder DOOM stub engine', () => {
  it('decodes to a real WASM binary with the WASM magic header', () => {
    const bytes = decodeStubDoomWasm();
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect([...bytes.slice(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]);
  });

  it('exposes nothing beyond env.get_input on the sandboxed import boundary', () => {
    const importObject = buildImportObject({ getInput: () => 0 });
    expect(Object.keys(importObject)).toEqual(['env']);
    expect(Object.keys(importObject.env as object)).toEqual(['get_input']);
  });

  it('instantiates for real and exports memory/update/render', async () => {
    const module = await instantiate(decodeStubDoomWasm(), { getInput: () => 0 });
    const exports = module.instance.exports;
    expect(exports.memory).toBeInstanceOf(WebAssembly.Memory);
    expect(typeof exports.update).toBe('function');
    expect(typeof exports.render).toBe('function');
  });

  it('actually executes each tick: the frame buffer changes between ticks', async () => {
    const module = await instantiate(decodeStubDoomWasm(), { getInput: () => 0 });
    const width = 4;
    const height = 4;
    const frame1 = new Uint8ClampedArray(width * height * 4);
    const frame2 = new Uint8ClampedArray(width * height * 4);

    tick(module, 0, frame1, width, height);
    tick(module, 16, frame2, width, height);

    expect(frame1).not.toEqual(frame2);
    // Alpha channel is always fully opaque.
    for (let i = 3; i < frame1.length; i += 4) {
      expect(frame1[i]).toBe(255);
      expect(frame2[i]).toBe(255);
    }
  });

  it('rejects a malformed module instead of hanging', async () => {
    await expect(instantiate(new Uint8Array([1, 2, 3]), { getInput: () => 0 })).rejects.toThrow('Failed to load WASM module');
  });

  it('grows memory to fit a frame larger than the module started with (regression: real DOOM manifest is 320x200, the module only declares 1 page)', async () => {
    const module = await instantiate(decodeStubDoomWasm(), { getInput: () => 0 });
    const width = 320;
    const height = 200;
    expect(module.memory.buffer.byteLength).toBeLessThan(width * height * 4);
    const frame = new Uint8ClampedArray(width * height * 4);
    expect(() => tick(module, 16, frame, width, height)).not.toThrow();
    expect(module.memory.buffer.byteLength).toBeGreaterThanOrEqual(width * height * 4);
  });
});

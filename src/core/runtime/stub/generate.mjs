// One-off generator for the placeholder "DOOM stub" WASM module: a tiny, hand-assembled binary
// (no Emscripten/wat2wasm toolchain involved - this file IS the source, encoded directly against
// the WebAssembly binary format spec) that proves the sandboxed runtime pipeline end-to-end
// without shipping any real game code. Run with `node src/core/runtime/stub/generate.mjs` to
// regenerate stub-doom.wasm and stub-doom-bytes.ts from scratch; nothing at build/run time
// depends on this script.
//
// Module shape:
//   import  env.get_input() -> i32          (the only capability the sandbox exposes)
//   export  memory                          (1 page = 64 KiB, big enough for a 320x200 RGBA frame)
//   export  update(dtMs: i32)               advances an internal "phase" counter
//   export  render(ptr: i32, width: i32, height: i32)   writes an animated RGBA test pattern
//
// `update`/`render` are called once per frame by ApplicationRuntime.tick(); the pattern visibly
// scrolls frame to frame, which is what proves the module is really executing, not just present.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ───────────────────────────── byte-level helpers ─────────────────────────────

function uleb128(value) {
  const bytes = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);
  return bytes;
}

function sleb128(value) {
  const bytes = [];
  let v = value | 0;
  let more = true;
  while (more) {
    let byte = v & 0x7f;
    v >>= 7;
    if ((v === 0 && (byte & 0x40) === 0) || (v === -1 && (byte & 0x40) !== 0)) {
      more = false;
    } else {
      byte |= 0x80;
    }
    bytes.push(byte);
  }
  return bytes;
}

function vec(items) {
  return [...uleb128(items.length), ...items.flat()];
}

function name(str) {
  return vec([...Buffer.from(str, 'utf8')]);
}

function section(id, contentBytes) {
  return [id, ...uleb128(contentBytes.length), ...contentBytes];
}

// ───────────────────────────── instruction shorthands ─────────────────────────────

const END = 0x0b;
const op = {
  block: (blocktype) => [0x02, blocktype],
  loop: (blocktype) => [0x03, blocktype],
  end: [END],
  br: (label) => [0x0c, ...uleb128(label)],
  brIf: (label) => [0x0d, ...uleb128(label)],
  localGet: (i) => [0x20, ...uleb128(i)],
  localSet: (i) => [0x21, ...uleb128(i)],
  globalGet: (i) => [0x23, ...uleb128(i)],
  globalSet: (i) => [0x24, ...uleb128(i)],
  i32Store8: (offset) => [0x3a, 0x00, ...uleb128(offset)],
  i32Const: (v) => [0x41, ...sleb128(v)],
  i32GeU: [0x4f],
  i32Add: [0x6a],
  i32Sub: [0x6b],
  i32Mul: [0x6c],
  i32RemU: [0x70],
  i32And: [0x71],
};

const VOID_BLOCK = 0x40;
const I32 = 0x7f;

// ───────────────────────────── type section ─────────────────────────────
// type 0: (i32) -> ()                 update(dtMs)
// type 1: (i32, i32, i32) -> ()       render(ptr, width, height)
// type 2: () -> (i32)                 get_input()

const FUNC_TYPE = 0x60;
const types = [
  [FUNC_TYPE, ...vec([[I32]]), ...vec([])],
  [FUNC_TYPE, ...vec([[I32], [I32], [I32]]), ...vec([])],
  [FUNC_TYPE, ...vec([]), ...vec([[I32]])],
];

// ───────────────────────────── import section ─────────────────────────────
// func index 0 = env.get_input, type 2

const imports = [[...name('env'), ...name('get_input'), 0x00, ...uleb128(2)]];

// ───────────────────────────── function section ─────────────────────────────
// func index 1 = update (type 0), func index 2 = render (type 1)

const functions = [uleb128(0), uleb128(1)];

// ───────────────────────────── memory section ─────────────────────────────
// 1 memory, min 1 page (64 KiB), no max

const memories = [[0x00, ...uleb128(1)]];

// ───────────────────────────── global section ─────────────────────────────
// global 0: mutable i32 "phase", initialised to 0

const globals = [[I32, 0x01, ...op.i32Const(0), ...op.end]];

// ───────────────────────────── export section ─────────────────────────────

const exports = [
  [...name('memory'), 0x02, ...uleb128(0)],
  [...name('update'), 0x00, ...uleb128(1)],
  [...name('render'), 0x00, ...uleb128(2)],
];

// ───────────────────────────── code section ─────────────────────────────

// update(dtMs): phase = (phase + dtMs) mod 1_000_000
const updateBody = [
  ...op.globalGet(0),
  ...op.localGet(0),
  ...op.i32Add,
  ...op.i32Const(1_000_000),
  ...op.i32RemU,
  ...op.globalSet(0),
  ...op.end,
];
const updateFunc = [...vec([]) /* no extra locals */, ...updateBody];

// render(ptr, width, height): flood-fill an animated RGBA pattern derived from pixel index + phase.
// locals: 0=ptr 1=width 2=height (params), 3=total 4=i 5=addr
const PTR = 0, WIDTH = 1, HEIGHT = 2, TOTAL = 3, I = 4, ADDR = 5;
const renderBody = [
  // total = width * height
  ...op.localGet(WIDTH),
  ...op.localGet(HEIGHT),
  ...op.i32Mul,
  ...op.localSet(TOTAL),
  // i = 0
  ...op.i32Const(0),
  ...op.localSet(I),
  ...op.block(VOID_BLOCK),
  ...op.loop(VOID_BLOCK),
  // if (i >= total) break
  ...op.localGet(I),
  ...op.localGet(TOTAL),
  ...op.i32GeU,
  ...op.brIf(1),
  // addr = ptr + i * 4
  ...op.localGet(PTR),
  ...op.localGet(I),
  ...op.i32Const(4),
  ...op.i32Mul,
  ...op.i32Add,
  ...op.localSet(ADDR),
  // R = (i + phase) & 0xFF
  ...op.localGet(ADDR),
  ...op.localGet(I),
  ...op.globalGet(0),
  ...op.i32Add,
  ...op.i32Const(0xff),
  ...op.i32And,
  ...op.i32Store8(0),
  // G = (i * 3 + phase * 2) & 0xFF
  ...op.localGet(ADDR),
  ...op.localGet(I),
  ...op.i32Const(3),
  ...op.i32Mul,
  ...op.globalGet(0),
  ...op.i32Const(2),
  ...op.i32Mul,
  ...op.i32Add,
  ...op.i32Const(0xff),
  ...op.i32And,
  ...op.i32Store8(1),
  // B = (phase * 5 - i) & 0xFF
  ...op.localGet(ADDR),
  ...op.globalGet(0),
  ...op.i32Const(5),
  ...op.i32Mul,
  ...op.localGet(I),
  ...op.i32Sub,
  ...op.i32Const(0xff),
  ...op.i32And,
  ...op.i32Store8(2),
  // A = 255
  ...op.localGet(ADDR),
  ...op.i32Const(255),
  ...op.i32Store8(3),
  // i += 1
  ...op.localGet(I),
  ...op.i32Const(1),
  ...op.i32Add,
  ...op.localSet(I),
  ...op.br(0),
  ...op.end, // loop
  ...op.end, // block
  ...op.end, // function
];
const renderFunc = [...vec([[3, I32]]) /* 3 extra i32 locals: total, i, addr */, ...renderBody];

function codeEntry(bodyBytes) {
  return [...uleb128(bodyBytes.length), ...bodyBytes];
}

const code = [codeEntry(updateFunc), codeEntry(renderFunc)];

// ───────────────────────────── assemble the module ─────────────────────────────

const MAGIC = [0x00, 0x61, 0x73, 0x6d];
const VERSION = [0x01, 0x00, 0x00, 0x00];

const module = [
  ...MAGIC,
  ...VERSION,
  ...section(1, vec(types)),
  ...section(2, vec(imports)),
  ...section(3, vec(functions)),
  ...section(5, vec(memories)),
  ...section(6, vec(globals)),
  ...section(7, vec(exports)),
  ...section(10, vec(code)),
];

const bytes = Uint8Array.from(module);

// ───────────────────────────── self-check ─────────────────────────────

const { instance } = await WebAssembly.instantiate(bytes, { env: { get_input: () => 0 } });
const memory = instance.exports.memory;
const view = new Uint8Array(memory.buffer);
instance.exports.render(0, 4, 4);
const frame1 = view.slice(0, 4 * 4 * 4).join(',');
instance.exports.update(16);
instance.exports.render(0, 4, 4);
const frame2 = view.slice(0, 4 * 4 * 4).join(',');
if (frame1 === frame2) throw new Error('self-check failed: frame did not change after update()');
console.log('self-check OK: %d bytes, frame changes between ticks', bytes.byteLength);
console.log('imports exposed: env.%s', Object.keys({ get_input: 0 }).join(', env.'));

// ───────────────────────────── write outputs ─────────────────────────────

writeFileSync(join(__dirname, 'stub-doom.wasm'), bytes);

const base64 = Buffer.from(bytes).toString('base64');
const ts = `// Generated by generate.mjs - do not edit by hand. Run \`node src/core/runtime/stub/generate.mjs\` to regenerate.
/** The compiled stub-doom.wasm module, base64-encoded so RuntimeRegistry can write it into the
 * VirtualFileSystem synchronously at install time without a network fetch. */
export const STUB_DOOM_WASM_BASE64 = '${base64}';

export function decodeStubDoomWasm(): Uint8Array {
  const binary = atob(STUB_DOOM_WASM_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
`;
writeFileSync(join(__dirname, 'stub-doom-bytes.ts'), ts);
console.log('wrote stub-doom.wasm and stub-doom-bytes.ts');

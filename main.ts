// Runs tiny stack ISA v1 programs from the input directory and writes
// stdout.bin and exit.txt to the output directory for each instance.
// Limits: 256 data stack values, 64 call stack entries, 256 memory words,
// 1,000,000 steps, and 65,536 output bytes.
// Traps: 2 underflow, 3 overflow, 4 divide-by-zero, 5 opcode, 6 address,
// 7 call-overflow, 8 return-underflow, 9 bounds, 10 timeout, 11 output-limit.

function run(program, input) {
  const stack = new Int32Array(256);
  const returns = new Uint16Array(64);
  const memory = new Int32Array(256);
  const output = Buffer.allocUnsafe(65536);
  let pc = 0, sp = 0, rp = 0, read = 0, written = 0;
  let code = 0;

  execute: for (let steps = 0; ; steps++) {
    if (steps === 1000000) { code = 10; break; }
    if (pc < 0 || pc >= program.length) { code = 9; break; }

    const op = program[pc++];
    const spec = specs[op];
    if (!spec) { code = 5; break; }
    const size = spec >> 5;
    const next = pc + size;
    if (next > program.length) { code = 9; break; }
    const pops = (spec >> 3) & 3;
    const pushes = (spec >> 1) & 3;
    if (sp < pops) { code = 2; break; }
    const base = sp - pops;
    if (base + pushes > 256) { code = 3; break; }

    const a = pops ? stack[base] : 0;
    const b = pops >= 2 ? stack[base + 1] : 0;
    let result;
    switch (op) {
      case 0x00: break execute;
      case 0x01: result = (program[pc] << 24) >> 24; break;
      case 0x02: result = program.readInt32LE(pc); break;
      case 0x03: break;
      case 0x04: stack[base + 1] = a; break;
      case 0x05:
        stack[base] = b;
        stack[base + 1] = a;
        break;
      case 0x06: stack[base + 2] = a; break;
      case 0x07:
        stack[base] = b;
        stack[base + 1] = stack[base + 2];
        stack[base + 2] = a;
        break;
      case 0x10: result = a + b; break;
      case 0x11: result = a - b; break;
      case 0x12: result = Math.imul(a, b); break;
      case 0x13:
        if (b === 0) { code = 4; break execute; }
        result = a / b;
        break;
      case 0x14:
        if (b === 0) { code = 4; break execute; }
        result = a % b;
        break;
      case 0x15:
        if (b === 0) { code = 4; break execute; }
        result = (a >>> 0) / (b >>> 0);
        break;
      case 0x16:
        if (b === 0) { code = 4; break execute; }
        result = (a >>> 0) % (b >>> 0);
        break;
      case 0x17: result = -a; break;
      case 0x18: result = a & b; break;
      case 0x19: result = a | b; break;
      case 0x1a: result = a ^ b; break;
      case 0x1b: result = ~a; break;
      case 0x1c: result = a << b; break;
      case 0x1d: result = a >> b; break;
      case 0x1e: result = a >>> b; break;
      case 0x20: result = Number(a === b); break;
      case 0x21: result = Number(a < b); break;
      case 0x22: result = Number((a >>> 0) < (b >>> 0)); break;
      case 0x30:
      case 0x31:
      case 0x32:
        if (op === 0x30 || (a === 0) === (op === 0x31)) {
          pc = next + program.readInt16LE(pc);
          sp = base;
          continue;
        }
        break;
      case 0x33:
        if (rp === 64) { code = 7; break execute; }
        returns[rp++] = next;
        pc = program.readUInt16LE(pc);
        continue;
      case 0x34:
        if (rp === 0) { code = 8; break execute; }
        pc = returns[--rp];
        continue;
      case 0x40:
        if ((a >>> 0) > 255) { code = 6; break execute; }
        result = memory[a];
        break;
      case 0x41:
        if ((b >>> 0) > 255) { code = 6; break execute; }
        memory[b] = a;
        break;
      case 0x50: {
        const decimal = String(a);
        if (written + decimal.length > output.length) {
          code = 11;
          break execute;
        }
        for (let i = 0; i < decimal.length; i++) {
          output[written++] = decimal.charCodeAt(i);
        }
        break;
      }
      case 0x51:
        if (written === output.length) { code = 11; break execute; }
        output[written++] = a & 255;
        break;
      case 0x52: result = read < input.length ? input[read++] : -1; break;
      case 0x53: code = a & 255; break execute;
    }
    // Int32Array assignment truncates quotients and wraps results.
    if (result !== undefined) stack[base] = result;
    sp = base + pushes;
    pc = next;
  }

  return { code, stdout: output.subarray(0, written) };
}

// Each byte encodes immediate length, pop count, push count, and validity.
const specs = new Uint8Array(256);
function define(pops, pushes, size, ...ops) {
  for (const op of ops) specs[op] = (size << 5) | (pops << 3) | (pushes << 1) | 1;
}
define(0, 0, 0, 0x00, 0x34);
define(0, 0, 2, 0x30, 0x33);
define(0, 1, 0, 0x52);
define(0, 1, 1, 0x01);
define(0, 1, 4, 0x02);
define(1, 0, 0, 0x03, 0x50, 0x51, 0x53);
define(1, 0, 2, 0x31, 0x32);
define(1, 1, 0, 0x17, 0x1b, 0x40);
define(1, 2, 0, 0x04);
define(2, 0, 0, 0x41);
define(2, 1, 0, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x18, 0x19,
  0x1a, 0x1c, 0x1d, 0x1e, 0x20, 0x21, 0x22);
define(2, 2, 0, 0x05);
define(2, 3, 0, 0x06);
define(3, 3, 0, 0x07);

const { mkdirSync, readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const ids = readdirSync(inputDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort();

for (const id of ids) {
  const source = join(inputDir, id);
  const destination = join(outputDir, id);
  const program = readFileSync(join(source, 'program.bin'));
  const input = readFileSync(join(source, 'input.bin'));
  const { code, stdout } = run(program, input);
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(destination, 'stdout.bin'), stdout);
  writeFileSync(join(destination, 'exit.txt'), code + '\n');
}

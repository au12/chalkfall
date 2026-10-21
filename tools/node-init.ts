// Loads the physics WebAssembly in Node (tools and tests).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initPhysics } from '../src/physics/box2d.ts';

export async function initNodePhysics(): Promise<void> {
  const p = fileURLToPath(new URL('../src/physics/wasm/box2d.wasm', import.meta.url));
  await initPhysics({ wasmBinary: readFileSync(p) });
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

// Drift gate for the no-build sim page: its embedded palette must equal DESIGN's tokens.json
// (agent/design-system, D-17). Reads the file straight from that branch — no merge or build needed.
const src = await readFile(new URL('../web/sim.js', import.meta.url), 'utf-8');
const m = src.match(/export const EMBEDDED_TOKENS = (\{[\s\S]*?\n\});/);
const embedded = new Function(`return ${m[1]}`)();

test('embedded sim tokens match agent/design-system packages/ui/tokens.json', (t) => {
  let json;
  try { json = execFileSync('git', ['show', 'agent/design-system:packages/ui/tokens.json'], { encoding: 'utf-8' }); }
  catch { t.skip('agent/design-system branch not available in this checkout'); return; }
  const design = JSON.parse(json);
  assert.deepEqual(embedded.sim, design.sim);
  assert.deepEqual(embedded.dusk, design.palette.dusk);
  assert.equal(design.sim.nodeUnit, design.palette.sky['300'], 'D-16: units are sky-300');
  assert.notEqual(design.sim.nodeUnit, design.palette.verdant['300'], 'verdant is reserved for human-verified');
});

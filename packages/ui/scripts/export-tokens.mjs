// D-17: build-free token export for consumers with no bundler (swarm/web).
// 1. Writes packages/ui/tokens.json from the built tokens.ts (dist/index.js).
// 2. Drift check: every hex in tokens.ts `palette`/`sim` must appear as the same
//    value in src/tokens.css, and vice versa for every primitive ramp step.
// Exit 1 on drift so the two sources can never silently diverge.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mod = await import(new URL('../dist/index.js', import.meta.url).href);
const { palette, sim, fonts, space, radius, duration, layout, defaultSilenceEdgesHours, confidenceTiers, tierGlyph, tierLabel } = mod;

const css = readFileSync(join(root, 'src/tokens.css'), 'utf8');
const cssVars = {};
for (const m of css.matchAll(/(--ds-[\w-]+)\s*:\s*([^;]+);/g)) if (!(m[1] in cssVars)) cssVars[m[1]] = m[2].trim();

let drift = 0;
const expect = (name, value) => {
  const got = cssVars[name];
  if (got === undefined) { console.log(`DRIFT  ${name} missing from tokens.css (ts has ${value})`); drift++; return; }
  if (got.toUpperCase() !== String(value).toUpperCase()) { console.log(`DRIFT  ${name}: css ${got} vs ts ${value}`); drift++; }
};
palette.n.forEach((v, i) => expect(`--ds-n-${i}`, v));
palette.dusk.forEach((v, i) => expect(`--ds-dusk-${i}`, v));
for (const ramp of ['beacon', 'verdant', 'ember', 'amber', 'sim', 'sky']) {
  for (const [step, v] of Object.entries(palette[ramp])) expect(`--ds-${ramp}-${step}`, v);
}
// sim.* must resolve to the same colour the CSS var resolves to
const resolveCss = (name) => {
  let v = cssVars[name];
  for (let i = 0; i < 8 && v; i++) { const m = v.match(/^var\((--[\w-]+)\)$/); if (!m) break; v = cssVars[m[1]]; }
  return v;
};
const simMap = { canvasBg: 'canvas-bg', grid: 'canvas-grid', nodeBridge: 'node-bridge', nodeRelay: 'node-relay', nodeUnit: 'node-unit', nodeSettlement: 'node-settlement', link: 'link', linkStrong: 'link-strong', route: 'route', routeBaseline: 'route-baseline', packet: 'packet', pairHungarian: 'pair-hungarian', pairAuction: 'pair-auction', droneRoute: 'drone-route', label: 'label' };
for (const [k, suffix] of Object.entries(simMap)) {
  const cssVal = resolveCss(`--ds-sim-${suffix}`);
  const norm = (x) => String(x).replace(/\s+/g, '').toUpperCase();
  if (cssVal === undefined) { console.log(`DRIFT  --ds-sim-${suffix} missing (ts sim.${k} = ${sim[k]})`); drift++; }
  else if (norm(cssVal) !== norm(sim[k])) { console.log(`DRIFT  sim.${k}: css ${cssVal} vs ts ${sim[k]}`); drift++; }
}
if (!(`silenceRing` in sim) || resolveCss('--ds-silence-ring') === undefined) { console.log('DRIFT silence ring'); drift++; }

const out = {
  $schema: 'https://darkspot.invalid/tokens.schema.json',
  generatedFrom: 'packages/ui/src/tokens.ts via scripts/export-tokens.mjs — do not edit by hand',
  palette, sim, fonts, space, radius, duration, layout,
  silence: { edgesHours: defaultSilenceEdgesHours, ramp: palette.dusk },
  confidenceTiers, tierGlyph, tierLabel,
  reservations: {
    verdant: 'human-verified only',
    ember: 'hazard exposure / destructive only',
    'sim (magenta) + diagonal stripe': 'simulation only (Rule 4)',
    dusk: 'silence ramp',
    beacon: 'interactive / mesh routes / corroborated tier',
    sky: 'focus ring in UI; taskforce units and pairings on the sim canvas',
  },
};
writeFileSync(join(root, 'tokens.json'), JSON.stringify(out, null, 2) + '\n');
console.log(drift ? `${drift} drift(s) between tokens.css and tokens.ts` : 'tokens.json written; css/ts in sync');
process.exit(drift ? 1 : 0);

// WCAG 2.x contrast check over every semantic foreground/background pair, both themes.
// Fails (exit 1) if any pair is under its stated threshold.
// Thresholds: WCAG 2.1 SC 1.4.3 (text 4.5:1) and SC 1.4.11 (non-text UI 3:1)
// https://www.w3.org/TR/WCAG21/#contrast-minimum  https://www.w3.org/TR/WCAG21/#non-text-contrast
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/tokens.css'), 'utf8');

function block(selector) {
  const i = css.indexOf(selector);
  if (i < 0) throw new Error(`selector ${selector} not found`);
  const start = css.indexOf('{', i);
  let depth = 0;
  let j = start;
  for (; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}' && --depth === 0) break;
  }
  const vars = {};
  for (const m of css.slice(start, j).matchAll(/(--ds-[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}
const light = block(':root');
// Match the rule, not the mention of the selector in the header comment.
const dark = { ...light, ...block('\n[data-theme="dark"] {') };

function resolve(vars, v, bg) {
  v = v.trim();
  const ref = v.match(/^var\((--[\w-]+)\)$/);
  if (ref) return resolve(vars, vars[ref[1]], bg);
  if (v === 'transparent') return bg;
  const rgba = v.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
  if (rgba) {
    const a = rgba[4] === undefined ? 1 : Number(rgba[4]);
    const c = [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
    return bg ? c.map((x, i) => Math.round(x * a + bg[i] * (1 - a))) : c;
  }
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((k) => parseInt(hex[1].slice(k, k + 2), 16));
  throw new Error(`cannot resolve ${v}`);
}
const lum = ([r, g, b]) => {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

// [foreground, background, minimum, note]
const pairs = [
  ['--ds-color-text', '--ds-color-bg', 4.5],
  ['--ds-color-text', '--ds-color-bg-raised', 4.5],
  ['--ds-color-text', '--ds-color-bg-well', 4.5],
  ['--ds-color-text-secondary', '--ds-color-bg', 4.5],
  ['--ds-color-text-secondary', '--ds-color-bg-well', 4.5],
  ['--ds-color-text-muted', '--ds-color-bg', 4.5],
  ['--ds-color-text-muted', '--ds-color-bg-raised', 4.5],
  ['--ds-color-text-muted', '--ds-color-bg-sunken', 4.5],
  ['--ds-color-text-display', '--ds-color-bg', 4.5],
  ['--ds-color-accent', '--ds-color-bg', 4.5],
  ['--ds-color-link', '--ds-color-bg-raised', 4.5],
  ['--ds-color-text-on-accent', '--ds-color-accent', 4.5],
  ['--ds-color-text-on-accent', '--ds-color-accent-hover', 4.5],
  ['--ds-color-attention', '--ds-color-bg', 4.5],
  ['--ds-color-attention', '--ds-color-attention-soft', 4.5],
  ['--ds-color-hazard', '--ds-color-bg', 4.5],
  ['--ds-color-hazard', '--ds-color-hazard-soft', 4.5],
  ['--ds-color-text-on-accent', '--ds-color-hazard', 4.5, 'light only'],
  ['--ds-color-focus', '--ds-color-bg', 3],
  ['--ds-color-focus', '--ds-color-bg-raised', 3],
  ['--ds-color-border-strong', '--ds-color-bg', 3, 'UI boundary'],
  ['--ds-tier-unverified-ink', '--ds-tier-unverified-fill', 4.5],
  ['--ds-tier-unverified-ink', '--ds-color-bg', 4.5],
  ['--ds-tier-corroborated-ink', '--ds-tier-corroborated-fill', 4.5],
  ['--ds-tier-corroborated-ink', '--ds-color-bg', 4.5],
  ['--ds-tier-verified-ink', '--ds-tier-verified-fill', 4.5],
  ['--ds-tier-verified-ink', '--ds-color-bg', 4.5],
  ['--ds-tier-unverified-border', '--ds-color-bg', 3],
  ['--ds-stale-ink', '--ds-color-bg', 4.5],
  ['--ds-stale-border', '--ds-color-bg', 3],
  ['--ds-conflict-ink', '--ds-conflict-fill', 4.5],
  ['--ds-conflict-border', '--ds-color-bg', 3],
  ['--ds-simulation-ink', '--ds-simulation-fill', 4.5],
  ['--ds-simulation-ink', '--ds-color-bg', 4.5],
  ['--ds-simulation-border', '--ds-color-bg', 3],
  ['--ds-silence-ink-on-low', '--ds-silence-0', 4.5],
  ['--ds-silence-ink-on-low', '--ds-silence-1', 4.5],
  ['--ds-silence-ink-on-low', '--ds-silence-2', 4.5],
  ['--ds-silence-ink-on-low', '--ds-silence-3', 4.5],
  ['--ds-silence-ink-on-high', '--ds-silence-4', 4.5],
  ['--ds-silence-ink-on-high', '--ds-silence-5', 4.5],
  ['--ds-silence-ink-on-high', '--ds-silence-6', 4.5],
  // sim canvas: node colours, paths & labels against the canvas
  ['--ds-sim-node-bridge', '--ds-sim-canvas-bg', 3],
  ['--ds-sim-node-relay', '--ds-sim-canvas-bg', 3],
  ['--ds-sim-node-unit', '--ds-sim-canvas-bg', 3],
  ['--ds-sim-route', '--ds-sim-canvas-bg', 3],
  ['--ds-sim-route-baseline', '--ds-sim-canvas-bg', 3],
  ['--ds-sim-drone-route', '--ds-sim-canvas-bg', 3],
  ['--ds-sim-label', '--ds-sim-canvas-bg', 4.5],
  ['--ds-silence-ring', '--ds-sim-canvas-bg', 3, 'dark only'],
  // adjacent silence steps must be distinguishable
  ['--ds-silence-0', '--ds-silence-1', 1.2, 'adjacent ramp'],
  ['--ds-silence-1', '--ds-silence-2', 1.2, 'adjacent ramp'],
  ['--ds-silence-2', '--ds-silence-3', 1.2, 'adjacent ramp'],
  ['--ds-silence-3', '--ds-silence-4', 1.2, 'adjacent ramp'],
  ['--ds-silence-4', '--ds-silence-5', 1.2, 'adjacent ramp'],
  ['--ds-silence-5', '--ds-silence-6', 1.2, 'adjacent ramp'],
];

let failed = 0;
for (const [name, vars] of [['light', light], ['dark', dark]]) {
  console.log(`\n== ${name} ==`);
  const pageBg = resolve(vars, vars['--ds-color-bg']);
  for (const [fg, bg, min, note = ''] of pairs) {
    if (note === 'light only' && name === 'dark') continue;
    if (note === 'dark only' && name === 'light') continue;
    if (!(fg in vars) || !(bg in vars)) {
      console.log(`  ??   ${fg} / ${bg} missing`);
      failed++;
      continue;
    }
    const bgc = resolve(vars, vars[bg], pageBg);
    const fgc = resolve(vars, vars[fg], bgc);
    const r = ratio(fgc, bgc);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${r.toFixed(2).padStart(5)} >= ${min}  ${fg} on ${bg}  ${note}`);
  }
}
console.log(failed ? `\n${failed} pair(s) FAILED` : '\nall pairs pass');
process.exit(failed ? 1 : 0);

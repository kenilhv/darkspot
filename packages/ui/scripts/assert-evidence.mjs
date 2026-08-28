// Server-render assertions for the evidence primitives: structure, carriers, a11y basics.
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import { ConfidenceTierBadge, SimulationLabel, StaleMarker, SilenceSwatch, SilenceLegend, silenceStep, formatHours } from '../dist/index.js';
import assert from 'node:assert/strict';

const html = (el) => renderToStaticMarkup(el);
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('tier: three carriers (glyph, label, token class) for every tier', () => {
  for (const [tier, glyph, cls] of [['unverified-single-source', '○', 'unverified'], ['corroborated-multi-source', '◐', 'corroborated'], ['human-verified', '●', 'verified']]) {
    const s = html(h(ConfidenceTierBadge, { tier, count: 3, verifiedBy: 'A. Rai' }));
    assert.match(s, new RegExp(`ds-tier--${cls}`));
    assert.ok(s.includes(glyph), `glyph ${glyph}`);
    assert.ok(s.includes('aria-hidden="true"'), 'glyph hidden from AT');
    assert.match(s, /ds-tier__label/);
  }
});
t('tier: count is device count, verified shows reviewer (Rule 2 attributability)', () => {
  assert.ok(html(h(ConfidenceTierBadge, { tier: 'corroborated-multi-source', count: 4 })).includes('4 devices'));
  assert.ok(html(h(ConfidenceTierBadge, { tier: 'unverified-single-source', count: 1 })).includes('1 device'));
  assert.ok(html(h(ConfidenceTierBadge, { tier: 'human-verified', verifiedBy: 'A. Rai' })).includes('by A. Rai'));
});
t('simulation: literal word present, role=note, stripe class (Rule 4)', () => {
  for (const block of [false, true]) {
    const s = html(h(SimulationLabel, { block }, 'x'));
    assert.match(s, /Simulation/);
    assert.match(s, /role="note"/);
    assert.match(s, block ? /ds-sim--block/ : /ds-sim--inline/);
  }
});
t('stale: says unknown + needs re-verification, dashed class', () => {
  const s = html(h(StaleMarker, { since: '11:40' }));
  assert.match(s, /Unknown/); assert.match(s, /re-verification/); assert.match(s, /since 11:40/); assert.match(s, /ds-stale/);
});
t('silence: shows raw hours next to colour; null → stale', () => {
  const s = html(h(SilenceSwatch, { hours: 9, step: silenceStep(9) }));
  assert.match(s, /9 h/); assert.match(s, /--ds-silence-3/); assert.match(s, /ink-low/);
  assert.match(html(h(SilenceSwatch, { hours: 30, step: silenceStep(30) })), /ink-high/);
  assert.match(html(h(SilenceSwatch, { hours: null, step: null })), /ds-stale/);
});
t('silenceStep buckets against default edges 1/3/6/12/24/48', () => {
  assert.deepEqual([0.5, 1, 2.9, 3, 6, 12, 24, 48, 500].map((x) => silenceStep(x)), [0, 1, 1, 2, 3, 4, 5, 6, 6]);
  assert.equal(silenceStep(null), null);
});
t('formatHours', () => {
  assert.equal(formatHours(0.5), '30 min'); assert.equal(formatHours(2), '2 h'); assert.equal(formatHours(72), '3 d'); assert.equal(formatHours(75), '3 d 3 h');
});
t('legend: 7 steps + unknown, labelled group, non-score note', () => {
  const s = html(h(SilenceLegend, {}));
  assert.equal((s.match(/ds-silence-legend__step"/g) || []).length, 8);
  assert.match(s, /role="group" aria-label="Time since any confirmation"/);
  assert.match(s, /not a risk score/);
  assert.match(s, /≥ 2 d/);
});
t('no imperative vocabulary anywhere in rendered output (Rule 1)', () => {
  const all = [h(ConfidenceTierBadge, { tier: 'human-verified' }), h(SimulationLabel, {}), h(StaleMarker, {}), h(SilenceLegend, {})].map(html).join(' ');
  assert.doesNotMatch(all, /\b(dispatch|send|go to|assign|deploy)\b/i);
});
console.log(`\n${n} assertions groups passed`);

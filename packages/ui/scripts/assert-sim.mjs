// Server-render assertions for the swarm sim frame.
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import assert from 'node:assert/strict';
import { SimFrame, SimLegend, SimControls, SimStat, SimAllocationReadout, simNodeKinds } from '../dist/index.js';

const html = (el) => renderToStaticMarkup(el);
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('frame: simulation banner present, dark theme, named canvas region, live description', () => {
  const s = html(h(SimFrame, { title: 'T', canvasDescription: 'd', simulationNote: '' }, h('svg')));
  assert.match(s, /ds-sim--block/);
  assert.match(s, /Simulation/);
  assert.match(s, /data-theme="dark"/);
  assert.match(s, /role="region" aria-label="T — simulation canvas"/);
  assert.match(s, /aria-live="polite">d</);
});
t('legend: every node kind has an SVG shape (not colour-only) and a label; drone route dashed + SIMULATION', () => {
  const s = html(h(SimLegend, {}));
  assert.match(s, /<rect/);
  assert.match(s, /<polygon/);
  assert.match(s, /<circle/);
  for (const k of simNodeKinds) assert.match(s, new RegExp('--ds-sim-node-' + k));
  assert.match(s, /stroke-dasharray="6 4"/);
  assert.match(s, /stroke-dasharray="3 3"/, 'auction pairing dashed');
  assert.match(s, /--ds-sim-pair-hungarian/);
  assert.doesNotMatch(s, /verdant/);
  assert.match(s, /SIMULATION/);
  assert.match(s, /AODV baseline/);
  assert.match(s, /AntHocNet/);
});
t('controls: toolbar, aria-pressed on run, step disabled while running, speed labelled', () => {
  const p = { running: true, onRun() {}, onPause() {}, onStep() {}, onReset() {}, speed: 1, onSpeed() {}, tick: 7 };
  const s = html(h(SimControls, p));
  assert.match(s, /role="toolbar"/);
  assert.match(s, /aria-pressed="true"/);
  assert.match(s, /Pause/);
  assert.match(s, /disabled=""[^>]*>Step</);
  assert.match(s, /tick 7/);
  assert.match(s, /aria-label="Ticks per second"/);
  assert.match(html(h(SimControls, { ...p, running: false })), /aria-pressed="false"[^>]*>Run/);
});
t('allocation readout: both modes side by side; idle, cost and rounds rendered', () => {
  const modes = [
    { component: 0, mode: 'hungarian', units: 3, tasks: 4, cost: 12.4 },
    { component: 2, mode: 'auction', units: 2, tasks: 2, cost: 7.1, rounds: 2 },
    { component: 3, mode: 'auction', units: 1, tasks: 0, idle: true },
  ];
  const NOTE = 'Suggested unit/task pairings from a simulation. Not a dispatch order; requires human review before any action.';
  const s = html(h(SimAllocationReadout, { modes, unitsWithoutCommand: 3, note: NOTE, pairings: [{ unitId: 'u1', taskId: 't1', cost: 1, mode: 'auction' }] }));
  assert.ok(s.includes(NOTE), 'note verbatim');
  assert.ok(s.indexOf(NOTE) < s.indexOf('u1'), 'note precedes pairings');
  assert.match(s, /ds-simalloc__pair--auction/);
  assert.ok(html(h(SimAllocationReadout, { modes: [], note: '   ' })).includes('Not a dispatch order'), 'blank note falls back to the canonical note');
  assert.match(s, /Hungarian · connected to command/);
  assert.match(s, /Local auction · no path to command/);
  assert.match(s, /1 component</);
  assert.match(s, /2 components</);
  assert.match(s, /2 rounds/);
  assert.match(s, /idle/);
  assert.match(s, /cost 12\.4/);
  assert.match(s, /3 units without a path to command/);
});
t('stat: label, value and tone class', () => {
  const s = html(h(SimStat, { label: 'Links cut', value: 1, tone: 'hazard' }));
  assert.match(s, /ds-simstat--hazard/);
  assert.match(s, /Links cut/);
});
t('no imperative vocabulary in any rendered text (Rule 1)', () => {
  const all = [h(SimLegend, {}), h(SimAllocationReadout, { modes: [], note: 'n' }), h(SimFrame, { title: 'x', canvasDescription: 'y' }, 'c')].map(html).join(' ');
  assert.doesNotMatch(all, /\b(dispatch|send|go to|assign(ed)?|deploy|proceed to)\b/i);
});
console.log('\n' + n + ' assertion groups passed');

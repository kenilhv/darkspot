// Server-render assertions for the coordinator primitives (RawReport, SettlementCard, StatusChip).
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import assert from 'node:assert/strict';
import { RawReport, SettlementCard, StatusChip, RAW_WITHHELD_TEXT } from '../dist/index.js';

const html = (el) => renderToStaticMarkup(el);
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

const base = { id: 'e-42', receivedAt: '2026-08-27T09:14:00Z', devicePubkey: 'ab12cd34ef56', hopCount: 3, extractionModel: 'm', extractionConfidence: 0.82 };

t('raw report: original text verbatim beside extracted status', () => {
  const s = html(h(RawReport, { ...base, extractedStatus: 'needs_help', rawText: 'bridge gone, 12 families on the ridge <b>x</b>' }));
  assert.match(s, /Original report/);
  assert.match(s, /bridge gone, 12 families on the ridge &lt;b&gt;x&lt;\/b&gt;/, 'verbatim, escaped');
  assert.match(s, /Reported needing help/);
  assert.match(s, /device ab12cd34…/);
  assert.match(s, /3 hops/);
  assert.match(s, /m · 82%/);
  assert.match(s, /dateTime="2026-08-27T09:14:00Z"/);
});
t('raw report: casualty status withholds raw text for unauthorized viewers (Rule 2)', () => {
  const raw = 'two hurt at the school';
  const s = html(h(RawReport, { ...base, extractedStatus: 'casualties', rawText: raw }));
  assert.ok(!s.includes(raw), 'raw text must not appear');
  assert.ok(!s.includes('82%'), 'model confidence not leaked either');
  assert.match(s, /ds-report--withheld/);
  assert.ok(s.includes(RAW_WITHHELD_TEXT.replace('§', '§')));
  assert.match(s, /Restricted · casualty-related/);
  const a = html(h(RawReport, { ...base, extractedStatus: 'casualties', rawText: raw, authorized: true }));
  assert.ok(a.includes(raw), 'authorized viewer sees it');
});
t('status chip: unknown strings fall back to unknown, never invent a status', () => {
  assert.match(html(h(StatusChip, { status: 'garbage' })), /data-status="unknown"/);
  assert.match(html(h(StatusChip, { status: 'safe' })), /Reported safe/);
});
const row = { rank: 1, name: 'Timure', pcode: 'NP0304050', granularityLevel: 3, neverHeard: true, silenceHours: 41, populationUsed: 46000, populationBasis: 'parent', hazardExposure: 'high', corroboration: [{ extracted_status: 'needs_help', confidence_tier: 'corroborated-multi-source', distinct_devices: 3 }, { extracted_status: 'safe', confidence_tier: 'unverified-single-source', distinct_devices: 1 }], isStale: true, windowHours: 12, effectiveStatus: 'unknown, needs re-verification' };
t('settlement card: rank, silence swatch with raw hours, never-heard wording, population basis flag, hazard, stale, tiers', () => {
  const s = html(h(SettlementCard, row));
  assert.match(s, /aria-label="rank 1"/);
  assert.match(s, /41 h/); assert.match(s, /--ds-silence-5/);
  assert.match(s, /No report received since activation/); assert.doesNotMatch(s, /silent/, 'no coverage evidence: never the word silent'); assert.match(s, /no report</); assert.match(s, /absence of data/);
  assert.match(s, /silence × population \(parent\) × hazard weight/);
  assert.doesNotMatch(html(h(SettlementCard, { ...row, showFormula: false })), /not a risk score/);
  const c = html(h(SettlementCard, { ...row, coverageBasis: 'device_sighted_before_activation' }));
  const after = html(h(SettlementCard, { ...row, coverageBasis: 'device_sighted_after_activation' }));
  assert.match(after, /known here only since the event/); assert.doesNotMatch(after, /silent/);
  const bogus = html(h(SettlementCard, { ...row, coverageBasis: 'device_seen_before_activation' }));
  assert.doesNotMatch(bogus, /silent/, 'old interim value is not honoured');
  assert.match(bogus, /no DarkSpot device ever registered/);
  assert.match(c, /Silent: no report since activation/); assert.match(c, /silent</);
  assert.match(s, /46,000/); assert.match(s, /parent-district figure/);
  assert.match(s, /ds-hazard--high/); assert.match(s, /Hazard exposure: high/);
  const hk = html(h(SettlementCard, { ...row, hazardKind: 'Flood extent' }));
  assert.match(hk, /Hazard exposure: high<\/span><span class="ds-settlement__hazardkind"> · Flood extent/);
  assert.doesNotMatch(html(h(SettlementCard, { ...row, hazardExposure: 'unknown', hazardKind: 'Flood extent' })), /Flood extent/, 'no kind shown for unknown exposure');
  assert.match(html(h(SettlementCard, { ...row, coverageBasis: 'none' })), /no DarkSpot device ever registered here/);
  assert.match(html(h(SettlementCard, { ...row, coverageBasis: 'device_sighted_after_activation' })), /known here only since the event/);
  assert.match(s, /ds-stale/); assert.match(s, /past the 12 h window/);
  assert.match(s, /ds-tier--corroborated/); assert.match(s, /3 devices/); assert.match(s, /ds-tier--unverified/);
  const tr = html(h(SettlementCard, { ...row, corroboration: [{ extracted_status: 'safe', confidence_tier: 'corroborated-multi-source', distinct_devices: 5, distinct_trusted_devices: 1, trusted_corroboration: 0 }] }));
  assert.match(tr, /1 trusted/); assert.match(tr, /ds-settlement__trusted ds-mono ds-settlement__flag/, 'untrusted corroboration is flagged');
  assert.match(s, /adm3/);
});
t('settlement card: unknown hazard is hatched, null silence renders stale, none basis flagged', () => {
  const s = html(h(SettlementCard, { ...row, hazardExposure: 'unknown', silenceHours: null, populationUsed: null, populationBasis: 'none', neverHeard: false, reportCount: 2, lastReportAt: '08:10', isStale: false, corroboration: [] }));
  assert.match(s, /ds-hazard--unknown/); assert.match(s, /Hazard exposure: unknown/);
  assert.match(s, /2 reports, last 08:10/);
  assert.match(s, /no figure, ranks last/);
  assert.match(s, /Unknown · needs re-verification/);
});
t('settlement card: unrecognised confidence_tier strings are dropped, not mapped', () => {
  const s = html(h(SettlementCard, { ...row, corroboration: [{ extracted_status: 'safe', confidence_tier: 'probably-fine', distinct_devices: 9 }] }));
  assert.doesNotMatch(s, /ds-tier--/);
});
t('no imperative vocabulary (Rule 1)', () => {
  const all = [h(SettlementCard, row), h(RawReport, { ...base, extractedStatus: 'safe', rawText: 'ok' })].map(html).join(' ');
  assert.doesNotMatch(all, /\b(dispatch|send|go to|assign(ed)?|deploy|proceed to|evacuate)\b/i);
});
console.log('\n' + n + ' assertion groups passed');

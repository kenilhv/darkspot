import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import '../src/tokens.css';
import '../src/components.css';
import { SimDemo } from './sim';
import { SettlementCard, RawReport } from '../src';
import { ConfidenceTierBadge, SimulationLabel, StaleMarker, SilenceSwatch, SilenceLegend, silenceStep, confidenceTiers } from '../src';

const hoursSamples = [0.5, 2, 4, 9, 18, 30, 72, null];

function Demo() {
  const [theme, setTheme] = useState<'light' | 'dark'>(new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
  return (
    <main style={{ padding: 24, maxWidth: 960, display: 'grid', gap: 32 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 'var(--ds-text-2xl)', letterSpacing: 'var(--ds-tracking-tight)' }}>@darkspot/ui — evidence primitives</h1>
        <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} style={{ minHeight: 44 }}>
          Theme: {theme}
        </button>
      </header>
      <section>
        <h2>ConfidenceTier</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <ConfidenceTierBadge tier="unverified-single-source" count={1} />
          <ConfidenceTierBadge tier="corroborated-multi-source" count={4} />
          <ConfidenceTierBadge tier="human-verified" verifiedBy="A. Rai (District DEOC)" />
          {confidenceTiers.map((t) => <ConfidenceTierBadge key={t} tier={t} size="sm" />)}
        </div>
      </section>
      <section>
        <h2>SimulationLabel</h2>
        <SimulationLabel>drone route · not deconflicted with airspace authority</SimulationLabel>
        <div style={{ height: 12 }} />
        <SimulationLabel block>Relay placement and UAV ferry routes on this page are simulated outputs. No aircraft is flying.</SimulationLabel>
      </section>
      <section>
        <h2>StaleMarker · SilenceSwatch</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <StaleMarker since="11:40" />
          {hoursSamples.map((h, i) => <SilenceSwatch key={i} hours={h} step={silenceStep(h)} />)}
        </div>
      </section>
      <section>
        <h2>SilenceLegend</h2>
        <SilenceLegend />
      </section>
      <section>
        <h2>SettlementCard · RawReport</h2>
        <SettlementCard rank={1} name="Timure" pcode="NP0304050" granularityLevel={3} neverHeard={false} reportCount={4} lastReportAt="09:14" silenceHours={9} populationUsed={46000} populationBasis="parent" hazardExposure="high" coverageBasis="device_sighted_before_activation" isStale windowHours={12} effectiveStatus="unknown, needs re-verification" corroboration={[{ extracted_status: 'needs_help', confidence_tier: 'corroborated-multi-source', distinct_devices: 3, distinct_trusted_devices: 1, trusted_corroboration: false }, { extracted_status: 'safe', confidence_tier: 'unverified-single-source', distinct_devices: 1 }]}>
          <RawReport id="e-42" receivedAt="2026-08-27T09:14:00Z" devicePubkey="ab12cd34ef56" hopCount={3} extractedStatus="needs_help" rawText={"bridge at Syabru gone, 12 families on the ridge above the school, need water"} extractionModel="extract-v0" extractionConfidence={0.82} />
          <RawReport id="e-47" receivedAt="2026-08-27T10:02:00Z" devicePubkey="77aa0011bb22" hopCount={5} extractedStatus="casualties" rawText="(withheld in demo)" />
        </SettlementCard>
        <div style={{ height: 12 }} />
        <SettlementCard rank={2} name="Aanbu Khaireni" pcode="NP0403010" granularityLevel={3} neverHeard silenceHours={41} coverageBasis="none" populationUsed={null} populationBasis="none" hazardExposure="unknown" />
      </section>
    </main>
  );
}
const page = new URLSearchParams(location.search).get('page');
createRoot(document.getElementById('root')!).render(page === 'sim' ? <SimDemo /> : <Demo />);

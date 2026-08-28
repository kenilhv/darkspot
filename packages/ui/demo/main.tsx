import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import '../src/tokens.css';
import '../src/components.css';
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
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Demo />);

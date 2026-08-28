import { useState } from 'react';
import { SettlementCard, SilenceLegend, ConfidenceTierBadge, StatusChip } from '../src';
import fixture from './data/npl_priority_rank_fixture.json';

/**
 * Coordinator view over REAL rows: CORE's `priority_rank` for the Nepal event,
 * exported by SWARM (provenance in the JSON). §2: "DarkSpot's own coordinator
 * view is the fallback, not the goal." Nothing here is a claim about conditions
 * on the ground — the fixture's own honesty note is rendered, not paraphrased.
 */
type Row = (typeof fixture)['rows'][number];

export function CoordinatorDemo() {
  const [showAll, setShowAll] = useState(false);
  const [hazardOnly, setHazardOnly] = useState(false);
  const rows: Row[] = fixture.rows.filter((r) => !hazardOnly || r.hazard_exposure === 'high');
  const visible = showAll ? rows : rows.slice(0, 12);
  const prov = fixture._provenance;
  const highCount = fixture.rows.filter((r) => r.hazard_exposure === 'high').length;
  return (
    <main className="ds-coord">
      <header className="ds-coord__head">
        <div>
          <span className="ds-coord__eyebrow">Coordinator view · evidence only</span>
          <h1 className="ds-coord__title">Nepal · Trishuli basin flood — settlements by silence × population × hazard</h1>
          <p className="ds-coord__sub">
            {fixture.rows.length} in-scope units (adm3) from CORE's <code>priority_rank</code> view · exported {prov.exported_at.slice(0, 16).replace('T', ' ')} UTC · {highCount} with observed hazard extent, {fixture.rows.length - highCount} unknown.
          </p>
        </div>
        <div className="ds-coord__controls" role="group" aria-label="Filters">
          <label className="ds-coord__check"><input type="checkbox" checked={hazardOnly} onChange={(e) => setHazardOnly(e.target.checked)} /> Observed hazard only</label>
        </div>
      </header>

      <section className="ds-coord__honesty" role="note" aria-label="Data honesty note">
        <strong>What this data can and cannot say.</strong> {prov.honesty}
      </section>

      <p className="ds-coord__formula">Rank = silence × population (parent-district basis for every row here) × hazard weight, per CORE's view. Each factor is printed on its card; the product is a sort order, not a risk score.</p>
      <div className="ds-coord__legend">
        <SilenceLegend />
        <div className="ds-coord__tierkey" aria-label="Confidence tiers used on this page">
          <ConfidenceTierBadge tier="unverified-single-source" size="sm" />
          <ConfidenceTierBadge tier="corroborated-multi-source" size="sm" />
          <ConfidenceTierBadge tier="human-verified" size="sm" />
          <StatusChip status="unextracted" />
        </div>
      </div>

      <ol className="ds-coord__list" aria-label="Settlements by priority rank">
        {visible.map((r) => (
          <li key={r.settlement_pcode}>
            <SettlementCard
              rank={r.rank}
              name={r.settlement_name}
              pcode={r.settlement_pcode}
              granularityLevel={r.granularity_level}
              neverHeard={r.never_heard}
              silenceHours={r.silence_hours}
              reportCount={r.report_count}
              populationUsed={r.population_used}
              populationBasis={r.population_basis}
              hazardExposure={r.hazard_exposure}
              hazardKind={r.hazard_kind}
              coverageBasis={r.coverage_basis}
              corroboration={[]}
              showFormula={false}
            />
          </li>
        ))}
      </ol>
      {rows.length > visible.length && (
        <button type="button" className="ds-coord__more" onClick={() => setShowAll(true)}>
          Show all {rows.length}
        </button>
      )}
      <footer className="ds-coord__foot">
        Source: {prov.what} Query: <code>{prov.query}</code>
      </footer>
    </main>
  );
}

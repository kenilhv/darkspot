import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';
import { SimulationLabel } from './Evidence';

/* ==========================================================================
   Swarm simulation frame — the UI around SWARM's canvas/D3 sim.
   Vocabulary mirrors swarm/src/*: node kinds (bridge/command, relay, unit,
   settlement), protocols (AntHocNet-inspired vs AODV baseline), allocation
   modes per mesh component ('hungarian' | 'auction'), cut links, and the
   is_simulation flag that every output carries (Rule 4).
   ========================================================================== */

/* ---------- Node glyphs: shape + colour, never colour alone ---------- */
export type SimNodeKind = 'bridge' | 'relay' | 'unit' | 'settlement';
export const simNodeKinds: SimNodeKind[] = ['bridge', 'relay', 'unit', 'settlement'];
export const simNodeLabel: Record<SimNodeKind, string> = {
  bridge: 'Bridge / command node (has backhaul)',
  relay: 'Relay (mesh device)',
  unit: 'Taskforce unit',
  settlement: 'Settlement (fill = silence step)',
};
/** Shape convention SWARM's canvas should follow: square / triangle / circle / ring. */
export function SimNodeGlyph({ kind, size = 14 }: { kind: SimNodeKind; size?: number }) {
  const s = size, h = s / 2;
  const fill = `var(--ds-sim-node-${kind})`;
  return (
    <svg className="ds-sim-glyph" width={s} height={s} viewBox={`0 0 ${s} ${s}`} aria-hidden="true" focusable="false">
      {kind === 'bridge' && <rect x={1} y={1} width={s - 2} height={s - 2} rx={1.5} fill={fill} />}
      {kind === 'relay' && <polygon points={`${h},1 ${s - 1},${s - 1} 1,${s - 1}`} fill={fill} />}
      {kind === 'unit' && <circle cx={h} cy={h} r={h - 1} fill={fill} />}
      {kind === 'settlement' && <circle cx={h} cy={h} r={h - 1.5} fill="var(--ds-silence-4)" stroke={fill} strokeWidth={1.5} />}
    </svg>
  );
}

export type SimEdgeKind = 'link' | 'link-strong' | 'link-cut' | 'route' | 'route-baseline' | 'pair-hungarian' | 'pair-auction' | 'drone-route';
export const simEdgeLabel: Record<SimEdgeKind, string> = {
  link: 'Mesh link (in range)',
  'link-strong': 'Mesh link, low queue',
  'link-cut': 'Link failed',
  route: 'AntHocNet-inspired path (pheromone-reinforced)',
  'route-baseline': 'AODV baseline path',
  'pair-hungarian': 'Suggested unit↔task pairing (path to command, Hungarian)',
  'pair-auction': 'Suggested unit↔task pairing (local auction, no path to command)',
  'drone-route': 'UAV ferry route — SIMULATION',
};
export function SimEdgeGlyph({ kind, width = 28 }: { kind: SimEdgeKind; width?: number }) {
  const stroke =
    kind === 'link' ? 'var(--ds-sim-link)'
    : kind === 'link-strong' ? 'var(--ds-sim-link-strong)'
    : kind === 'link-cut' ? 'var(--ds-color-hazard)'
    : kind === 'route' ? 'var(--ds-sim-route)'
    : kind === 'route-baseline' ? 'var(--ds-sim-route-baseline)'
    : kind === 'pair-hungarian' ? 'var(--ds-sim-pair-hungarian)'
    : kind === 'pair-auction' ? 'var(--ds-sim-pair-auction)'
    : 'var(--ds-sim-drone-route)';
  const dash = kind === 'link-cut' ? '2 3' : kind === 'drone-route' ? '6 4' : kind === 'pair-auction' ? '3 3' : undefined;
  const w = kind === 'route' ? 3 : kind === 'link' ? 1 : 2;
  return (
    <svg className="ds-sim-glyph" width={width} height={10} viewBox={`0 0 ${width} 10`} aria-hidden="true" focusable="false">
      <line x1={1} y1={5} x2={width - 1} y2={5} stroke={stroke} strokeWidth={w} strokeDasharray={dash} strokeLinecap="round" />
    </svg>
  );
}

/* ---------- Legend ---------- */
export interface SimLegendProps extends HTMLAttributes<HTMLDivElement> {
  nodes?: SimNodeKind[];
  edges?: SimEdgeKind[];
}
export function SimLegend({ nodes = simNodeKinds, edges = ['link', 'link-strong', 'link-cut', 'route', 'route-baseline', 'pair-hungarian', 'pair-auction', 'drone-route'], className, ...rest }: SimLegendProps) {
  return (
    <div className={cx('ds-simlegend', className)} role="group" aria-label="Legend" {...rest}>
      <span className="ds-simlegend__title">Nodes</span>
      <ul className="ds-simlegend__list">
        {nodes.map((k) => (
          <li key={k} className="ds-simlegend__item"><SimNodeGlyph kind={k} /><span>{simNodeLabel[k]}</span></li>
        ))}
      </ul>
      <span className="ds-simlegend__title">Links &amp; paths</span>
      <ul className="ds-simlegend__list">
        {edges.map((k) => (
          <li key={k} className={cx('ds-simlegend__item', k === 'drone-route' && 'ds-simlegend__item--sim')}>
            <SimEdgeGlyph kind={k} /><span>{simEdgeLabel[k]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Controls ---------- */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

export interface SimControlsProps extends HTMLAttributes<HTMLDivElement> {
  running: boolean;
  onRun: () => void;
  onPause: () => void;
  onStep: () => void;
  onReset: () => void;
  /** Ticks per second; omit to hide the speed control. */
  speed?: number;
  speeds?: number[];
  onSpeed?: (s: number) => void;
  /** Current tick, shown beside the controls. */
  tick?: number;
}
/**
 * Run/pause/step/reset. When the OS asks for reduced motion the "Run" button is
 * still available but the frame surfaces "Step" first and says why — continuous
 * animation is never forced on someone who asked not to have it.
 */
export function SimControls({ running, onRun, onPause, onStep, onReset, speed, speeds = [0.5, 1, 2, 4], onSpeed, tick, className, ...rest }: SimControlsProps) {
  const reduced = useReducedMotion();
  return (
    <div className={cx('ds-simctl', className)} role="toolbar" aria-label="Simulation controls" {...rest}>
      {reduced ? (
        <>
          <button type="button" className="ds-simctl__btn ds-simctl__btn--primary" onClick={onStep} disabled={running}>Step</button>
          <button type="button" className="ds-simctl__btn" onClick={running ? onPause : onRun} aria-pressed={running}>{running ? 'Pause' : 'Run'}</button>
        </>
      ) : (
        <>
          <button type="button" className="ds-simctl__btn ds-simctl__btn--primary" onClick={running ? onPause : onRun} aria-pressed={running}>{running ? 'Pause' : 'Run'}</button>
          <button type="button" className="ds-simctl__btn" onClick={onStep} disabled={running}>Step</button>
        </>
      )}
      <button type="button" className="ds-simctl__btn" onClick={onReset}>Reset</button>
      {speed != null && onSpeed && (
        <label className="ds-simctl__speed">
          <span>Speed</span>
          <select value={speed} onChange={(e) => onSpeed(Number(e.target.value))} aria-label="Ticks per second">
            {speeds.map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
      )}
      {tick != null && <span className="ds-simctl__tick ds-mono" aria-live="off">tick {tick}</span>}
      {reduced && <span className="ds-simctl__note">Reduced motion is on — step through, or run at your own pace.</span>}
    </div>
  );
}

/* ---------- Readouts ---------- */
export interface SimStatProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: ReactNode;
  /** Secondary line, e.g. units or a comparison. */
  detail?: ReactNode;
  tone?: 'default' | 'attention' | 'hazard' | 'accent';
}
export function SimStat({ label, value, detail, tone = 'default', className, ...rest }: SimStatProps) {
  return (
    <div className={cx('ds-simstat', tone !== 'default' && `ds-simstat--${tone}`, className)} {...rest}>
      <span className="ds-simstat__label">{label}</span>
      <span className="ds-simstat__value ds-mono">{value}</span>
      {detail != null && <span className="ds-simstat__detail">{detail}</span>}
    </div>
  );
}

/** One row of swarm/src/allocation.js `modes[]`. */
export interface AllocationMode {
  component: number | string;
  mode: 'hungarian' | 'auction';
  units: number;
  tasks: number;
  cost?: number;
  rounds?: number;
  idle?: boolean;
}
/** One row of `pairings[]` from allocation.js. */
export interface AllocationPairing {
  unitId: string | number;
  taskId: string | number;
  cost?: number;
  mode: 'hungarian' | 'auction';
}
export interface SimAllocationReadoutProps extends HTMLAttributes<HTMLDivElement> {
  modes: AllocationMode[];
  unitsWithoutCommand?: number;
  /**
   * The `note` string from allocation.js, rendered VERBATIM above everything else
   * (D-21 / RESEARCH review #1 finding 3). Required: no pairing is ever shown without it.
   */
  note: string;
  /** Optional pairing list; only rendered because `note` is mandatory. */
  pairings?: AllocationPairing[];
}
/**
 * Shows BOTH halves of the §2 allocation tension side by side — which mesh
 * components are solved centrally (Hungarian, path to command) and which fell
 * back to a local auction. Descriptive only: no pairing is rendered as an order.
 */
export function SimAllocationReadout({ modes, unitsWithoutCommand, note, pairings, className, ...rest }: SimAllocationReadoutProps) {
  const hung = modes.filter((m) => m.mode === 'hungarian');
  const auc = modes.filter((m) => m.mode === 'auction');
  const noteText = note && note.trim() ? note : 'Suggested unit/task pairings from a simulation. Not a dispatch order; requires human review before any action.';
  return (
    <div className={cx('ds-simalloc', className)} role="group" aria-label="Task allocation mode by mesh component" {...rest}>
      <p className="ds-simalloc__note" role="note">{noteText}</p>
      <div className="ds-simalloc__col">
        <span className="ds-simalloc__head">Hungarian · connected to command</span>
        <span className="ds-simalloc__count ds-mono">{hung.length} component{hung.length === 1 ? '' : 's'}</span>
        <ul className="ds-simalloc__list">
          {hung.map((m) => <li key={String(m.component)} className="ds-mono">#{m.component}: {m.units} units · {m.tasks} tasks{m.idle ? ' · idle' : m.cost != null ? ` · cost ${m.cost.toFixed(1)}` : ''}</li>)}
        </ul>
      </div>
      <div className="ds-simalloc__col ds-simalloc__col--auction">
        <span className="ds-simalloc__head">Local auction · no path to command</span>
        <span className="ds-simalloc__count ds-mono">{auc.length} component{auc.length === 1 ? '' : 's'}</span>
        <ul className="ds-simalloc__list">
          {auc.map((m) => <li key={String(m.component)} className="ds-mono">#{m.component}: {m.units} units · {m.tasks} tasks{m.idle ? ' · idle' : `${m.cost != null ? ` · cost ${m.cost.toFixed(1)}` : ''}${m.rounds != null ? ` · ${m.rounds} rounds` : ''}`}</li>)}
        </ul>
        {unitsWithoutCommand != null && (
          <span className="ds-simalloc__foot">{unitsWithoutCommand} unit{unitsWithoutCommand === 1 ? '' : 's'} without a path to command</span>
        )}
      </div>
      {pairings && pairings.length > 0 && (
        <ul className="ds-simalloc__pairs" aria-label="Suggested pairings (simulation)">
          {pairings.map((p) => (
            <li key={`${p.unitId}-${p.taskId}`} className={cx('ds-mono', `ds-simalloc__pair--${p.mode}`)}>
              unit {p.unitId} ↔ task {p.taskId}{p.cost != null ? ` · cost ${p.cost.toFixed(1)}` : ''} · {p.mode}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- Frame ---------- */
export interface SimFrameProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  /** The canvas / SVG. Rendered in a region with an accessible name. */
  children: ReactNode;
  /** Legend + readouts; rendered as a complementary sidebar. */
  aside?: ReactNode;
  /** Controls toolbar, rendered under the title. */
  controls?: ReactNode;
  /** Text description of what the canvas currently shows — for screen readers and for honesty. */
  canvasDescription: string;
  /** Qualifier appended to the mandatory simulation banner. */
  simulationNote?: string;
}
/**
 * The page frame for the swarm sim. The Simulation banner is not optional and
 * not a prop that can be turned off (Rule 4). Sets data-theme="dark" on itself
 * so the canvas palette (--ds-sim-*) and the dark UI palette agree.
 */
export function SimFrame({ title, children, aside, controls, canvasDescription, simulationNote, className, ...rest }: SimFrameProps) {
  return (
    <div className={cx('ds-root ds-simframe', className)} data-theme="dark" {...rest}>
      <SimulationLabel block className="ds-simframe__banner">
        {simulationNote ?? 'Relay placement, routing and task allocation shown here are simulated outputs. No aircraft is flying; nothing here is an instruction to anyone.'}
      </SimulationLabel>
      <header className="ds-simframe__head">
        <h1 className="ds-simframe__title">{title}</h1>
        {controls}
      </header>
      <div className="ds-simframe__body">
        <section className="ds-simframe__canvas" role="region" aria-label={`${title} — simulation canvas`}>
          {children}
          <p className="ds-visually-hidden" aria-live="polite">{canvasDescription}</p>
        </section>
        {aside && <aside className="ds-simframe__aside" aria-label="Legend and readouts">{aside}</aside>}
      </div>
    </div>
  );
}

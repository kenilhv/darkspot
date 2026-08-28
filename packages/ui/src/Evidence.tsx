import type { HTMLAttributes } from 'react';
import { cx } from './cx';
import { type ConfidenceTier, tierGlyph, tierLabel, silenceRamp, silenceInk, defaultSilenceEdgesHours } from './tokens';

/* --------------------------------------------------------------------------
   ConfidenceTier — the §2 mv_corroboration tier of a piece of evidence.
   Three carriers: colour (token), glyph (○ ◐ ●) and text. Never a number.
   `count` = distinct device identities behind it (not message count).
   -------------------------------------------------------------------------- */
export interface ConfidenceTierProps extends HTMLAttributes<HTMLSpanElement> {
  tier: ConfidenceTier;
  /** Distinct device identities that corroborate this (mv_corroboration). */
  count?: number;
  /** Reviewer name for `human-verified` — shown so sign-off is attributable (Rule 2). */
  verifiedBy?: string;
  size?: 'sm' | 'md';
}
export function ConfidenceTierBadge({ tier, count, verifiedBy, size = 'md', className, ...rest }: ConfidenceTierProps) {
  const short = tier.split('-')[0] as 'unverified' | 'corroborated' | 'human';
  const key = short === 'human' ? 'verified' : short;
  const detail =
    tier === 'human-verified'
      ? verifiedBy
        ? `by ${verifiedBy}`
        : undefined
      : count != null
        ? `${count} device${count === 1 ? '' : 's'}`
        : undefined;
  return (
    <span
      className={cx('ds-tier', `ds-tier--${key}`, size === 'sm' && 'ds-tier--sm', className)}
      data-tier={tier}
      {...rest}
    >
      <span className="ds-tier__glyph" aria-hidden="true">{tierGlyph[tier]}</span>
      <span className="ds-tier__label">{tierLabel[tier]}</span>
      {detail && <span className="ds-tier__detail ds-mono">{detail}</span>}
    </span>
  );
}

/* --------------------------------------------------------------------------
   SimulationLabel — Rule 4. Magenta + stripe + the literal word. Any surface
   showing a drone route / relay placement result wraps or labels it with this.
   `block` renders a striped banner for whole panels; inline renders a tag.
   -------------------------------------------------------------------------- */
export interface SimulationLabelProps extends HTMLAttributes<HTMLElement> {
  block?: boolean;
  /** Extra qualifier, e.g. "not deconflicted with airspace authority". */
  children?: React.ReactNode;
}
export function SimulationLabel({ block, children, className, ...rest }: SimulationLabelProps) {
  const Tag = block ? 'div' : 'span';
  return (
    <Tag role="note" className={cx('ds-sim', block ? 'ds-sim--block' : 'ds-sim--inline', className)} {...rest}>
      <span className="ds-sim__word">Simulation</span>
      {children ? <span className="ds-sim__detail">{children}</span> : null}
    </Tag>
  );
}

/* --------------------------------------------------------------------------
   StaleMarker — §2 mv_staleness: "unknown, needs re-verification". Hatched,
   dashed, never a solid status colour. `since` = when it decayed to unknown.
   -------------------------------------------------------------------------- */
export interface StaleMarkerProps extends HTMLAttributes<HTMLSpanElement> {
  /** Human-readable moment the status decayed, e.g. "14:02" or "2 h ago". */
  since?: string;
}
export function StaleMarker({ since, className, ...rest }: StaleMarkerProps) {
  return (
    <span className={cx('ds-stale', className)} {...rest}>
      <span className="ds-stale__hatch" aria-hidden="true" />
      <span className="ds-stale__label">Unknown · needs re-verification</span>
      {since && <span className="ds-stale__since ds-mono">since {since}</span>}
    </span>
  );
}

/* --------------------------------------------------------------------------
   SilenceSwatch / SilenceLegend — the silence ramp (§2 mv_silence_duration).
   The swatch always shows the raw hours next to the colour: the ramp is a
   display bucketing, not a score. `null` hours renders the stale treatment.
   -------------------------------------------------------------------------- */
export interface SilenceSwatchProps extends HTMLAttributes<HTMLSpanElement> {
  /** Raw time since any confirmation, in hours. `null` = unknown. */
  hours: number | null;
  step: number | null;
}
export function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h % 1 === 0 ? h : h.toFixed(1)} h`;
  const d = Math.floor(h / 24);
  const r = Math.round(h % 24);
  return r === 0 ? `${d} d` : `${d} d ${r} h`;
}
export function SilenceSwatch({ hours, step, className, ...rest }: SilenceSwatchProps) {
  if (hours == null || step == null) return <StaleMarker className={className} {...rest} />;
  const ink = silenceInk(step);
  return (
    <span
      className={cx('ds-silence', `ds-silence--ink-${ink}`, className)}
      style={{ background: `var(--ds-silence-${step})` }}
      data-step={step}
      {...rest}
    >
      <span className="ds-silence__hours ds-mono">{formatHours(hours)}</span>
      <span className="ds-silence__label">silent</span>
    </span>
  );
}

export interface SilenceLegendProps extends HTMLAttributes<HTMLDivElement> {
  /** Bucket edges in hours (defaults to tokens.defaultSilenceEdgesHours). */
  edges?: readonly number[];
  title?: string;
}
export function SilenceLegend({ edges = defaultSilenceEdgesHours, title = 'Time since any confirmation', className, ...rest }: SilenceLegendProps) {
  const labels = [`< ${formatHours(edges[0] ?? 1)}`];
  for (let i = 0; i < edges.length; i++) {
    const lo = edges[i] ?? 0;
    const hi = edges[i + 1];
    labels.push(hi == null ? `≥ ${formatHours(lo)}` : `${formatHours(lo)}–${formatHours(hi)}`);
  }
  return (
    <div className={cx('ds-silence-legend', className)} role="group" aria-label={title} {...rest}>
      <span className="ds-silence-legend__title">{title}</span>
      <ol className="ds-silence-legend__steps">
        {silenceRamp.map((_, i) => (
          <li key={i} className="ds-silence-legend__step">
            <span
              className="ds-silence-legend__swatch"
              style={{ background: `var(--ds-silence-${i})` }}
              aria-hidden="true"
            />
            <span className="ds-silence-legend__label">{labels[i]}</span>
          </li>
        ))}
        <li className="ds-silence-legend__step">
          <span className="ds-silence-legend__swatch ds-silence-legend__swatch--stale" aria-hidden="true" />
          <span className="ds-silence-legend__label">unknown</span>
        </li>
      </ol>
      <span className="ds-silence-legend__note">Raw duration, not a risk score.</span>
    </div>
  );
}

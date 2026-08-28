import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import { ConfidenceTierBadge, SilenceSwatch, StaleMarker } from './Evidence';
import { confidenceTiers, silenceStep, type ConfidenceTier } from './tokens';

/* ==========================================================================
   Coordinator-view primitives. Row shapes are CORE's real views as CHAT's
   tools/contract.ts records them (priority_rank, corroboration, staleness,
   mesh_events) — not §2 prose. Nothing here renders an instruction (Rule 1);
   restricted fields are withheld unless the caller says it is authorized
   (Rule 2 — the check itself lives in CORE/CHAT, this only honours it).
   ========================================================================== */

/** CORE mesh_events.extracted_status values. */
export type ExtractedStatus = 'unextracted' | 'safe' | 'needs_help' | 'casualties' | 'unknown';
export const RESTRICTED_STATUS: ExtractedStatus = 'casualties';
export const statusLabel: Record<ExtractedStatus, string> = {
  unextracted: 'Not yet extracted',
  safe: 'Reported safe',
  needs_help: 'Reported needing help',
  casualties: 'Restricted · casualty-related',
  unknown: 'Status unknown',
};
export const RAW_WITHHELD_TEXT = 'Raw text withheld: this report is casualty-related and readable only via a signed-off escalation (§1a Rule 2).';

export interface StatusChipProps extends HTMLAttributes<HTMLSpanElement> {
  status: ExtractedStatus | string;
}
export function StatusChip({ status, className, ...rest }: StatusChipProps) {
  const s = (status in statusLabel ? status : 'unknown') as ExtractedStatus;
  return (
    <span className={cx('ds-status', `ds-status--${s}`, className)} data-status={s} {...rest}>
      {statusLabel[s]}
    </span>
  );
}

/* ---------- RawReport: original text next to what was extracted from it ---------- */
export interface RawReportProps extends Omit<HTMLAttributes<HTMLElement>, 'id'> {
  id: string | number;
  receivedAt: string;
  /** Device pubkey (hex) — shown truncated; corroboration counts devices, not messages. */
  devicePubkey?: string;
  hopCount?: number;
  extractedStatus: ExtractedStatus | string;
  rawText: string;
  extractionModel?: string;
  extractionConfidence?: number | null;
  /** Only true when CORE/CHAT's access_roles check has passed for this viewer. */
  authorized?: boolean;
}
export function RawReport({ id, receivedAt, devicePubkey, hopCount, extractedStatus, rawText, extractionModel, extractionConfidence, authorized = false, className, ...rest }: RawReportProps) {
  const withheld = extractedStatus === RESTRICTED_STATUS && !authorized;
  return (
    <article className={cx('ds-report', withheld && 'ds-report--withheld', className)} aria-label={`Report ${id}`} {...rest}>
      <header className="ds-report__meta ds-mono">
        <span>id {id}</span>
        <time dateTime={receivedAt}>{receivedAt}</time>
        {devicePubkey && <span title={devicePubkey}>device {devicePubkey.slice(0, 8)}…</span>}
        {hopCount != null && <span>{hopCount} hop{hopCount === 1 ? '' : 's'}</span>}
      </header>
      <div className="ds-report__body">
        <div className="ds-report__raw">
          <span className="ds-report__label">Original report</span>
          {withheld ? (
            <p className="ds-report__withheld">{RAW_WITHHELD_TEXT}</p>
          ) : (
            <blockquote className="ds-report__text">{rawText}</blockquote>
          )}
        </div>
        <div className="ds-report__extracted">
          <span className="ds-report__label">Extracted</span>
          <StatusChip status={extractedStatus} />
          {(extractionModel || extractionConfidence != null) && !withheld && (
            <span className="ds-report__model ds-mono">
              {extractionModel || 'model n/a'}
              {extractionConfidence != null && ` · ${Math.round(extractionConfidence * 100)}%`}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

/* ---------- SettlementCard: one priority_rank row with its evidence state ---------- */
export type HazardExposure = 'high' | 'medium' | 'low' | 'unknown';
export interface CorroborationRow {
  extracted_status: ExtractedStatus | string;
  confidence_tier: ConfidenceTier | string;
  distinct_devices: number;
}
export interface SettlementCardProps extends HTMLAttributes<HTMLElement> {
  rank?: number;
  name: string;
  pcode: string;
  granularityLevel?: number | null;
  neverHeard: boolean;
  silenceHours: number | null;
  reportCount?: number | null;
  lastReportAt?: string | null;
  populationUsed?: number | null;
  populationBasis?: 'unit' | 'parent' | 'none' | string;
  hazardExposure: HazardExposure | string;
  corroboration?: CorroborationRow[];
  isStale?: boolean;
  windowHours?: number | null;
  effectiveStatus?: string | null;
  /** Extra content (e.g. RawReport list) rendered below the summary. */
  children?: ReactNode;
}
const hazardLabel: Record<HazardExposure, string> = {
  high: 'Hazard exposure: high',
  medium: 'Hazard exposure: medium',
  low: 'Hazard exposure: low',
  unknown: 'Hazard exposure: unknown',
};
export function SettlementCard({ rank, name, pcode, granularityLevel, neverHeard, silenceHours, reportCount, lastReportAt, populationUsed, populationBasis, hazardExposure, corroboration = [], isStale, windowHours, effectiveStatus, children, className, ...rest }: SettlementCardProps) {
  const hz = (hazardExposure in hazardLabel ? hazardExposure : 'unknown') as HazardExposure;
  const tiers = corroboration.filter((c) => (confidenceTiers as readonly string[]).includes(c.confidence_tier));
  return (
    <article className={cx('ds-settlement', className)} aria-label={`${name}, ${pcode}`} {...rest}>
      <header className="ds-settlement__head">
        {rank != null && <span className="ds-settlement__rank ds-mono" aria-label={`rank ${rank}`}>{rank}</span>}
        <div className="ds-settlement__title">
          <h3 className="ds-settlement__name">{name}</h3>
          <span className="ds-settlement__pcode ds-mono">{pcode}{granularityLevel != null && ` · adm${granularityLevel}`}</span>
        </div>
        <SilenceSwatch hours={silenceHours} step={silenceStep(silenceHours)} />
      </header>
      <dl className="ds-settlement__facts">
        <div>
          <dt>Contact</dt>
          <dd>
            {neverHeard
              ? 'Never heard from since activation'
              : `${reportCount ?? '?'} report${reportCount === 1 ? '' : 's'}${lastReportAt ? `, last ${lastReportAt}` : ''}`}
          </dd>
        </div>
        <div>
          <dt>Population</dt>
          <dd>
            {populationUsed != null ? <span className="ds-mono">{populationUsed.toLocaleString()}</span> : 'not available'}
            {populationBasis === 'parent' && <span className="ds-settlement__flag"> · parent-district figure</span>}
            {populationBasis === 'none' && <span className="ds-settlement__flag"> · no figure, ranks last</span>}
          </dd>
        </div>
        <div>
          <dt>Hazard</dt>
          <dd><span className={cx('ds-hazard', `ds-hazard--${hz}`)}>{hazardLabel[hz]}</span></dd>
        </div>
      </dl>
      {isStale && (
        <div className="ds-settlement__stale">
          <StaleMarker />
          <span className="ds-settlement__stale-note">
            Last extracted status is past the {windowHours ?? '?'} h window; effective status “{effectiveStatus ?? 'unknown, needs re-verification'}”.
          </span>
        </div>
      )}
      {tiers.length > 0 && (
        <ul className="ds-settlement__tiers" aria-label="Corroboration by reported status">
          {tiers.map((c, i) => (
            <li key={i}>
              <StatusChip status={c.extracted_status} />
              <ConfidenceTierBadge tier={c.confidence_tier as ConfidenceTier} count={c.distinct_devices} size="sm" />
            </li>
          ))}
        </ul>
      )}
      {children && <div className="ds-settlement__children">{children}</div>}
    </article>
  );
}

/**
 * DarkSpot design tokens — TypeScript mirror of src/tokens.css for code that
 * cannot read CSS custom properties (canvas/D3 drawing in the swarm sim, chart
 * scales, LibreChat theme generation). Values here MUST match tokens.css;
 * `scripts/check-contrast.mjs` is the contrast gate for both.
 *
 * Prefer `cssVar('silence-4')` in DOM/SVG code so themes apply; use the raw
 * `palette`/`sim` objects only inside <canvas>, where var() cannot be used.
 */

export const palette = {
  n: ['#F7F6F2', '#FFFFFF', '#EFEDE8', '#E5E2DB', '#D9D6CE', '#85817A', '#8B919B', '#646A73', '#454A52', '#262B33', '#1E2229', '#171A1F', '#0F1114'],
  beacon: { 50: '#E3F1F3', 100: '#BFE0E5', 300: '#62B4C0', 500: '#1F8A9B', 600: '#16707F', 700: '#0F5560', 900: '#073038' },
  verdant: { 50: '#E4F3E8', 100: '#BFE3C9', 300: '#63B77F', 500: '#24864A', 600: '#1B6E3B', 900: '#0B3A1D' },
  ember: { 50: '#FCEBE4', 100: '#F8CCBD', 300: '#EF8A66', 500: '#D4502A', 600: '#B23F1E', 900: '#5F1F0C' },
  amber: { 50: '#FBF1DC', 100: '#F5DDA8', 300: '#E6B24C', 500: '#B8790F', 600: '#96600A', 900: '#4F3204' },
  sim: { 50: '#FBE7F3', 100: '#F5C3E2', 300: '#E477BF', 500: '#C0308F', 600: '#A0217A', 900: '#56103F' },
  dusk: ['#F3F1EC', '#DBD8E3', '#B9B2CF', '#918AB4', '#665D91', '#3E3568', '#1C1740'],
  sky: { 300: '#7FB0FF', 500: '#2F6FEB' },
} as const;

/** The three confidence tiers from §2 `mv_corroboration`. Never collapse them. */
export const confidenceTiers = ['unverified-single-source', 'corroborated-multi-source', 'human-verified'] as const;
export type ConfidenceTier = (typeof confidenceTiers)[number];

/** Glyph carrier for each tier so colour is never the only signal. */
export const tierGlyph: Record<ConfidenceTier, string> = {
  'unverified-single-source': '○',
  'corroborated-multi-source': '◐',
  'human-verified': '●',
};

/** Human labels — descriptive, never imperative (Rule 1). */
export const tierLabel: Record<ConfidenceTier, string> = {
  'unverified-single-source': 'Unverified · single source',
  'corroborated-multi-source': 'Corroborated · multiple devices',
  'human-verified': 'Human-verified',
};

/**
 * Silence ramp: 7 sequential steps of the dusk ramp. `silenceStep` maps a raw
 * time-since-any-confirmation (hours) onto a step. Thresholds are a *display*
 * bucketing only — they are not a claim about risk (see §2 mv_silence_duration:
 * raw duration, deliberately not an anomaly score). Apps may pass their own edges.
 */
export const silenceRamp = palette.dusk;
export const defaultSilenceEdgesHours = [1, 3, 6, 12, 24, 48] as const;
export function silenceStep(hours: number | null | undefined, edges: readonly number[] = defaultSilenceEdgesHours): number | null {
  if (hours == null || Number.isNaN(hours)) return null; // unknown → caller draws the stale treatment
  let step = 0;
  for (const e of edges) if (hours >= e) step++;
  return Math.min(step, silenceRamp.length - 1);
}
/** Which ink is legible on a given silence step (contrast-checked). */
export function silenceInk(step: number): 'low' | 'high' {
  return step <= 3 ? 'low' : 'high';
}

/** Canvas colours for the swarm simulation (dark canvas only; matches --ds-sim-*). */
export const sim = {
  canvasBg: palette.n[11],
  grid: 'rgba(255,255,255,0.04)',
  nodeBridge: palette.beacon[300],
  nodeRelay: palette.amber[300],
  nodeUnit: palette.verdant[300],
  nodeSettlement: palette.n[5],
  link: 'rgba(139,145,155,0.35)',
  linkStrong: 'rgba(139,145,155,0.8)',
  route: palette.beacon[300],
  routeBaseline: palette.n[6],
  packet: '#FFFFFF',
  /** Always drawn dashed and labeled "SIMULATION" (Rule 4). */
  droneRoute: palette.sim[300],
  label: palette.n[0],
  /** Outline for deep silence steps on the dark canvas. */
  silenceRing: '#8F959E',
} as const;

export const fonts = {
  ui: '"Atkinson Hyperlegible", "Segoe UI", system-ui, -apple-system, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace',
} as const;

/** One <link> per app. Atkinson Hyperlegible ships 400/700 only. */
export const GOOGLE_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap';

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;
export const radius = { sm: 4, md: 8, lg: 12, xl: 20, full: 9999 } as const;
export const duration = { fast: 120, base: 180, slow: 280 } as const;
export const layout = { container: 1360, sidebar: 272, topbar: 56, touchTarget: 44 } as const;

/** `cssVar('color-accent')` → `var(--ds-color-accent)` */
export function cssVar(name: string): string {
  return `var(--ds-${name})`;
}

export const tokens = { palette, sim, fonts, space, radius, duration, layout } as const;

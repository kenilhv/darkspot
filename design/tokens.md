# DarkSpot — Design Tokens

Source of truth for every DarkSpot UI surface: the coordinator dashboard, the swarm
visualization page, LibreChat theming. Machine-readable copies: `packages/ui/src/tokens.css`
(CSS custom properties, prefix `--ds-`) and `packages/ui/src/tokens.ts` (for canvas/D3 code).
**Apps consume the semantic layer, never raw hex.** `npm run check:contrast` in `packages/ui`
verifies every semantic pair in both themes (WCAG 2.1 SC 1.4.3 text 4.5:1, SC 1.4.11 UI 3:1 —
https://www.w3.org/TR/WCAG21/#contrast-minimum) and fails the build on regression.

## Why it looks like this

The reader is a coordinator or volunteer under stress, often on a phone, in a tent, in rain or
low light, deciding what to trust. The design has one job: make **the confidence of a piece of
evidence** and **how long a place has been silent** impossible to misread. Everything else is
quiet so those two things are loud.

- **Colour is reserved for evidence state, not brand.** Green means one thing only — a named
  human verified it. Red means one thing only — hazard exposure. There is no "success green"
  button and no "error red" toast; those would dilute the two most important signals.
- **Silence is dark, not red.** The product's core insight (§2) is that silence is a signal.
  The silence ramp ("dusk") goes pale → deep indigo-ink: literally the dark spot on the map.
  It is sequential (one hue, luminance-ordered) so it reads correctly in greyscale and under
  every common colour-vision deficiency.
- **Simulation is magenta and striped, always.** Rule 4: no drone route may look real. Magenta
  is used by no mapping/ops convention we could find, and the diagonal stripe is a second
  carrier so the label survives colour-blindness and black-and-white printing.
- **Unknown looks unknown.** Stale data (§2 `mv_staleness`) is drawn with a dashed border and
  hatch, never a solid status colour — stale data trusted as current is worse than no data.
- **Interactive is teal ("beacon"), not any evidence colour.** So a link never looks verified.
- **Three tiers, three carriers.** Confidence tiers are distinguished by colour *and* glyph
  (○ ◐ ●) *and* label text. Never collapsed into a single score.
- **No imperative UI.** Rule 1: components describe evidence; there is no "Dispatch", "Send",
  or "Assign" pattern in this library, and none will be added.
- **Dark theme is real, not a filter.** The swarm sim lives on a dark canvas; the dashboard is
  light by default. Both palettes are hand-set and both are contrast-gated.

## Color

### Primitives

| Ramp | Steps | Use |
|---|---|---|
| n (neutral) | 0 `#F7F6F2` · 1 `#FFFFFF` · 2 `#EFEDE8` · 3 `#E5E2DB` · 4 `#D9D6CE` · 5 `#85817A` · 6 `#8B919B` · 7 `#646A73` · 8 `#454A52` · 9 `#262B33` · 10 `#1E2229` · 11 `#171A1F` · 12 `#0F1114` | surfaces, lines, ink |
| beacon | 50 `#E3F1F3` · 100 `#BFE0E5` · 300 `#62B4C0` · 500 `#1F8A9B` · **600 `#16707F`** · 700 `#0F5560` · 900 `#073038` | interactive, links, mesh routes, "corroborated" |
| verdant | 50 `#E4F3E8` · 100 `#BFE3C9` · 300 `#63B77F` · 500 `#24864A` · **600 `#1B6E3B`** · 900 `#0B3A1D` | **human-verified only** |
| ember | 50 `#FCEBE4` · 100 `#F8CCBD` · 300 `#EF8A66` · 500 `#D4502A` · **600 `#B23F1E`** · 900 `#5F1F0C` | hazard exposure, destructive |
| amber | 50 `#FBF1DC` · 100 `#F5DDA8` · 300 `#E6B24C` · 500 `#B8790F` · **600 `#96600A`** · 900 `#4F3204` | attention: conflicts, staleness approaching |
| sim (magenta) | 50 `#FBE7F3` · 100 `#F5C3E2` · 300 `#E477BF` · 500 `#C0308F` · **600 `#A0217A`** · 900 `#56103F` | **simulation only** (Rule 4) |
| dusk | 0 `#F3F1EC` · 1 `#DBD8E3` · 2 `#B9B2CF` · 3 `#918AB4` · 4 `#665D91` · 5 `#3E3568` · 6 `#1C1740` | silence ramp |
| sky | 300 `#7FB0FF` · 500 `#2F6FEB` | keyboard focus ring only |

Measured contrast (light theme, on `n-0`): text `n-10` 14.8 · muted `n-7` 5.0 · beacon-600 5.3 ·
verdant-600 5.8 · ember-600 5.4 · amber-600 4.9 · sim-600 6.5 · focus sky-500 4.2 · strong border
`n-5` 3.6. Dark theme (on `n-12`): text 15.4 · muted 6.3 · beacon-300 7.9 · verdant-300 7.8 ·
ember-300 7.7 · amber-300 9.8 · sim-300 6.9 · focus sky-300 8.6 · strong border 3.2. All numbers
are copied from `scripts/check-contrast.mjs` output (110 checks, all passing); the smallest
margin is 1.24 on adjacent silence steps (threshold 1.2). Re-run before changing any step.

### Semantic — surfaces, text, actions

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `--ds-color-bg` / `-bg-raised` / `-bg-sunken` / `-bg-well` | n-0 / n-1 / n-2 / n-3 | n-12 / n-11 / n-10 / n-9 | page, cards, sidebars, wells |
| `--ds-color-border` / `-border-strong` | n-4 / n-5 | `#2E343D` / `#5C6470` | hairline / boundary that must meet 3:1 |
| `--ds-color-text` / `-secondary` / `-muted` / `-display` | n-10 / n-8 / n-7 / n-12 | `#E6E8EB` / `#B4B9C1` / `#8F959E` / `#F4F5F7` | body / secondary / captions / headings |
| `--ds-color-accent` (+`-hover` `-active` `-soft` `-soft-border`), `--ds-color-link` | beacon-600… | beacon-300… | interactive only |
| `--ds-color-attention` (+`-soft`, `-soft-border`) | amber-600 | amber-300 | "a human needs to look" — never an error |
| `--ds-color-hazard` (+`-hover` `-soft` `-soft-border`) | ember-600 | ember-300 | hazard exposure, destructive actions |
| `--ds-color-focus` | sky-500 | sky-300 | keyboard focus ring only |

### Semantic — evidence state (the part that matters)

| Token group | Carries | Light | Dark |
|---|---|---|---|
| `--ds-tier-unverified-{ink,fill,border}` | ○ `unverified-single-source` | n-7 / n-2 / n-5 | `#A5AAB3` / n-10 / `#5C6470` |
| `--ds-tier-corroborated-{ink,fill,border}` | ◐ `corroborated-multi-source` | beacon-600 / 50 / 100 | beacon-300 / 12% / 45% |
| `--ds-tier-verified-{ink,fill,border}` | ● `human-verified` | verdant-600 / 50 / 100 | verdant-300 / 12% / 45% |
| `--ds-stale-{ink,fill,border,hatch}` | "unknown, needs re-verification" | n-7 / transparent / n-5 / 135° hatch in n-4 | `#A5AAB3` / — / `#5C6470` / hatch `#2E343D` |
| `--ds-conflict-{ink,fill,border}` | disagreeing reports, side by side | amber-600 / 50 / 500 | amber-300 / 12% / 500 |
| `--ds-simulation-{ink,fill,border,stripe}` | Rule 4 label | sim-600 / 50 / 500 / 45° stripe | sim-300 / 12% / 300 / stripe |
| `--ds-silence-0…6`, `--ds-silence-ink-on-low` (steps 0–3), `-on-high` (4–6), `--ds-silence-ring` | time since any confirmation | dusk ramp; ring transparent | dusk ramp; ring `#8F959E` on dark surfaces |

Silence bucketing (`silenceStep()` in tokens.ts) defaults to edges 1 / 3 / 6 / 12 / 24 / 48 h.
This is a *display* bucketing of the raw duration (§2 `mv_silence_duration`), not a risk score —
apps must show the raw hours next to the swatch, and pass their own edges if a deployment's
partner org defines different windows. `null` hours ⇒ the stale treatment, never step 0.

### Semantic — swarm simulation canvas (`--ds-sim-*`, `sim` in tokens.ts)

| Token | Value | Meaning |
|---|---|---|
| `canvas-bg` / `canvas-grid` | n-11 / white 4% | canvas ground |
| `node-bridge` / `node-relay` / `node-unit` / `node-settlement` | beacon-300 / amber-300 / verdant-300 / n-5 | node kinds; settlement fill = its silence step |
| `link` / `link-strong` | grey 35% / 80% | mesh link, by link quality |
| `route` / `route-baseline` / `packet` | beacon-300 / n-6 / white | pheromone-reinforced path (AntHocNet) / AODV baseline / hop animation |
| `drone-route` | sim-300 | **always dashed + text label "SIMULATION"** |
| `label` / `silence-ring` | n-0 / `#8F959E` | canvas text; outline so deep silence steps don't vanish into the dark canvas |

All node/route colours ≥ 3:1 on the canvas; label 15.5:1. Node *kind* must also be encoded by
shape (SWARM: e.g. square bridge, triangle relay, circle unit) — colour alone is not enough on a
busy canvas. The legend component (next unit) will encode both.

## Typography

| Role | Font | Notes |
|---|---|---|
| UI / body / headings | **Atkinson Hyperlegible** 400 / 700 | chosen for its unambiguous letterforms (distinct I/l/1, O/0) — this UI is read fast, tired, on small screens. Google Fonts ships 400/700 only, so hierarchy comes from size + weight + tracking, not a third weight. |
| Data: ids, timestamps, counts, geohashes, raw report text | **IBM Plex Mono** 400 / 500 | tabular by nature; `time[datetime]` and `code` get it automatically inside `.ds-root` |

Load once per app: `<link rel="stylesheet" href={GOOGLE_FONTS_HREF}>` (exported from tokens.ts).
Fallback stack is Segoe UI / system-ui so nothing breaks offline (this is an offline-first tool —
the font is an enhancement, never a dependency).

Scale (rem): xs 12 · sm 14 · md 16 · lg 18 · xl 22 · 2xl 28 · 3xl 36 · 4xl 48.
Leading: tight 1.15 (display) · snug 1.3 (headings) · normal 1.5 (body) · loose 1.65 (raw report text).
Display ≥ 28px: weight 700, tracking −0.015em. Eyebrow labels: xs, 700, uppercase, +0.06em, muted.

## Spacing, radius, elevation, layout

- 4px base: `--ds-space-{1,2,3,4,5,6,8,10,12,16}` = 4 8 12 16 20 24 32 40 48 64.
- Radius: sm 4 (inputs, badges) · md 8 (buttons) · lg 12 (cards) · xl 20 (dialogs) · full.
- Shadows are ink-tinted (`rgba(30,34,41,α)` light; pure black dark) and always paired with a
  1px border — shadow alone is never a boundary (fails on a dim screen in a tent).
- Layout: container 1360 · sidebar 272 · topbar 56 · prose measure 68ch.
- **Touch target 44px** (`--ds-touch-target`) on every field-facing control — gloves, rain, one hand.
- Focus: `0 0 0 2px bg, 0 0 0 4px focus` on `:focus-visible` only. Never `outline: none` without it.
- Motion: ease-out `cubic-bezier(.2,.8,.2,1)`; 120 / 180 / 280 ms; all zeroed under
  `prefers-reduced-motion`. The sim's own animation is governed by SWARM but should honour the
  same preference by offering a "step" control.

## Themes

`:root` is light. `<html data-theme="dark">` switches (the swarm page sets this);
`data-theme="auto"` follows the OS. Both themes are full palettes, not inversions, and both are
gated by the contrast script.

## Using it

```css
@import "@darkspot/ui/styles.css";   /* tokens + component styles */
```
```tsx
<html className="ds-root" data-theme="dark">
import { sim, silenceStep, tierGlyph, cssVar } from "@darkspot/ui";
ctx.fillStyle = sim.nodeBridge;                    // canvas
el.style.background = cssVar(`silence-${step}`);   // DOM/SVG
```

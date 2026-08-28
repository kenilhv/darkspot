# DarkSpot — design research log

Idle-time research (§7 item 3). Each entry: what was actually read, 2–3 concrete takeaways, and
what (if anything) changes in `@darkspot/ui`. No entry is a vibe; if a source could not be
fetched it says so.

---

## 2026-08-28 · Sequential colour maps — is the "dusk" silence ramp scientifically sound?

**Read:** Crameri, Shephard & Heron, *The misuse of colour in science communication*, Nature
Communications 11:5444 (2020), doi:10.1038/s41467-020-19160-7 (open-access copy read at
PMC7595127; the nature.com URL redirects to a login wall).

Criteria the paper sets for a scientifically-derived colour map: (1) **perceptual uniformity** —
"a perceptually uniform colour map weights the same data variation equally all across the
dataspace"; (2) **perceptual ordering** — colours can be "sequentially ordered effortlessly without
consulting the colour bar"; (3) **CVD-friendly** — maps "that include both red and green colours
with similar lightness cannot be read by a large fraction of the readership" (~8 % of men);
(4) **greyscale-readable** — "an even, monotonic lightness gradient". Rainbow/jet fails because
"the yellow is the brightest colour and attracts the eye the most" mid-scale, distorting >7 % of
displayed variation. Named good options: viridis/magma/plasma/inferno, cividis, cmocean, Scientific
Colour Maps (batlow, lajolla, …).

**Measured our ramp against it** (`node` over `packages/ui/tokens.json`, WCAG relative luminance
→ CIE L\*):

| step | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|
| L\* | 95.2 | 86.9 | 74.0 | 59.4 | 42.3 | 25.5 | 10.8 |
| ΔL\* to next | 8.3 | 12.9 | 14.5 | 17.1 | 16.8 | 14.7 | — |

Takeaways:
1. **Ordering, CVD and greyscale: pass.** Lightness is strictly monotonic, one hue family
   (no red–green pair), so the ramp reads in greyscale and under deuteranopia/protanopia.
2. **Uniformity: not quite.** ΔL\* runs 8.3 → 17.1 — the pale end (0→1, "<1 h" vs "1–3 h") is
   half as distinguishable as the middle. Perceptually the ramp over-emphasises 6–48 h and
   under-emphasises the first hours. Target for a respacing: ~14 L\* per step (95 → 11 over 6
   steps).
3. **Do not change it during the demo lock.** SWARM's `swarm/web/sim.js` embeds a mirror of
   `tokens.json` with a drift test (`test/tokens.test.js`); a ramp change now would fail their
   suite mid-lock. Filed as the first post-lock DESIGN unit: respace dusk-1/2 lighter-to-darker so
   ΔL\* is ≈ even, re-run `check-contrast` (ink-on-low must still hold on steps 0–3) and
   `export-tokens`, then ask SWARM to refresh its mirror.

## 2026-08-28 · OCHA humanitarian mapping conventions — what actually applies to us

**Read:** OCHA IM Toolbox, *Maps / Infographics* (knowledge.base.unocha.org, wiki page
2419916923) and *Mapping* (humanitarian.atlassian.net, page 2209349672); UN-OCHA
`humanitarian-icons` GitHub README; the OCHA Graphics Stylebook (ReliefWeb, 2018) is flagged
by OCHA itself as outdated with current guidance moved to brand.unocha.org — that site's
data-visualization page returned 404, and ReliefWeb returned 403 to the fetcher, so no colour
values were obtained from OCHA sources. The `ochathemes` R package documents only palette
*names* (blue, gray, tan, red), not values. **Nothing below claims an OCHA colour rule.**

Takeaways that are actually stated in the toolbox:
1. **"Always include the important dates. In addition to the release date, also indicate a date
   when the data was acquired."** Our coordinator page prints the export timestamp; the
   `SettlementCard` prints `last_report_at`. Missing: the *data-acquired* date of the underlying
   admin/population layers (HDX `last_modified` values are in CORE's
   `data/verification/npl_hdx_load.txt`). → Post-lock: a `DataProvenance` footer component that
   takes `{layer, source, acquired, modified}` rows so every surface can carry it.
2. **Data protection:** consider whether an infographic "may accidentally reveal sensitive or
   personal data", especially with granular data; sensitive products "should be clearly labelled
   as 'Internal'". Matches Rule 2 and CHAT's casualty-withholding; our `RawReport` withheld state
   is the UI form of this. → A visible "aggregate-only view" / "verified-responder view" label
   in the page header would make the access level explicit rather than implied.
3. **Icons:** OCHA's humanitarian icon set is CC0 (SVG, UN-blue/black/white variants, font
   available) and its README states "OCHA does not intend to establish an official meaning or
   endorsement for each Humanitarian Icon." So they are safe to use for *disaster type* and
   *cluster* glyphs (flood, landslide, shelter, WASH) if a consumer wants them, but we must not
   present them as carrying official semantics — and they stay monochrome so they never compete
   with the reserved evidence colours.

**Not adopted:** OCHA's red palette. Our `ember` is reserved for hazard exposure only; a
general-purpose red would dilute it (see §6 colour-reservation decision, 13:31).

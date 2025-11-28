# Design Guidelines - Hive Resonant Brutalism

## Theme Overview

**Hive Resonant Brutalism** blends mission-control austerity with luminous honeycomb biology. Every surface should look machined from graphite, then pierced by calibrated amber energy. We show the mechanics, respect the swarm, and keep UI decisions measurable.

### Core Principles

- **Expose the assembly** – seams, rails, and frames stay visible so operators trust the structure
- **Luminous intent** – bright amber only accompanies actionable or living elements
- **Hex memory** – staggered cells, beveled hex corners, and diagonal chisels echo Hive constructs
- **Composed power** – calm graphite grounds the experience so flares feel deliberate

## Color Palette

### Primary Field
- **Obsidian Resin** – `#050708` (global background, dialogs)
- **Graphite Lattice** – `#111416` (pages, cards)
- **Basalt Alloy** – `#1F2629` (secondary panels)
- **Amber Core** – `#F5A524` (primary CTAs, live signals)
- **Honeyed Steel** – `#FFC857` (metrics, highlights)

### Accent Field
- **Signal Nectar** – `#FF8F1F` (hover/active feedback, warning emphasis)
- **Iridescent Pollen** – `#FFE9A8` (glows, indicators, tooltip fill)
- **Coolant Teal** – `#2DD4BF` (success, sync)
- **Field Violet** – `#7C5BFF` (selection, keyboard focus)

### Utility Tones
- **Alert Magma** – `#FF5C5C`
- **Stability Chlorophyll** – `#8EDB5D`
- **Muted Graph** – `#6B7280` (copy, subtitles)

Keep amber against near-black for brand contrast; dilute only inside large gradients or glow halos.

## Typography

### Hierarchy
- Headings: uppercase, 600 weight, tracking 0.08em; sizes step by powers of two (32 / 64 / 128)
- Body: 16px base, line-height 1.55, 400 weight; sans serifs with sharp joins (Space Grotesk, Suisse Int'l)
- System/Code: monospaced with translucent amber backdrop (`rgba(245,165,36,0.08)`)

### Rules
- Straight terminals, no rounded fonts
- Underlines become baseline rails: 2–3px amber lines spanning text width
- Numeric data uses tabular figures and can tint amber at 70% opacity for emphasis

## Layout System

### Grid
- 12-column grid up to 1120px, base unit 8px, gutters 24px desktop / 16px mobile
- Vertical rhythm snaps to 72px to reinforce construct scale

### Structural Moves
- Offset sections ±1 column to mimic staggered combs
- Use stacked slabs separated by 3px gaps; surfaces should feel rack-mounted
- Apply honeycomb masks or diagonal slices to hero bands and data visualizations

## Visual Elements

### Frames & Dividers
- Standard border weight 3px, hero shells 5px
- Colors alternate between Graphite Lattice and deep evergreen (#1B2A24) for subtle hierarchy
- Corners stay 0px; if variation is needed, bevel rather than round

### Surface Treatments
- Introduce etched-metal or carbon-weave noise <6% opacity for large slabs
- Gradient sheens travel along 45° axes only, suggesting light traveling through resin

### Light & Shadow
- Hard shadows: `2px 2px 0 rgba(0,0,0,0.6)` + `-1px -1px 0 rgba(255,143,31,0.35)`
- Glows belong to agent presence, live transcription cursors, and signal graphs only

## Interactive Elements

### Buttons
- 3px border, zero radius, uppercase copy
- Default: graphite fill + amber outline; hover swaps fill/outline; active adds 1px inner stroke of Signal Nectar
- Disabled retains structure (border visible) but dims fill to `#2A2F32`

### Form Inputs
- Thick borders with inset labels; focus adds Field Violet outline with amber caret
- Errors flip border to Alert Magma, success uses Coolant Teal

### Navigation
- Global nav uses 4px bottom rail that animates linearly left→right
- Vertical nav relies on 3px leading bar + honeycomb bullet for active entry
- Mobile nav slides from left with 5px amber spine; no opacity fades

## Animation & Motion

- Motions are mechanical: 120–160 ms, linear timing, single-axis translations
- Loading uses scanning amber rails or pulsing hex cells
- No bounce/spring; treat transitions like servo commands

## Iconography

- 2px stroke, squared caps, geometric primitives (hex, chevron, coil)
- Filled icons reserved for destructive/critical confirmations

## Responsive Design

### Breakpoints
- Mobile < 768px, Tablet 768–1200px, Desktop > 1200px

### Mobile Adjustments
- Stack columns with 24px separators; reduce borders to 2px but keep amber edges
- Preserve primary CTA color hierarchy even when buttons expand full-width

## Component Integration with shadcn/ui

- Define CSS variables (`--hive-bg`, `--hive-amber`, `--hive-border`) and map shadcn themes to them
- Use `cva` variants to swap intent colors; destructive becomes Alert Magma, neutral stays Graphite
- Dialogs gain double frames (outer obsidian, inner amber inset)
- Sheets/sidebars animate with `translateX` only; keep transitions linear

## Accessibility

- Maintain at least 4.5:1 contrast; amber (#F5A524) on graphite (#111416) hits 7+:1
- Focus outlines: 3px Field Violet halo + 1px amber inset for clarity
- Provide aria-labels referencing constructs/workspaces so assistive tech matches vocabulary

## Brand Voice & Tone

- Direct, confident, assembly-first language
- Reference constructs, swarms, scaffolds when naming UI or writing helper copy
- Pair technical brevity with biological metaphors (“ignite swarm”, “stabilize hatch”)

## Inspiration & References

- Honeycomb frames, stainless lab racks, NASA flight directors, lava lamps frozen mid-glow
- Materials: obsidian slabs, molten amber, carbon fiber, pollen dust, radio stack schematics

Use this document whenever designing or reviewing UI. If pixels drift from these rules, update the theme or adjust the spec here first so humans and agents remain aligned.
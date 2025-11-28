# Design Guidelines - Hive Resonant Brutalism

## Theme Overview

**Hive Resonant Brutalism** fuses mission-control hardware with luminous honeycomb biology. We frame every screen as a control slab carved from graphite, then inject radiant amber energy through seams, glyphs, and telemetry. Interfaces should feel engineered, ritualistic, and alive with signal flow.

### Core Principles

- **Visible circuits** – expose rails, seams, and power traces; the structure is the ornament
- **Luminous cores** – reserve bright amber for intent, status, and AI presence
- **Hexagonal memory** – repeat honeycomb silhouettes, overlays, and staggered columns to suggest cell clusters
- **Industrial calm** – keep surfaces matte and confident so the energy accents stay intentional

## Color Palette

### Primary Field
- **Obsidian Resin** – `#050708` (base canvas, modal chrome)
- **Graphite Lattice** – `#111416` (page bodies, cards, shell)
- **Basalt Alloy** – `#1f2629` (panels, secondary containers)
- **Amber Core** – `#F5A524` (primary actions, live signals)
- **Honeyed Steel** – `#FFC857` (secondary highlight, badges, metrics)

### Accent Field
- **Signal Nectar** – `#FF8F1F` (hover/press states, warning emphasis)
- **Iridescent Pollen** – `#FFE9A8` (soft glows, tooltips, halos)
- **Coolant Teal** – `#2DD4BF` (success, sync indicators, neutral CTAs)
- **Field Violet** – `#7C5BFF` (selection outlines, AI handoff states)

### Utility Tones
- **Alert Magma** – `#FF5C5C`
- **Stability Chlorophyll** – `#8EDB5D`
- **Muted Graph** – `#6B7280` (copy, secondary icons)

Always pair luminous hues with deep graphite; amber without darkness loses the Hive signature contrast.

## Typography

### Hierarchy
- **Headings** – uppercase, tracking 0.08em, 600 weight; sizes follow 16 × 2ⁿ (32 / 64 / 128)
- **Body** – 16px base, 1.55 line-height, 400 weight; prefer sharp grotesks (e.g., Space Grotesk, Suisse Int'l)
- **Code / system text** – mono with subtle translucent background `rgba(255,200,87,0.08)`

### Typographic Rules
- No rounded terminals; prefer straight spines and cut joins
- Underlines act as baselines (2px) rather than text decoration
- Numeric data uses tabular figures and can carry amber tint at 70% opacity

## Layout System

### Grid
- 12-column grid, 1120px max content width
- Base unit: 8px with 24px gutters on desktop / 16px on mobile
- Vertical rhythm snaps to 72px to keep cells feeling monolithic

### Structural Rules
- Break symmetry intentionally by offsetting sections ±1 column to echo staggered comb cells
- Stack panels with 3px separators to mimic rack-mounted instrumentation
- Allow honeycomb overlays (SVG or CSS masks) to clip hero regions or timeline backgrounds

## Visual Elements

### Frames & Dividers
- Border weight: 3px default, 5px for marquee containers
- Border colors alternate between `#111416` and `#284334` to keep depth subtle
- Corners remain 0px; if curvature is required for hardware metaphors, bevel rather than round

### Surfaces & Texture
- Deploy low-frequency noise or etched metal textures at <6% opacity inside hero slabs
- Use gradient sheens only along diagonal axes to suggest injected light

### Light & Shadow
- Shadows are hard, dual-offset: `2px 2px 0 rgba(0,0,0,0.6)` + `-1px -1px 0 rgba(255,143,31,0.35)` to simulate reflected amber
- Glow effects belong exclusively to live data, typing cursors, and agent avatars

## Interactive Elements

### Buttons
- Rectilinear frames with 3px border and 0 radius
- Default: Graphite fill, amber border; Hover: amber fill, obsidian text; Active: invert plus 1px inner stroke of Signal Nectar
- Disabled states desaturate to `#2A2F32` but keep border for clarity

### Form Inputs
- Thick border (3px) with inset label bars; focus introduces Field Violet outline + amber caret
- Validation uses Alert Magma borders plus inline diagnostic copy in Muted Graph

### Navigation
- Global nav uses bottom underline (4px) that animates linearly left→right; no easing
- Vertical nav/outliner uses 3px leading bar plus honeycomb bullet for active node
- Mobile: slide-out sheet with 5px left border and darkened scrim

## Animation & Motion

### Behavior Rules
- Motions are servo-like: 120ms linear, 0ms delay, single axis per action
- Loading indicators use pulsing hex cells or sweeping amber lines across a rail
- Avoid bounce, spring, or opacity-only transitions; every movement should imply machinery

## Iconography

- Stroke-based, 2px weight, squared caps
- Geometric primitives (hex, chevron, coil) referencing cells, swarms, or instrumentation
- Fill icons only for destructive or confirm actions to differentiate from outline-heavy rest of system

## Responsive Design

### Breakpoints
- Mobile < 768px, Tablet 768–1200px, Desktop > 1200px

### Mobile Behavior
- Collapse double-column layouts into stacked slabs with 24px separators
- Reduce border weight to 2px while preserving accent bars
- Keep amber reserved for the primary CTA even on constrained layouts

## Component Integration with shadcn/ui

- Extend tokens via CSS vars: `--hive-bg`, `--hive-amber`, `--hive-border`
- Override shadcn components with `cva` variants that swap borders for each intent (neutral/primary/destructive)
- Dialogs use double frames: outer obsidian container + inner amber rail (`box-shadow: inset 0 0 0 3px #F5A524`)
- Sheets/sidebars should animate linearly with `transform: translateX()` and no opacity fade

## Accessibility

- Maintain 4.5:1 contrast minimum; amber on graphite typically meets 7:1
- Focus outlines: 3px Field Violet ring + 1px amber inset to stay on-brand
- Screen-reader regions should describe cell lineage (“Hive workspace sidebar”, “Agent pulse stream”)

## Brand Voice & Tone

- **Direct** – issue commands, not suggestions
- **Assembly-minded** – reference cells, swarms, scaffolds
- **Confident** – short clauses, assertive verbs, avoid filler
- **Technical poetry** – combine engineering language with biological cues (e.g., “ignite the swarm channel”)

## Inspiration & References

- James Turrell light chambers, NASA mission control, stainless lab hardware
- Honeycomb cores, microchip traces, beekeeping frames, radio stack schematics
- Mood board keywords: obsidian slab, molten amber, carbon weave, servo indicator, pollen flare

This Hive system ensures every UI surface feels like part of the same cell assembly: austere graphite shells lit by intelligent amber energy, disciplined enough for operators yet evocative enough for agents.
# Design Guidelines - Forest Brutalism

## Theme Overview

**Forest Brutalism** combines raw, brutalist architectural principles with organic forest elements. This creates a unique aesthetic that's both stark and natural, digital and primal.

### Core Philosophy

- **Raw honesty** - Show the structure, don't hide it
- **Organic geometry** - Angular forms meet natural textures
- **Monolithic presence** - Bold, unapologetic interfaces
- **Forest integration** - Nature as structural element, not decoration

## Color Palette

### Primary Colors
- **Deep Forest Green** - `#1a2f1a` (backgrounds, heavy elements)
- **Shadow Evergreen** - `#284334` (accents, borders)
- **Moss Green** - `#4a5d4a` (secondary elements)
- **Stone Gray** - `#6b7280` (neutral elements)

### Accent Colors
- **Sap Green** - `#5a7c5a` (interactive elements)
- **Fern Green** - `#6b8e6b` (hover states)
- **Lichen** - `#8b9d8b` (disabled states)

## Typography

### Hierarchy
- **Headings**: Bold, uppercase, letter-spacing: 0.05em
- **Body**: Regular, 16px base, line-height: 1.6
- **Code**: Monospace, subtle background

### Brutalist Typography Rules
- **No rounded fonts** - Sharp, angular characters only
- **High contrast** - Minimum 7:1 contrast ratio
- **Uniform weight** - Primarily 400/600 weights
- **Systematic sizing** - Powers of 2: 16px, 32px, 64px, 128px

## Layout Principles

### Grid System
- **Base unit**: 8px grid
- **Container max-width**: 1400px
- **Gutter**: 24px (desktop), 16px (mobile)
- **Section spacing**: 64px vertical rhythm

### Brutalist Layout Rules
- **Asymmetry preferred** - Break symmetry intentionally
- **Heavy borders** - 2-4px borders on structural elements
- **Overlapping elements** - Layers that intersect
- **Negative space** - Generous whitespace as design element

## Visual Elements

### Borders & Dividers
- **Weight**: 2px minimum, 4px for structural elements
- **Style**: Solid only (no dashed/dotted)
- **Color**: Shadow Evergreen (`#284334`) or Stone Gray (`#6b7280`)
- **Corners**: 0px radius (no rounding)

### Shadows
- **Hard shadows** - No blur, sharp offset
- **Single direction** - Primarily bottom-right
- **High contrast** - `rgba(0,0,0,0.3)` minimum
- **Layered shadows** - Multiple hard shadows for depth

### Textures & Patterns
- **Wood grain** - Subtle organic textures
- **Leaf patterns** - Geometric leaf silhouettes
- **Rock textures** - Rough, stone-like surfaces
- **Grid overlays** - Subtle grid patterns

## Interactive Elements

### Buttons
- Heavy borders, no radius
- Uppercase text, letter-spacing
- Hard shadow on hover
- Mechanical movement (no easing)

### Form Elements
- Thick borders, no radius
- Raw appearance
- Focus states with border color change
- High contrast validation states

### Navigation
- **Horizontal**: Heavy underline on active items
- **Vertical**: Left border accent on active items
- **Mobile**: Slide-out with heavy border

## Animation & Transitions

### Principles
- **Mechanical movement** - Linear transitions, no easing
- **Abrupt changes** - Quick, noticeable state changes
- **Structural animation** - Elements move as solid blocks
- **No micro-interactions** - Avoid subtle, playful animations

## Iconography

### Style
- **Geometric** - Sharp, angular icons
- **Monoline** - Consistent stroke width
- **Minimal** - Simple, recognizable shapes
- **Forest-themed** - Leaves, trees, rocks, tools

## Responsive Design

### Breakpoints
- **Mobile**: < 768px
- **Tablet**: 768px - 1024px  
- **Desktop**: > 1024px

### Mobile Adaptations
- **Stacked layouts** - Vertical stacking on mobile
- **Touch targets** - Minimum 44px
- **Simplified borders** - Reduce visual complexity
- **Maintain brutalism** - Don't soften the aesthetic

## Component Integration with shadcn/ui

This design system extends **shadcn/ui** components with forest brutalism styling:

### Core Components
- **Card**: Override with heavy borders, no radius, hard shadows
- **Button**: Override with uppercase text, hard shadow on hover
- **Input**: Override with thick borders, raw appearance
- **Dialog/Modal**: Override with heavy frame styling
- **Sheet/Sidebar**: Override with thick border, slide animation

### Implementation Approach
- Use shadcn/ui as the base component library
- Apply forest brutalism theming via CSS custom properties
- Override component variants using `class-variance-authority` (cva)
- Maintain shadcn/ui's accessibility and functionality

## Accessibility

### Requirements
- **WCAG AA**: Minimum 4.5:1 for normal text
- **WCAG AAA**: Minimum 7:1 for enhanced contrast
- **Focus management**: Visible focus indicators, logical tab order
- **Screen readers**: Semantic HTML, meaningful ARIA labels

### Focus States
- High contrast outlines (2px minimum)
- Clear visual feedback for keyboard navigation
- Maintain brutalist aesthetic while ensuring accessibility

## Brand Voice & Tone

- **Direct**: Clear, straightforward language
- **Confident**: Bold statements, no hedging
- **Hive**: References to constructs, assembly, orchestration
- **Technical**: Precise, architectural terminology

## Inspiration & References

### Architectural References
- **Brutalist Websites**: brutalistwebsites.com
- **Forest Architecture**: Tadao Ando's concrete forest works
- **Natural Brutalism**: Peter Zumthor's thermal baths

### Mood Board Elements
- **Concrete textures** - Raw, unfinished surfaces
- **Tree cross-sections** - Growth rings as patterns
- **Geometric leaves** - Stylized natural forms
- **Rock formations** - Angular, solid structures

This design system provides the foundation for building consistent, brutalist forest-themed interfaces that are both visually striking and functionally robust while integrating seamlessly with shadcn/ui components.
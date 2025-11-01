# Design Guidelines - Synthetic Biology Minimalism

## Theme Overview

**Synthetic Biology Minimalism** combines clean, minimalist technical interfaces with engineered biological elements. This creates a unique aesthetic that's both precise and organic, computational and bio-crafted.

### Core Philosophy

- **Minimalist precision** - Clean, functional base design
- **Bio-engineered flair** - Strategic biological decorative elements
- **Synthetic authenticity** - Artificial systems with organic inspiration
- **Laboratory aesthetic** - Clean, controlled, purposeful design

## Color Palette

### Primary Colors
- **Laboratory Silver** - Pure greys (0 chroma) for clean technical base
- **Engineered Green** - Bio-engineered green accents for synthetic elements
- **Sterile White** - Clean backgrounds and negative space
- **Carbon Grey** - Dark technical elements and borders

### Accent Colors
- **DNA Green** - Bright bio-engineered green for interactive elements
- **Cellular Green** - Medium green for hover states and secondary actions
- **Petri Dish Green** - Subtle green for muted and disabled states

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
- **Color**: Bark Brown (`#3d2817`) or Stone Gray (`#6b7280`)
- **Corners**: 0px radius (no rounding)

### Shadows
- **Hard shadows** - No blur, sharp offset
- **Single direction** - Primarily bottom-right
- **High contrast** - `rgba(0,0,0,0.3)` minimum
- **Layered shadows** - Multiple hard shadows for depth

### Textures & Patterns
- **Microscopic patterns** - Subtle cellular structures
- **DNA helix motifs** - Geometric biological patterns
- **Petri dish textures** - Clean, circular organic forms
- **Grid overlays** - Laboratory measurement grids
- **Cellular borders** - Bio-engineered corner and edge treatments

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

This design system extends **shadcn/ui** components with synthetic biology styling:

### Core Components
- **Card**: Clean minimalist with subtle cellular corner accents
- **Button**: Minimalist design with bio-engineered hover states
- **Input**: Clean laboratory aesthetic with precise borders
- **Dialog/Modal**: Clean frame with optional DNA helix border treatment
- **Sheet/Sidebar**: Minimalist slide with subtle biological pattern accents
- **Header**: Clean navigation with strategic bio-flair elements (DNA borders, cellular patterns)

### Implementation Approach
- Use shadcn/ui as the base component library
- Apply synthetic biology theming via CSS custom properties
- Override component variants using `class-variance-authority` (cva)
- Add bio-flair decorative elements strategically (headers, borders, accents)
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
- **Synthetic**: References to constructs, assembly, orchestration
- **Technical**: Precise, architectural terminology

## Inspiration & References

### Architectural References
- **Brutalist Websites**: brutalistwebsites.com
- **Forest Architecture**: Tadao Ando's concrete forest works
- **Natural Brutalism**: Peter Zumthor's thermal baths

### Mood Board Elements
- **Laboratory equipment** - Clean, precise instruments
- **Microscopic imagery** - Cellular structures, DNA sequences
- **Petri dishes** - Circular organic forms in controlled environments
- **Genetic sequences** - Patterned biological data visualizations
- **Bio-luminescence** - Soft organic glows and highlights

This design system provides the foundation for building consistent, synthetic biology-themed interfaces that are both minimalist clean and organically inspired while integrating seamlessly with shadcn/ui components.
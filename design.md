# Synthetic Biology Design System

## Overview

Synthetic Biology Minimalism combines clean laboratory precision with engineered biological accents. The aesthetic maintains brutalist structural honesty while introducing organic, synthetic patterns that evoke genetic engineering and microscopic cellular structures.

**Core Philosophy**: Minimalist precision meets bio-engineered flair

## Color Palette

### Primary Colors (OKLCH Format)
```css
/* Light Mode */
--background: oklch(0.96 0 0);           /* Sterile white */
--foreground: oklch(0.15 0 0);           /* Deep black */
--card: oklch(0.92 0 0);                /* Light grey */
--primary: oklch(0.35 0.1 145);          /* DNA green */
--accent: oklch(0.45 0.12 145);          /* Cellular green */
--border: oklch(0.2 0 0);               /* Dark grey */

/* Dark Mode */
--background: oklch(0.1 0 0);            /* Laboratory black */
--foreground: oklch(0.92 0 0);           /* Clean white */
--card: oklch(0.13 0 0);               /* Dark grey */
--primary: oklch(0.55 0.1 145);         /* Bright DNA green */
--accent: oklch(0.55 0.12 145);         /* Bright cellular green */
```

### Color Usage
- **Base**: Laboratory silver/grey (clean, technical, precise)
- **Interactive**: DNA green (bio-engineered, vibrant, synthetic)
- **Accents**: Cellular green (organic but controlled)
- **Patterns**: Microscopic (subtle, scientific, technical)

## Typography

### Font Stack
```css
--font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
--font-mono: "Roboto Mono", monospace;
--font-serif: "Playfair Display", serif;
```

### Typography Rules
- **Headings**: Bold, uppercase, letter-spacing: 0.05em
- **Body**: Regular, 16px base, line-height: 1.6
- **Code**: Monospace, subtle background
- **Brutalist**: No rounded fonts, sharp angular characters
- **High Contrast**: Minimum 7:1 contrast ratio

## Layout Principles

### Grid System
- **Base unit**: 8px grid
- **Container max-width**: 1400px
- **Gutter**: 24px (desktop), 16px (mobile)
- **Section spacing**: 64px vertical rhythm

### Brutalist Layout Rules
- **Asymmetry preferred** - Break symmetry intentionally
- **Heavy borders** - 2px minimum on structural elements
- **Overlapping elements** - Layers that intersect
- **Negative space** - Generous whitespace as design element

## Bio-Flair Components

### 1. DNA Helix Border Pattern
Animated gradient pattern simulating DNA sequence movement.

```css
.dna-helix-border {
  background: linear-gradient(
    90deg,
    transparent 0%,
    transparent 10%,
    oklch(var(--accent) / 0.3) 10%,
    oklch(var(--accent) / 0.3) 15%,
    transparent 15%,
    transparent 25%,
    oklch(var(--accent) / 0.5) 25%,
    oklch(var(--accent) / 0.5) 30%,
    transparent 30%,
    transparent 40%,
    oklch(var(--accent) / 0.3) 40%,
    oklch(var(--accent) / 0.3) 45%,
    transparent 45%,
    transparent 55%,
    oklch(var(--accent) / 0.5) 55%,
    oklch(var(--accent) / 0.5) 60%,
    transparent 60%,
    transparent 70%,
    oklch(var(--accent) / 0.3) 70%,
    oklch(var(--accent) / 0.3) 75%,
    transparent 75%,
    transparent 85%,
    oklch(var(--accent) / 0.5) 85%,
    oklch(var(--accent) / 0.5) 90%,
    transparent 90%,
    transparent 100%
  );
  background-size: 20px 100%;
  animation: dna-flow 8s linear infinite;
}

@keyframes dna-flow {
  0% { background-position: 0% 0%; }
  100% { background-position: 100% 0%; }
}
```

### 2. Cellular Corner Accents
Subtle circular accents that appear on hover, representing cellular structures.

```css
.cellular-corner {
  position: absolute;
  width: 8px;
  height: 8px;
  background: radial-gradient(
    circle,
    oklch(var(--accent) / 0.8) 30%,
    transparent 70%
  );
  border-radius: 50%;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.group:hover .cellular-corner {
  opacity: 1;
}
```

### 3. Microscopic Background Pattern
Subtle radial gradients representing microscopic cellular structures.

```css
.microscopic-pattern {
  background-image:
    radial-gradient(
      circle at 20% 50%,
      oklch(var(--muted) / 0.4) 0%,
      transparent 2px
    ),
    radial-gradient(
      circle at 80% 80%,
      oklch(var(--muted) / 0.3) 0%,
      transparent 1.5px
    ),
    radial-gradient(
      circle at 40% 20%,
      oklch(var(--muted) / 0.5) 0%,
      transparent 1px
    );
  background-size:
    60px 60px,
    40px 40px,
    30px 30px;
}
```

### 4. Petri Dish Hover Effect
Circular glow effect simulating petri dish illumination.

```css
.petri-hover:hover {
  box-shadow:
    0 0 0 1px oklch(var(--accent) / 0.2),
    0 0 12px oklch(var(--accent) / 0.1);
  border-radius: 6px;
}
```

## Component Implementation

### Header Bio-Flair
- Clean laboratory silver/grey navigation bar
- DNA helix pattern along bottom border (animated)
- Subtle microscopic pattern in background
- Cellular accent on logo and interactive controls

### Card Bio-Flair
- Minimalist grey card with clean borders
- Small cellular corner accents on hover
- Subtle hover state with soft bio-luminescence

### Button Bio-Flair
- Clean minimalist button design
- Petri dish circular hover effect
- DNA green accent on primary/interactive buttons

### Sidebar Bio-Flair
- Clean laboratory aesthetic
- Subtle vertical DNA pattern integration
- Cellular accents on section headers

## Visual Elements

### Borders & Dividers
- **Weight**: 2px minimum, 4px for structural elements
- **Style**: Solid only (no dashed/dotted)
- **Color**: Dark grey or accent colors
- **Corners**: 0px radius (no rounding)

### Shadows
- **Hard shadows** - No blur, sharp offset
- **Single direction** - Primarily bottom-right
- **High contrast** - `rgba(0,0,0,0.3)` minimum
- **Layered shadows** - Multiple hard shadows for depth

### Animation & Transitions
- **Mechanical movement** - Linear transitions, no easing
- **Abrupt changes** - Quick, noticeable state changes
- **Structural animation** - Elements move as solid blocks
- **No micro-interactions** - Avoid subtle, playful animations

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

## Integration with shadcn/ui

This design system extends **shadcn/ui** components with synthetic biology styling:

### Core Components
- **Card**: Override with heavy borders, no radius, microscopic patterns
- **Button**: Override with petri dish hover, DNA green accents
- **Input**: Override with thick borders, laboratory aesthetic
- **Dialog/Modal**: Override with clean frame styling
- **Sheet/Sidebar**: Override with DNA pattern integration

### Implementation Approach
- Use shadcn/ui as the base component library
- Apply synthetic biology theming via CSS custom properties
- Override component variants using `class-variance-authority` (cva)
- Maintain shadcn/ui's accessibility and functionality

## Design Principles

1. **Precision**: Clean lines, minimal decoration, laboratory precision
2. **Synthetic Organic**: Controlled biological patterns, engineered nature
3. **Laboratory Aesthetic**: Sterile, technical base environment
4. **Bio-Engineering**: DNA sequences, cellular structures, genetic manipulation
5. **Brutalist Honesty**: Show structure, don't hide implementation
6. **Controlled Asymmetry**: Intentional breaking of symmetry
7. **High Contrast**: Clear visual hierarchy, excellent readability

## Implementation Notes

- All colors use OKLCH format for better color control
- CSS custom properties for consistent theming
- Responsive design maintains brutalist aesthetic
- Accessibility integrated from the ground up
- shadcn/ui compatibility preserved
- Performance optimized with CSS animations
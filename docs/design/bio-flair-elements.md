# Synthetic Biology Design Elements

## Bio-Flair Components

### 1. DNA Helix Border Pattern
```css
.dna-helix-border {
  border-image: linear-gradient(45deg, 
    transparent 25%, 
    var(--accent) 25%, 
    var(--accent) 50%, 
    transparent 50%, 
    transparent 75%, 
    var(--accent) 75%
  ) 2;
}
```

### 2. Cellular Corner Accents
```css
.cellular-corners::before {
  content: '';
  position: absolute;
  width: 12px;
  height: 12px;
  background: radial-gradient(circle, var(--accent) 30%, transparent 70%);
}
```

### 3. Microscopic Background Pattern
```css
.microscopic-pattern {
  background-image: 
    radial-gradient(circle at 20% 50%, var(--muted) 0%, transparent 50%),
    radial-gradient(circle at 80% 80%, var(--muted) 0%, transparent 50%),
    radial-gradient(circle at 40% 20%, var(--muted) 0%, transparent 50%);
}
```

### 4. Petri Dish Hover Effect
```css
.petri-hover:hover {
  box-shadow: 
    0 0 0 2px var(--accent),
    0 0 20px rgba(var(--accent-rgb), 0.3);
  border-radius: 50%;
}
```

## Implementation Strategy

### Header Bio-Flair
- Clean silver navigation bar
- DNA helix pattern along bottom border
- Subtle microscopic pattern in background
- Cellular accent on logo/home button

### Card Bio-Flair
- Minimalist grey card
- Small cellular corner accents (top-left, bottom-right)
- Subtle hover state with soft bio-luminescence

### Button Bio-Flair
- Clean minimalist button
- Petri dish circular hover effect
- DNA green accent on active/primary buttons

### Sidebar Bio-Flair
- Clean laboratory aesthetic
- Subtle vertical DNA pattern
- Cellular accents on section headers

## Color Usage
- **Base**: Laboratory silver/grey (clean, technical)
- **Interactive**: DNA green (bio-engineered, vibrant)
- **Accents**: Cellular green (organic but controlled)
- **Patterns**: Microscopic (subtle, scientific)
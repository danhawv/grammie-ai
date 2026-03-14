# Recipe Management Application - Design Guidelines

## Design Philosophy

**Liquid Glass Design Language** - Inspired by Apple's Human Interface Guidelines

This application uses Apple's Liquid Glass design system to create a modern, mobile-first interface with translucent layered materials, icon-forward controls, and clear visual hierarchy between functional elements and content.

### Core Principles

1. **Material Layering** - Functional controls (toolbars, navigation) float above content with translucent blur effects
2. **Visual Hierarchy** - Clear separation between the functional layer and content layer
3. **Depth & Dynamism** - Content peeks through beneath functional elements for depth perception
4. **Mobile-First** - Prioritize touch-friendly interactions with 44pt minimum touch targets
5. **Icon-Forward** - Use recognizable icons instead of text labels for cleaner interface
6. **Responsive Excellence** - Seamless adaptation from mobile (320px) to desktop (1920px+)

## Liquid Glass Material System

### Material Types

**Liquid Glass (Functional Layer)**
- Purpose: Navigation bars, toolbars, floating controls
- Effect: Blur + translucency allowing content to peek through
- Variants:
  - `regular` - Blurs and adjusts luminosity for legibility (most common)
  - `clear` - Highly translucent for visually rich backgrounds (hero sections)
- Behavior: Scroll-edge effects enhance legibility as content passes beneath

**Standard Materials (Content Layer)**
- Purpose: Cards, panels, backgrounds within content area
- Effect: Subtle elevation without blur
- Variants: `thin`, `regular`, `thick` (increasing opacity/elevation)
- Usage: Recipe cards, forms, modals, content containers

### Design Rules

✅ **DO:**
- Use Liquid Glass for toolbars, navigation, floating controls
- Use standard materials for recipe cards, content panels
- Add dimming layer (35% dark opacity) when using clear Liquid Glass over bright content
- Ensure vibrant text colors on translucent backgrounds
- Test legibility on both light and dark modes

❌ **DON'T:**
- Use Liquid Glass in content layer (causes visual confusion)
- Mix Liquid Glass variants arbitrarily
- Apply blur effects to large content areas
- Nest Liquid Glass elements inside each other

### CSS Implementation

```css
/* Liquid Glass - Regular Variant */
backdrop-filter: blur(20px) saturate(180%);
background-color: rgba(255, 255, 255, 0.7); /* Light mode */
background-color: rgba(0, 0, 0, 0.6); /* Dark mode */

/* Liquid Glass - Clear Variant */
backdrop-filter: blur(12px) saturate(150%);
background-color: rgba(255, 255, 255, 0.3); /* Light mode */
background-color: rgba(0, 0, 0, 0.25); /* Dark mode */

/* Dimming Layer for Clear Variant */
background-color: rgba(0, 0, 0, 0.35);

/* Standard Material - Regular */
background-color: rgba(255, 255, 255, 0.95); /* Light mode */
background-color: rgba(0, 0, 0, 0.85); /* Dark mode */
```

## Typography

**Font Families:**
- Primary (Headings): Playfair Display or Merriweather (serif, elegant, food-editorial feel)
- Secondary (Body): Inter or Source Sans Pro (clean, readable)
- Monospace (Technical): JetBrains Mono (for cooking times, temperatures, measurements)

**Text Hierarchy on Materials:**
- Use vibrant text colors on translucent backgrounds for legibility
- Primary text: `--foreground` with high contrast
- Secondary text: `--muted-foreground` (70% opacity on light, 70% on dark)
- Tertiary text: `--muted-foreground` (50% opacity)

**Responsive Typography:**
- Recipe Titles: `text-3xl md:text-4xl` (1.875rem → 2.25rem)
- Section Headers: `text-xl md:text-2xl` (1.25rem → 1.5rem)
- Body Text: `text-base` (1rem, line-height: 1.7)
- Metadata: `text-sm` (0.875rem)
- Labels on Buttons: `text-sm font-medium` (0.875rem)

## Spacing & Layout System

### Responsive Spacing Scale

**Touch Targets (Mobile-First)**
- Minimum interactive element: `44pt` (11rem / 176px)
- Button height: `min-h-11` (44px)
- Icon button size: `w-11 h-11` (44px × 44px)
- Input fields: `min-h-11`
- List items: `min-h-12` (48px for comfortable tapping)

**Spacing Primitives:**
- Micro: `space-y-2` (0.5rem / 8px) - between related elements
- Small: `space-y-4` (1rem / 16px) - between form fields
- Medium: `gap-6` (1.5rem / 24px) - between cards in grid
- Large: `py-8` (2rem / 32px) - section padding mobile
- XLarge: `py-12 md:py-16` (3rem → 4rem) - section padding desktop

**Container Widths:**
- Full bleed: `w-full` - toolbars, hero sections
- Content max: `max-w-7xl mx-auto` (1280px) - main content
- Reading width: `max-w-4xl mx-auto` (896px) - recipe details
- Sidebar: `w-80` (320px) on desktop

### Grid System

**Recipe Grid (Responsive):**
```tsx
// Mobile-first grid
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
```

**Breakpoints:**
- Mobile: `< 640px` - Single column, sticky toolbar
- Tablet: `640px - 1024px` - 2 columns, expanded toolbar
- Desktop: `> 1024px` - 3-4 columns, full toolbar with all controls

## Component Specifications

### Toolbars (Liquid Glass)

**Top Navigation Bar:**
- Position: `fixed top-0 left-0 right-0 z-50`
- Height: `h-16` (64px) - generous for touch
- Material: Liquid Glass regular variant
- Layout: Three logical groups

```tsx
<nav className="fixed top-0 left-0 right-0 z-50 glass-regular border-b border-border/50">
  <div className="flex items-center justify-between h-16 px-4 md:px-6">
    {/* Leading: Logo, Menu */}
    <div className="flex items-center gap-3">...</div>
    
    {/* Center: Search */}
    <div className="flex-1 max-w-xl mx-4">...</div>
    
    {/* Trailing: Upload, Profile, Theme */}
    <div className="flex items-center gap-2">...</div>
  </div>
</nav>
```

**Scroll-Edge Effects:**
- Apply stronger blur when scrolled: `backdrop-blur-xl` → `backdrop-blur-2xl`
- Add subtle shadow: `shadow-sm` on scroll

### Hero Section

**Layout:**
- Height: `h-[60vh] min-h-[400px] max-h-[600px]`
- Position: `relative` with overlay
- Material: Clear Liquid Glass for text overlays

**Overlay Structure:**
```tsx
<section className="relative h-[60vh] min-h-[400px]">
  {/* Background Image */}
  <img className="absolute inset-0 w-full h-full object-cover" />
  
  {/* Dimming Layer */}
  <div className="absolute inset-0 bg-black/35" />
  
  {/* Clear Glass Content */}
  <div className="relative z-10 glass-clear">
    {/* CTA Buttons, Text */}
  </div>
</section>
```

### Icons & Buttons

**Icon-Only Buttons:**
- Size: `w-11 h-11` on mobile, `w-10 h-10` on desktop
- Use `size="icon"` variant from shadcn Button
- No text labels - rely on recognizable icons
- Always include `aria-label` for accessibility

**Icon Selection (Lucide React):**
- Search: `Search`
- Upload: `Upload` or `Plus`
- Menu: `Menu` or `AlignJustify`
- Profile: `User` or `UserCircle`
- Theme: `Sun` / `Moon`
- Filter: `SlidersHorizontal`
- More: `MoreVertical` or `MoreHorizontal`
- Share: `Share2`
- Bookmark: `Bookmark`
- Delete: `Trash2`
- Close: `X`

**Icon Styling:**
- Stroke width: `strokeWidth={2}` for consistency
- Size: `className="w-5 h-5"` (20px) inside buttons
- Color: Automatically inherits from button variant

### Filter System

**Quick Filters (Floating Bar):**
- Position: Below toolbar or as sticky element
- Material: Liquid Glass regular variant
- Layout: Horizontal scroll on mobile, wrapped on desktop

```tsx
<div className="sticky top-16 z-40 glass-regular border-b border-border/50">
  <div className="flex gap-2 overflow-x-auto px-4 py-3">
    {/* Icon-based filter chips */}
  </div>
</div>
```

**Filter Chips:**
- Inactive: `variant="outline"` with icon
- Active: `variant="default"` with accent color
- Size: `h-9` (36px) for comfortable tapping
- Icon + optional text on desktop

**Advanced Filters (Drawer):**
- Mobile: Slide-up bottom sheet with `sheet` component
- Desktop: Collapsible panel or popover
- Material: Standard material (not Liquid Glass)

### Recipe Cards

**Card Structure:**
- Material: Standard material with subtle elevation
- Aspect ratio: `aspect-[4/3]` for image
- Border: `border border-card-border`
- Radius: `rounded-xl` (0.75rem)
- Hover: `hover-elevate` for subtle lift

```tsx
<Card className="overflow-hidden hover-elevate transition-transform">
  <div className="aspect-[4/3] relative">
    <img className="object-cover w-full h-full" />
    {/* Icon actions overlay */}
  </div>
  <CardContent className="p-4">
    {/* Title, metadata */}
  </CardContent>
</Card>
```

**Icon Actions on Cards:**
- Position: `absolute top-2 right-2`
- Background: Liquid Glass clear variant for visibility
- Size: `w-9 h-9` (36px)
- Icons: Share, Bookmark, More menu

### Floating Action Button (FAB)

**Mobile Only:**
- Position: `fixed bottom-6 right-6 z-50`
- Size: `w-14 h-14` (56px) - prominent
- Material: Liquid Glass regular + accent color
- Icon: `Plus` or `Upload`
- Shadow: `shadow-lg` for depth

```tsx
<Button
  className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full glass-regular md:hidden"
  size="icon"
  aria-label="Upload recipe"
>
  <Upload className="w-6 h-6" />
</Button>
```

## Color System

**Optimized for Translucent Backgrounds**

### Light Mode
```css
--background: 0 0% 100%;
--foreground: 0 0% 9%;

/* Liquid Glass backgrounds */
--glass-bg-light: rgba(255, 255, 255, 0.7);
--glass-bg-clear-light: rgba(255, 255, 255, 0.3);

/* Vibrant text on glass */
--glass-foreground: 0 0% 5%; /* Slightly darker for contrast */

/* Primary accent (warm orange) */
--primary: 26 85% 48%;
--primary-foreground: 26 85% 98%;
```

### Dark Mode
```css
--background: 0 0% 7%;
--foreground: 0 0% 98%;

/* Liquid Glass backgrounds */
--glass-bg-dark: rgba(0, 0, 0, 0.6);
--glass-bg-clear-dark: rgba(0, 0, 0, 0.25);

/* Vibrant text on glass */
--glass-foreground: 0 0% 95%; /* Slightly lighter for contrast */

/* Primary accent (warm orange) */
--primary: 26 85% 52%;
--primary-foreground: 26 85% 98%;
```

## Interaction Patterns

**Mobile-First Interactions:**
- Tap targets: Minimum 44pt (11rem)
- Swipe gestures: For drawer dismissal, carousel navigation
- Pull-to-refresh: On recipe list
- Bottom sheets: For modals, filters on mobile
- Sticky elements: Toolbar, filter bar

**Desktop Enhancements:**
- Hover states: Subtle elevation with `hover-elevate`
- Keyboard shortcuts: Search (⌘K), Upload (⌘U)
- Multi-column layouts: Expanded grids
- Inline filters: No drawer needed
- Tooltips: On icon-only buttons

**Animation Guidelines:**
- Duration: `150ms` for micro-interactions, `300ms` for transitions
- Easing: `ease-out` for appearing, `ease-in` for disappearing
- Blur transitions: Smooth backdrop-filter changes on scroll
- Avoid: Layout shifts, jarring animations

## Accessibility

**Essential Requirements:**
- All icon buttons have `aria-label`
- Focus indicators on all interactive elements
- Contrast ratio: Minimum 4.5:1 for text on glass
- Touch targets: Minimum 44pt on mobile
- Keyboard navigation: Tab order follows visual hierarchy
- Screen reader: Semantic HTML, ARIA landmarks

**Testing Checklist:**
- ✅ VoiceOver/NVDA navigation works
- ✅ Keyboard-only navigation possible
- ✅ Color contrast validated (WebAIM tool)
- ✅ Touch targets measured (mobile device)
- ✅ Dark mode tested for legibility

## Responsive Behavior

### Mobile (< 640px)
- Single column layout
- Sticky Liquid Glass toolbar at top
- FAB for primary action (upload)
- Bottom sheet for filters
- Horizontal scroll for quick filters
- Full-width search in toolbar
- Hamburger menu for navigation

### Tablet (640px - 1024px)
- 2-column recipe grid
- Expanded toolbar with visible controls
- Side drawer for advanced filters
- Inline search bar (not full-width)
- Icon + text labels on primary actions

### Desktop (> 1024px)
- 3-4 column recipe grid
- Full toolbar with all controls visible
- Inline advanced filters (collapsible panel)
- Hover interactions enabled
- Multi-column detail layouts
- Keyboard shortcuts active

## Implementation Notes

**Component Reusability:**
- Create `<GlassSurface variant="regular|clear">` wrapper
- Build `<Toolbar leading={} center={} trailing={} />` shell
- Use `<IconButton icon={Icon} label="..." />` consistently

**Performance:**
- Lazy load recipe images
- Virtualize long lists (react-window)
- Debounce search input (300ms)
- Optimize blur effects (use sparingly)
- Preload critical fonts

**Testing Strategy:**
- Visual regression: Percy/Chromatic
- Accessibility: axe DevTools
- Responsive: BrowserStack
- Performance: Lighthouse (score > 90)
- E2E: Playwright for critical flows

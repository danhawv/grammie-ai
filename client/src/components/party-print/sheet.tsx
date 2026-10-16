import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Shared pieces for the party printables: the Letter sheet (shown scaled
// down to fit the screen, printed at full size), the three looks, and the
// print CSS that drops the app around them.

export type PrintTheme = "classic" | "modern" | "rustic";

export const THEMES: { id: PrintTheme; label: string; title: string; body: string; fonts: string[]; titleCase?: "uppercase" }[] = [
  {
    id: "classic",
    label: "Classic",
    title: "'Playfair Display', Georgia, serif",
    body: "'EB Garamond', Georgia, serif",
    fonts: ["Playfair+Display:ital,wght@0,400;0,600;0,700;1,400", "EB+Garamond:ital,wght@0,400;0,600;1,400"],
  },
  {
    id: "modern",
    label: "Modern",
    title: "'Montserrat', 'Inter', Helvetica, sans-serif",
    body: "'Inter', Helvetica, Arial, sans-serif",
    fonts: ["Montserrat:wght@300;500;600", "Inter:wght@300;400;500;600"],
    titleCase: "uppercase",
  },
  {
    id: "rustic",
    label: "Rustic",
    title: "'Dancing Script', 'Brush Script MT', cursive",
    body: "'Lora', Georgia, serif",
    fonts: ["Dancing+Script:wght@500;700", "Lora:ital,wght@0,400;0,600;1,400"],
  },
];

export function themeOf(id: PrintTheme) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

// Fonts already added to the page (same approach as the Google Fonts picker)
const loaded = new Set<string>();

/** Loads a look's Google Fonts once */
export function useThemeFonts(id: PrintTheme) {
  useEffect(() => {
    for (const spec of themeOf(id).fonts) {
      if (loaded.has(spec)) continue;
      loaded.add(spec);
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?family=${spec}&display=swap`;
      document.head.appendChild(link);
    }
  }, [id]);
}

/** CSS variables a sheet's content reads for its fonts */
export function themeVars(id: PrintTheme): CSSProperties {
  const t = themeOf(id);
  return {
    "--pp-title": t.title,
    "--pp-body": t.body,
    "--pp-title-case": t.titleCase ?? "none",
  } as CSSProperties;
}

const SHEET_PX = 8.5 * 96; // a Letter sheet's width on screen at 100%

/**
 * The sheets, scaled down together to fit the screen width (phones show a
 * whole page at a glance). Printing ignores the scale.
 */
export function SheetStack({ children, theme }: { children: ReactNode; theme: PrintTheme }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScale(Math.min(1, Math.max(0.2, (el.clientWidth - 16) / SHEET_PX)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="pp-stack mx-auto w-full max-w-[60rem] px-2 py-6 print:p-0">
      <div className="pp-zoom flex flex-col items-center gap-6" style={{ zoom: scale, ...themeVars(theme) }}>
        {children}
      </div>
    </div>
  );
}

/** One Letter page; `flow` lets a long menu run onto a second page */
export function Sheet({ children, className, flow, label }: { children: ReactNode; className?: string; flow?: boolean; label: string }) {
  return (
    <section aria-label={label} className={cn("pp-sheet", flow && "pp-sheet-flow", className)}>
      {children}
    </section>
  );
}

/**
 * Print setup: Letter, no browser margins (each sheet carries its own), only
 * the sheets print. The app header and nav are hidden by the global print
 * CSS; .no-print covers this page's toolbar.
 */
export const PRINT_CSS = `
.pp-sheet {
  width: 8.5in; height: 11in; box-sizing: border-box; overflow: hidden; position: relative;
  background: #fff; color: #1c1917; font-family: var(--pp-body);
  box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.08);
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.pp-sheet-flow { height: auto; min-height: 11in; }
.pp-title { font-family: var(--pp-title); text-transform: var(--pp-title-case); }
.pp-clamp-1, .pp-clamp-2, .pp-clamp-3 { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.pp-clamp-1 { -webkit-line-clamp: 1; }
.pp-clamp-2 { -webkit-line-clamp: 2; }
.pp-clamp-3 { -webkit-line-clamp: 3; }
.pp-cut { outline: 0.75pt dashed #b8b2ab; outline-offset: -0.375pt; }
.pp-fold { position: absolute; left: 0; right: 0; top: 50%; border-top: 0.75pt dotted #c9c3bc; }
.pp-flip { transform: rotate(180deg); }
@page { size: letter; margin: 0; }
@media print {
  html, body { background: #fff !important; padding: 0 !important; margin: 0 !important; }
  .pp-stack { max-width: none !important; padding: 0 !important; }
  .pp-zoom { zoom: 1 !important; gap: 0 !important; display: block !important; }
  .pp-sheet { box-shadow: none; break-after: page; page-break-after: always; height: 10.99in; }
  .pp-sheet-flow { height: auto; min-height: 10.9in; }
  .pp-sheet:last-child { break-after: auto; page-break-after: auto; }
}
`;

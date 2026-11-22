// The front cover of a printed cookbook, as one HTML snippet. The print
// builder shows it as a live mockup and the PDF generator prints the very
// same markup on the cover spread, so what people see is what arrives.
//
// Sizes are in inches so the snippet can be dropped into a page laid out in
// inches (the PDF) or scaled down with a CSS transform (the mockup).

export interface CoverPalette {
  /** Cover background */
  bg: string;
  /** Title color */
  text: string;
  /** Subtitle, author and small print */
  muted: string;
  /** Rules and ornaments */
  accent: string;
  titleFont: string;
  bodyFont: string;
}

const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif";
const SANS = "'Inter', -apple-system, system-ui, sans-serif";

/** One palette per built-in page style, so the cover matches the pages */
export const COVER_PALETTES: Record<string, CoverPalette> = {
  classic: { bg: "#7f1d1d", text: "#fff7ed", muted: "#fed7aa", accent: "#fdba74", titleFont: SERIF, bodyFont: SANS },
  modern: { bg: "#0f172a", text: "#ffffff", muted: "#cbd5e1", accent: "#60a5fa", titleFont: SANS, bodyFont: SANS },
  rustic: { bg: "#7c4a21", text: "#fff8eb", muted: "#f3dcc0", accent: "#f2b263", titleFont: SERIF, bodyFont: SANS },
  elegant: { bg: "#292524", text: "#fafaf9", muted: "#d6d3d1", accent: "#fb7185", titleFont: SERIF, bodyFont: SANS },
  card: { bg: "#e7efe3", text: "#1f2d1f", muted: "#4d5d4b", accent: "#5b7a52", titleFont: SERIF, bodyFont: SANS },
  heirloom: { bg: "#f4ecdc", text: "#3f2a1d", muted: "#7a5c45", accent: "#9a3412", titleFont: SERIF, bodyFont: SANS },
};

/** The palette for a style, or one built from a custom template's cover colors */
export function coverPaletteFor(
  style: string | null | undefined,
  custom?: { backgroundColor?: string | null; textColor?: string | null; titleFont?: string | null } | null,
): CoverPalette {
  const base = COVER_PALETTES[style || "classic"] || COVER_PALETTES.classic;
  if (!custom?.backgroundColor) return base;
  const text = custom.textColor || (isDark(custom.backgroundColor) ? "#ffffff" : "#1c1917");
  return {
    ...base,
    bg: custom.backgroundColor,
    text,
    muted: isDark(custom.backgroundColor) ? "rgba(255,255,255,0.78)" : "rgba(0,0,0,0.62)",
    titleFont: custom.titleFont || base.titleFont,
  };
}

/** The spine and back cover use the same background as the front */
export function coverBackground(palette: CoverPalette): string {
  return palette.bg;
}

function isDark(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface FrontCoverInput {
  title: string;
  subtitle?: string | null;
  author?: string | null;
  /** Any <img src> the renderer can load (data: URL for the PDF) */
  photoSrc?: string | null;
  palette: CoverPalette;
  /** Trim size of the front cover, inches */
  widthIn: number;
  heightIn: number;
}

/**
 * The front cover as absolutely-sized HTML (inline styles only). Text stays
 * at least 0.4in from every edge, inside Lulu's safe area.
 */
export function frontCoverHtml({ title, subtitle, author, photoSrc, palette, widthIn, heightIn }: FrontCoverInput): string {
  const p = palette;
  const short = Math.min(widthIn, heightIn);
  // Type scales with the book so a pocket book and a letter-size book both look balanced
  const titlePt = Math.max(20, Math.min(44, short * 5.4 - Math.max(0, title.length - 18) * 0.35));
  const subPt = Math.max(10, Math.min(16, short * 1.75));
  const authorPt = Math.max(8, Math.min(11.5, short * 1.3));
  const margin = Math.max(0.4, short * 0.075);
  const rule = `<div style="width:${short * 0.16}in;height:1.5pt;background:${p.accent};margin:${short * 0.03}in auto;"></div>`;
  const titleBlock = `
    <div style="font-family:${p.titleFont};font-weight:700;font-size:${titlePt}pt;line-height:1.12;color:${p.text};text-wrap:balance;">${esc(title || "Our Family Cookbook")}</div>
    ${subtitle ? `<div style="font-family:${p.titleFont};font-style:italic;font-size:${subPt}pt;line-height:1.35;color:${p.muted};margin-top:${short * 0.025}in;text-wrap:balance;">${esc(subtitle)}</div>` : ""}`;
  const authorBlock = author
    ? `<div style="font-family:${p.bodyFont};font-size:${authorPt}pt;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:${p.muted};">${esc(author)}</div>`
    : "";

  const box = `position:relative;width:${widthIn}in;height:${heightIn}in;background:${p.bg};overflow:hidden;box-sizing:border-box;`;

  if (photoSrc) {
    // Photo on top in a thin frame, words below: reads like a family album
    const photoH = heightIn * (heightIn / widthIn > 1.15 ? 0.56 : 0.5);
    return `<div style="${box}display:flex;flex-direction:column;align-items:center;text-align:center;padding:${margin}in ${margin}in ${margin * 0.9}in;">
      <div style="width:100%;height:${photoH}in;flex:none;padding:${short * 0.02}in;background:${p.bg === "#0f172a" ? "#1e293b" : "rgba(255,255,255,0.55)"};box-shadow:0 0 0 0.75pt ${p.accent}55;box-sizing:border-box;">
        <img src="${esc(photoSrc)}" style="display:block;width:100%;height:100%;object-fit:cover;" />
      </div>
      <div style="flex:1;display:flex;flex-direction:column;justify-content:center;width:100%;padding-top:${short * 0.04}in;">
        ${titleBlock}
        ${rule}
        ${authorBlock}
      </div>
    </div>`;
  }

  // No photo: a quiet, typographic cover with a frame
  return `<div style="${box}display:flex;flex-direction:column;align-items:center;text-align:center;padding:${margin}in;">
    <div style="position:absolute;inset:${margin * 0.55}in;border:0.75pt solid ${p.accent};opacity:0.55;"></div>
    <div style="position:absolute;inset:${margin * 0.55 + 0.06}in;border:0.5pt solid ${p.accent};opacity:0.3;"></div>
    <div style="margin-top:${heightIn * 0.2}in;font-family:${p.bodyFont};font-size:${authorPt * 0.85}pt;letter-spacing:0.32em;text-transform:uppercase;color:${p.muted};">A Family Cookbook</div>
    ${rule}
    <div style="padding:0 ${short * 0.04}in;">${titleBlock}</div>
    <div style="margin-top:auto;margin-bottom:${heightIn * 0.06}in;">${authorBlock}</div>
  </div>`;
}

// Splits a cookbook's Contents across pages. Shared by the printed PDF and
// the in-app preview so both break the list at the same places.

export interface TocMetrics {
  /** Usable height of a Contents page (inside its padding), in px */
  pageContentPx: number;
  /** Height of the "Contents" heading block on the first page */
  headerPx: number;
  itemPx: number;
  sectionPx: number;
}

/** Font sizes used by both renderers, from the page width in px. */
export function tocFontSizes(pageWPx: number) {
  return {
    titleSize: Math.min(22, pageWPx * 0.038),
    itemSize: Math.min(13, pageWPx * 0.021),
    numSize: Math.min(11, pageWPx * 0.017),
  };
}

export function tocMetrics(pageContentPx: number, pageWPx: number): TocMetrics {
  const { titleSize, itemSize } = tocFontSizes(pageWPx);
  return {
    pageContentPx,
    // h2 line + 8px gap + 1px rule + 28px margin; rows rounded up so
    // estimates err toward an extra page rather than clipping
    headerPx: Math.ceil(titleSize * 1.3) + 8 + 1 + 28,
    itemPx: Math.ceil(itemSize * 1.25) + 6 + 1,
    sectionPx: Math.ceil((itemSize + 2) * 1.25) + 18 + 4 + 1,
  };
}

/** Split Contents entries into pages; a section heading never ends a page. */
export function paginateToc<T extends { isSection: boolean }>(entries: T[], m: TocMetrics): T[][] {
  const pages: T[][] = [];
  let current: T[] = [];
  let used = m.headerPx;
  entries.forEach((entry, i) => {
    let need = entry.isSection ? m.sectionPx : m.itemPx;
    // Keep a heading with its first recipe
    if (entry.isSection && entries[i + 1] && !entries[i + 1].isSection) need += m.itemPx;
    if (current.length > 0 && used + need > m.pageContentPx) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(entry);
    used += entry.isSection ? m.sectionPx : m.itemPx;
  });
  if (current.length > 0) pages.push(current);
  return pages;
}

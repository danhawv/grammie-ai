# grammie.ai design and build principles

How to build features in this app. Every new screen, component and change should meet these rules. They come from the evidence in the UX research (NN/g, Baymard, WCAG 2.2, Apple HIG, Material, Google PAIR, Microsoft's Human-AI guidelines) and from the October 2026 flow review.

**Who we design for:** families, including grandparents. Many users are 65+. In NN/g's benchmark they complete about 55% of web tasks against 75% for younger adults, take about 40% longer and make twice the errors. If it works for Grandma on a phone in a kitchen, it works for everyone.

---

## 1. Ten rules

1. **The recipe comes first.** On any recipe screen, the ingredients and steps are the main content. Stories, AI extras and actions come after them or behind them.
2. **One way to do each thing.** Before building a new card, header, upload control, progress UI, dialog or setting, use the existing shared one (section 4). If it doesn't fit, extend it; don't fork it.
3. **Readable and tappable by default.** Text 16 px or larger (recipes 18 px), contrast 4.5:1 or higher, tap targets 44 px or larger (48 px in cooking mode), and every icon gets a text label.
4. **AI output is a draft.** Label it, let people review and edit it, keep the source, and never let it overwrite something a person typed (section 6).
5. **Nothing is lost.** Autosave edits. Deletes can be undone. Errors explain how to fix the problem. No action that charges money or deletes data happens on a single tap without a clear review.
6. **Say what's happening, in plain words.** "Reading Grandma's card…", not "Processing…". Name the problem and the fix: "This photo is too small to print sharply. Choose a bigger one."
7. **Show prices and dates early.** No surprise costs. Give real arrival dates, not "5–10 business days".
8. **Mobile is the main device.** Design at 390 px first. Nothing scrolls sideways, and nothing important sits under a floating button.
9. **Introduce features when they matter.** No tutorials or carousels. Empty states teach, and features appear when they become relevant.
10. **Warm, but reliable first.** Delight comes from family photos, handwriting and stories, not animation. It only lands when saving, undo and accuracy work.

---

## 2. Design tokens (use these; don't invent values)

### Type
| Use | Size | Tailwind |
|---|---|---|
| Body, form inputs, list items | 16 px | `text-base` |
| Recipe ingredients and steps, cooking mode | 18–20 px (cooking mode 22 px+) | `text-lg` / `text-xl` |
| Secondary text, captions, badges | 14 px minimum | `text-sm` |
| Never | below 12 px; `text-[9px]`/`text-[10px]` are banned | |

- **Sizes and spacing:** use `rem`, so browser zoom and the app's text-size setting work.
- **Readable layout:** keep lines under 80 characters wide, use line height 1.5 for body text, and don't justify text.
- **Fonts:** the Playfair Display serif is for page and recipe titles only; Inter is for everything else. Don't add app-wide fonts. Print templates load their own.

### Color
- **Primary** `hsl(26 85% 38%)` (#B3560F): 4.9:1 contrast on white. Use it for buttons, links and active states. The lighter orange `hsl(26 85% 48%)` is for **background tints and decoration only**, never for text or as the only signal of state.
- **Contrast:** text needs 4.5:1, or 3:1 at 18 px+ or bold. Recipe text aims for 7:1.
- **Muted text** (`text-muted-foreground`) only on text 14 px or larger that isn't needed to finish a task. Never light gray for amounts, steps or errors.
- **Color is never the only signal:** pair it with an icon or text (for example, "Doesn't fit" plus a red outline).
- **Dark mode:** check every new color in dark mode too.

### Size and spacing
- **Targets:**

  | Element | Minimum size |
  |---|---|
  | Tap target | 44 × 44 px (`h-11`, icon button `size-11`) |
  | Cooking mode and primary phone actions | 48 px |
  | Gap between adjacent targets | 8 px |

- **Primary buttons on phones:** full width at the bottom of the sheet or screen, never a small button in a corner.
- **Spacing:** use the 4 px scale (Tailwind default). Card padding is 16 px on phones and 24 px on desktop.

### Motion
- Respect `prefers-reduced-motion`: use `motion-safe:` and `motion-reduce:` variants and swap movement for fades. Never auto-play motion that loops.
- Respond to every tap within 400 ms (a pressed state or optimistic update).

---

## 3. Layout and navigation

- **One app shell.**
  - **Phone:** a bottom tab bar with five items: **Recipes · Kitchen · ＋ Add · Cookbooks · Me**.
  - **Desktop:** the same five in the top header, with text labels. Don't add destinations to the header. A new feature belongs inside one of the five areas or in a page's "…" menu.
- **Every page uses `PageHeader`:** title, an optional back link, one primary action, and a "…" menu for everything else. Don't put more than one primary (filled orange) button in view.
- **Floating buttons** (Ask Grammie, Add) must never cover content or controls. They hide on recipe, cooking, form and editor screens, or move into the header or tab bar.
- **Long pages:** use real headings (`h1`–`h3` in order) and put secondary content in collapsed sections below the main content.
- **Progressive disclosure:** at most two levels (a summary, then "More"). Advanced settings live behind "Advanced", never in the main flow.

---

## 4. Shared building blocks (create or extend these; don't duplicate)

| Need | Use | Notes |
|---|---|---|
| Page title and actions | `PageHeader` | title, back, one primary action, "…" menu |
| Showing a recipe in a list | `RecipeCard` (`compact`/`regular`) | photo, title, time · servings, contributor if it isn't the viewer; actions in "…" |
| Picking photos | `PhotoPicker` | camera + library, drag and drop, shrinks to 2400 px, handles phone photo formats, shows a thumbnail immediately |
| Background work (AI import, PDFs, placement) | `JobStatus` | progress for each item plus "3 of 12", specific status text, Retry on failure |
| Loading / empty / error | `LoadingState`, `EmptyState`, `ErrorState` | every data screen has all three (section 7) |
| Deleting | `useUndoableDelete` | delete now, show "Deleted · Undo" for 10 s; recipes go to Trash for 30 days |
| Confirming something consequential | A review screen whose button names the action and the amount ("Place order · $23.15") | no `window.confirm`, no "Are you sure? Yes/No" |
| Sheets and dialogs | shadcn `Dialog` (desktop) / `Sheet` (phone, bottom) | always has a visible title and a 44 px close button |
| Print themes | `shared/` theme definitions | the preview, editor, designer and PDF generator all read the same source |
| User preferences | the Food profile and Display settings | don't add new settings elsewhere |

When building one of these for the first time, make it the shared version in `client/src/components/` and replace the old copies.

---

## 5. Forms

- **Labels:** a visible label above every field. Placeholders are examples, not labels.
- **Markup:**
  - Use the right `type`, `inputmode` (for example `inputmode="decimal"` for amounts) and `autocomplete` (`shipping name`, `shipping address-line1`, `shipping postal-code`, `email`, `tel` and so on).
  - Turn off autocorrect and capitalization on codes, emails and URLs.
  - Wrap fields in a real `<form>` so autofill works.
- **Amounts accept fractions:** "1/2" and "1 ½" are valid.
- **Ask only what's needed.**
  - Mark optional fields "(optional)".
  - Explain sensitive fields ("Phone — only for the delivery driver").
  - Collapse rare fields (Apt/Suite) behind a link.
- **Validation:**
  - Check when the user leaves a field, not on every keystroke, and clear the error as soon as it's fixed.
  - Messages are specific, sit next to the field, and say how to fix it.
  - Pick lists replace free text when the answer set is fixed (US states, units).
- **Don't ask twice:** never ask for information the app already has (WCAG 3.3.7). Prefill it.

---

## 6. AI features

Every AI feature (import, enrichment, nutrition, tips, chapters, templates, chat, photo placement) follows these rules:

1. **Label it.** Use the "Estimated by AI" / "Suggested by Grammie" wording. Style AI content differently from family-written content.
2. **Draft, then confirm.** AI output that becomes saved data goes through a review step the user can edit.
   - For imports, show the original photo next to the extraction, highlight only the fields likely to need fixing (fractions, units, temperatures, unclear words) and include one "Check the amounts" confirmation.
   - Don't show confidence percentages.
3. **Keep the source.** Store the original photo, link or text permanently, so it can be shown, re-read and printed.
4. **Never overwrite a person.** Re-running AI fills only empty fields. Anything a user typed or confirmed wins.
5. **Easy to undo or redo.** Every AI result offers Edit, Undo and Try again next to it.
6. **No safety claims.** No "allergen-free", medical or health guarantees from AI. Say "May contain: peanuts (from ingredients)" and leave the decision to the user.
7. **No made-up people or quotes.** Never generate reviews, testimonials or quotes attributed to real people.
8. **Estimates look like estimates.** Round values (about 950 cal), say what they're based on, and make them editable.
9. **Long jobs run in the background.** Use `JobStatus`, let the user keep working, report each item, and give each failure a reason and a Retry.
10. **Treat AI output as untrusted input.** Validate it on the server (fonts from allowlists, hex colors, enums, contrast checks), as in `shared/template-from-photos.ts`.

---

## 7. Every screen handles all its states

| State | Must have |
|---|---|
| Loading | skeleton in the final layout (no layout shift); text if it takes more than 2 s |
| Empty | what the area is for, one primary action, optional example (see Meal Plans) |
| Error | on the page, plain words, Retry, never a stack trace or a bare "Error" toast |
| Partial | per-item status for batches (3 saved, 1 needs a look) |
| Offline/slow | cooking mode and an open recipe keep working when the connection drops |

**Toasts:** only for brief confirmations ("Saved", "Deleted · Undo"). Never the only place an error appears.

---

## 8. Money and irreversible actions

- **Before the form:** show the estimated total (print + shipping + tax) and a delivery date range.
- **Review screen:** cover, copies, address and total. The button reads **"Place order · $X"**. Disable it after the first tap, and make the server call safe to retry.
- **Afterwards:** a confirmation page with the order number and status, and the order recorded in the app.
- **No deploys mid-order:** never ship a deploy while a print order is in progress. PDFs are served from memory.

---

## 9. Accessibility checklist (WCAG 2.2 AA plus older-adult needs)

- [ ] Body text is 16 px or larger, and everything works at 200% zoom without sideways scrolling.
- [ ] Contrast is at least 4.5:1 for text and 3:1 for icons and borders that convey meaning.
- [ ] Targets are at least 44 px, and anything you can drag also has a button alternative (2.5.7).
- [ ] Every icon-only button has an `aria-label` and a visible tooltip or label; images have `alt`.
- [ ] Keyboard: everything is reachable, focus is visible and never hidden behind sticky bars (2.4.11), and clickable rows are buttons, not `div`s.
- [ ] Headings are in order, landmarks are present, and dialogs trap focus and have titles.
- [ ] Reduced motion is honored, with no flashing.
- [ ] Help is in the same place on every screen (3.2.6), and sign-in needs no memory puzzles (3.3.8).
- [ ] No time limits on reading or acting; toasts with actions stay at least 10 s.

---

## 10. Tone and family content

- **Language:** plain and warm, short sentences, everyday words ("photo", not "image asset"). Avoid jargon such as DPI, bleed and POD. Explain the effect instead ("may print blurry").
- **Credit people:** "From Grandma Jean's card". Show contributors and stories alongside recipes.
- **Grief and remembrance:** use direct, gentle wording ("died", not euphemisms). Offer an "In memory of" option that switches off celebratory copy and confetti. Never auto-generate sentiments about a person.
- **Celebrate real moments:** first recipe saved, book delivered. Keep it brief and never block the user.

---

## Before you ship: pre-merge checklist

- [ ] Used the shared components (section 4); no new duplicate card, header, upload, progress, confirm or theme.
- [ ] Checked at 390 px and on desktop: no sideways scroll, nothing covered by floating buttons, header fits.
- [ ] Type and target sizes meet section 2; all icon buttons are labeled.
- [ ] Loading, empty and error states exist (section 7).
- [ ] Deletes are undoable; consequential actions use a review screen.
- [ ] AI output is labeled, editable, keeps its source and makes no safety claims (section 6).
- [ ] Forms have labels, autocomplete and inputmode, and inline validation (section 5).
- [ ] Prices and dates are shown before commitment (if money is involved).
- [ ] Plain-language copy; specific status and error text.
- [ ] Tested signed in on production-like auth, not just with the dev bypass (`/api/auth/status` regression).
- [ ] Shared logic (print themes, layout, units) lives in `shared/` with tests; `npm test` passes.

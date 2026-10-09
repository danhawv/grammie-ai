# grammie.ai

Family recipe app and printed-cookbook builder. React + Vite client (`client/`), Express server (`server/`), shared logic and schema (`shared/`), Drizzle on Neon Postgres, deployed to Railway from `main` (GitHub auto-deploy; don't also run `railway up`).

## Before building any UI

Read and follow `docs/DESIGN_PRINCIPLES.md`. In particular:
- Use the shared building blocks it lists instead of creating new headers, cards, upload controls, progress UIs, confirmations or theme definitions.
- Text 16 px+ (recipes 18 px+), tap targets 44 px+, labeled icon buttons, primary color at 4.5:1 contrast.
- AI output: labeled, editable, keeps its source, never overwrites user input, no allergen/health claims, no invented quotes from real people.
- Every data screen has loading, empty and error states; deletes are undoable.
- Run the pre-merge checklist at the end of that document.

## Working notes

- Run `npm test` (vitest) and `npx tsc --noEmit -p .` before committing.
- The database is plain Postgres through a `pg` pool (server/pg-pool.ts); use `db.transaction` to group writes.
- Don't deploy while a print order is in flight: Lulu fetches PDFs from server memory.
- The dev server injects a fake user. Verify auth-dependent features against Clerk in production too.

import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera, CheckCircle2, ChevronDown, Copy, ImageOff, Link2, Loader2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CookbookSelect } from "@/components/cookbook-select";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/import-api";
import { uploadBackFor } from "@/lib/bulk-upload";
import { imageUrl, makeChoice, startImport, thumbUrl, type Choice, type IntakeGroup, type IntakeState } from "@/lib/bulk-api";
import { cn } from "@/lib/utils";
import { privateImageUrl, useImagePass } from "@/lib/image-pass";

// The review screen for a box of recipes (docs/BULK_IMPORT.md): what we
// found, in plain words, before anything is imported. The person can
// include or leave out any recipe, fix a front/back pairing, or add a
// missing back, then presses one button that names the count and the cost.

interface Props {
  intake: IntakeState;
  confirmAbove: number;
  onImported: () => void;
}

const titleOf = (g: IntakeGroup) => g.title || "Untitled card";

export function IntakeReview({ intake, confirmAbove, onImported }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [zoom, setZoom] = useState<{ photoId: string; title: string } | null>(null);
  const imagePass = useImagePass();
  const [choosingBackFor, setChoosingBackFor] = useState<IntakeGroup | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const key = ["/api/bulk-intake", intake.id];

  const choice = useMutation({
    mutationFn: (c: Choice) => makeChoice(intake.id, c),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: (err) => toast({ title: "That change didn't save", description: apiErrorMessage(err, "Check your connection and try again."), variant: "destructive" }),
  });

  const { groups, summary } = intake.plan;
  const est = intake.estimates.import;
  const count = summary.toImport;
  const needsConfirm = count > confirmAbove;

  const go = useMutation({
    mutationFn: () => startImport(intake.id, { cookbookId: intake.cookbookId, expectedCount: count, confirmed }),
    onSuccess: () => {
      setImportError(null);
      onImported();
    },
    onError: (err) => {
      setImportError(apiErrorMessage(err, "We couldn't start the import. Check your connection and try again."));
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const by = (s: IntakeGroup["status"]) => groups.filter((g) => g.status === s);
  const incomplete = by("incomplete");
  const ready = by("ready");
  const existing = by("existing");
  const duplicates = by("duplicate");
  const notRecipes = by("not_recipe");
  // Photos that could be someone's missing back: loose backs and things set aside
  const looseBacks = groups.filter((g) => g.photoIds.length === 1 && (g.status === "incomplete" || g.status === "not_recipe") && !g.title);

  const row = (g: IntakeGroup, extra?: ReactNode) => (
    <GroupRow
      key={g.key}
      intakeId={intake.id}
      group={g}
      busy={choice.isPending}
      onToggle={(include) => choice.mutate({ action: include ? "include" : "exclude", front: g.key })}
      onSplit={(back) => choice.mutate({ action: "unpair", back })}
      onZoom={(photoId) => setZoom({ photoId, title: titleOf(g) })}
      extra={extra}
    />
  );

  return (
    <div className="space-y-6 pb-4">
      <section className="rounded-lg border bg-card p-4 md:p-6" aria-labelledby="found-heading">
        <h2 id="found-heading" className="font-serif text-2xl font-bold">
          We found {summary.recipes} {summary.recipes === 1 ? "recipe" : "recipes"}
        </h2>
        <p className="mt-1 text-base text-muted-foreground">in {summary.photos} photos. Nothing is added until you press Import.</p>
        <ul className="mt-4 space-y-2 text-base">
          <SummaryLine icon={<CheckCircle2 className="h-5 w-5 text-green-700 dark:text-green-400" aria-hidden />}>
            {count} ready to import
          </SummaryLine>
          {summary.incomplete > 0 && (
            <SummaryLine icon={<AlertTriangle className="h-5 w-5 text-amber-700 dark:text-amber-400" aria-hidden />}>
              {summary.incomplete} look incomplete (missing a side) — held for you to check
            </SummaryLine>
          )}
          {summary.existing > 0 && <SummaryLine icon={<Copy className="h-5 w-5 text-muted-foreground" aria-hidden />}>{summary.existing} already in your {intake.cookbookId ? "cookbook" : "recipes"} — skipped</SummaryLine>}
          {summary.duplicates > 0 && <SummaryLine icon={<Copy className="h-5 w-5 text-muted-foreground" aria-hidden />}>{summary.duplicates} {summary.duplicates === 1 ? "duplicate" : "duplicates"} in this pile — skipped</SummaryLine>}
          {summary.notRecipes > 0 && <SummaryLine icon={<ImageOff className="h-5 w-5 text-muted-foreground" aria-hidden />}>{summary.notRecipes} {summary.notRecipes === 1 ? "photo isn't" : "photos aren't"} a recipe — skipped</SummaryLine>}
        </ul>
        <div className="mt-5 max-w-sm space-y-2">
          <Label className="text-base">Add them to a cookbook (optional)</Label>
          <CookbookSelect
            value={intake.cookbookId ? String(intake.cookbookId) : undefined}
            onValueChange={(v) => choice.mutate({ action: "cookbook", cookbookId: v ? Number(v) : null })}
            placeholder="Just add to my recipes"
          />
          <p className="text-sm text-muted-foreground">We'll also check that cookbook for recipes you already have.</p>
        </div>
      </section>

      {incomplete.length > 0 && (
        <Section title={`Need your help (${incomplete.length})`} defaultOpen description="These say they continue on the back (or are a back), but we couldn't find the other side. Add it, pick it from your photos, or import the side you have.">
          {incomplete.map((g) =>
            row(
              g,
              <div className="flex flex-wrap gap-2">
                <AddBackButton intakeId={intake.id} front={g} onDone={() => queryClient.invalidateQueries({ queryKey: key })} />
                {g.title && looseBacks.some((b) => b.key !== g.key) && (
                  <Button variant="outline" onClick={() => setChoosingBackFor(g)}>
                    <Link2 aria-hidden /> Choose the back
                  </Button>
                )}
              </div>,
            ),
          )}
        </Section>
      )}

      <Section title={`Ready to import (${ready.length})`} defaultOpen={ready.length <= 60} description="Untick any you don't want.">
        {ready.length ? ready.map((g) => row(g)) : <p className="text-base text-muted-foreground">None yet.</p>}
      </Section>

      {existing.length > 0 && (
        <Section title={`Already in your ${intake.cookbookId ? "cookbook" : "recipes"} (${existing.length})`} description="Skipped. Tick one to import it anyway.">
          {existing.map((g) => row(g))}
        </Section>
      )}
      {duplicates.length > 0 && (
        <Section title={`Duplicates (${duplicates.length})`} description="The same recipe appears twice; we kept the clearer copy.">
          {duplicates.map((g) => row(g))}
        </Section>
      )}
      {notRecipes.length > 0 && (
        <Section title={`Not recipes (${notRecipes.length})`} description="Photos of food, blank cards and other things. Tick one if it is a recipe.">
          {notRecipes.map((g) => row(g))}
        </Section>
      )}

      {/* Sits above the phone tab bar */}
      <p className="text-base">
        {count > 0
          ? <>Importing {count} {count === 1 ? "recipe" : "recipes"} costs {est.costText} and takes {est.timeText}. You can close this page while it runs.</>
          : "Tick at least one recipe to import."}
      </p>
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-30 -mx-4 space-y-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:bottom-0">
        {needsConfirm && count > 0 && (
          <label className="flex min-h-11 items-center gap-3 text-base">
            <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} className="h-6 w-6" />
            Yes, add all {count} recipes
          </label>
        )}
        {importError && <p className="text-base text-destructive" role="alert">{importError}</p>}
        <Button
          className="h-12 w-full text-base md:w-auto"
          disabled={count === 0 || (needsConfirm && !confirmed) || go.isPending || choice.isPending}
          onClick={() => go.mutate()}
          data-testid="button-import-bulk"
        >
          {go.isPending && <Loader2 className="motion-safe:animate-spin" aria-hidden />}
          Import {count} {count === 1 ? "recipe" : "recipes"} · {est.costText}
        </Button>
        {count > 0 && <p className="text-sm text-muted-foreground">Takes {est.timeText}. You can close this page while it runs.</p>}
      </div>

      <Dialog open={!!zoom} onOpenChange={(o) => !o && setZoom(null)}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>{zoom?.title}</DialogTitle>
          <DialogDescription className="sr-only">The photo, larger</DialogDescription>
          {zoom && <img src={privateImageUrl(imageUrl(intake.id, zoom.photoId), imagePass)} alt={zoom.title} className="max-h-[70vh] w-full rounded-md object-contain" />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!choosingBackFor} onOpenChange={(o) => !o && setChoosingBackFor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>Which photo is the back of “{choosingBackFor ? titleOf(choosingBackFor) : ""}”?</DialogTitle>
          <DialogDescription className="text-base">These photos have no recipe name, so one of them may be the other side.</DialogDescription>
          <ul className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
            {looseBacks.filter((b) => b.key !== choosingBackFor?.key).map((b) => (
              <li key={b.key}>
                <button
                  type="button"
                  className="w-full overflow-hidden rounded-lg border text-left hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  onClick={() => {
                    choice.mutate({ action: "pair", front: choosingBackFor!.key, back: b.key });
                    setChoosingBackFor(null);
                  }}
                >
                  <img src={privateImageUrl(thumbUrl(intake.id, b.key), imagePass)} alt="A card with no recipe name" loading="lazy" className="aspect-[3/4] w-full bg-muted object-contain" />
                  <span className="block p-2 text-sm">Use this one</span>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryLine({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

function Section({ title, description, defaultOpen = false, children }: { title: string; description?: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <section className="rounded-lg border">
        <CollapsibleTrigger className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left">
          <h3 className="text-lg font-semibold">{title}</h3>
          <ChevronDown className={cn("h-5 w-5 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 px-4 pb-4">
          {description && <p className="text-base text-muted-foreground">{description}</p>}
          <ul className="space-y-3">{children}</ul>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

function GroupRow({
  intakeId,
  group: g,
  busy,
  onToggle,
  onSplit,
  onZoom,
  extra,
}: {
  intakeId: string;
  group: IntakeGroup;
  busy: boolean;
  onToggle: (include: boolean) => void;
  onSplit: (backId: string) => void;
  onZoom: (photoId: string) => void;
  extra?: ReactNode;
}) {
  const imagePass = useImagePass();
  const title = titleOf(g);
  const id = `include-${g.key}`;
  return (
    <li className={cn("rounded-lg border bg-card p-3", g.include ? "border-primary/40" : "")}>
      <div className="flex items-start gap-3">
        <Checkbox id={id} checked={g.include} disabled={busy} onCheckedChange={(v) => onToggle(v === true)} className="mt-1 h-6 w-6" aria-label={`Import ${title}`} />
        <div className="flex shrink-0 gap-1.5">
          {g.photoIds.map((pid, i) => (
            <button key={pid} type="button" onClick={() => onZoom(pid)} className="overflow-hidden rounded-md border focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label={`See ${i === 0 ? "the front" : "the back"} of ${title} larger`}>
              <img src={privateImageUrl(thumbUrl(intakeId, pid), imagePass)} alt="" loading="lazy" className="h-16 w-14 bg-muted object-cover sm:h-20 sm:w-16" />
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="block break-words text-base font-medium">{title}</label>
          {g.photoIds.length > 1 && <p className="text-sm text-muted-foreground">Front and back, read together</p>}
          {g.reason && <p className="text-sm">{g.reason}</p>}
          {g.warnings.map((w) => (
            <p key={w} className="text-sm text-amber-800 dark:text-amber-300">{w}</p>
          ))}
        </div>
      </div>
      {(g.photoIds.length > 1 || extra) && (
        <div className="mt-3 flex flex-wrap gap-2 pl-9">
          {g.photoIds.length > 1 && (
            <Button variant="outline" disabled={busy} onClick={() => onSplit(g.photoIds[g.photoIds.length - 1])}>
              <Unlink aria-hidden /> Not the same recipe? Split
            </Button>
          )}
          {extra}
        </div>
      )}
    </li>
  );
}

function AddBackButton({ intakeId, front, onDone }: { intakeId: string; front: IntakeGroup; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  return (
    <>
      <Button variant="outline" disabled={state === "sending"} onClick={() => input.current?.click()}>
        {state === "sending" ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <Camera aria-hidden />}
        {front.title ? "Add a photo of the back" : "Add a photo of the front"}
      </Button>
      {state === "error" && <p className="w-full text-sm text-destructive" role="alert">That photo didn't upload. Try again.</p>}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setState("sending");
          try {
            await uploadBackFor(intakeId, front.key, file, front.title ? "back" : "front");
            setState("idle");
            onDone();
          } catch {
            setState("error");
          }
        }}
      />
    </>
  );
}

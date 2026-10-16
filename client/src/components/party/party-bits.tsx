import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { AlertTriangle, Check, Loader2, Plus, Trash2, Utensils, X } from "lucide-react";
import {
  COURSES,
  MAX_SLOTS,
  courseLabel,
  defaultSlots,
  type PartyCourse,
  type PartyDetail,
  type PartyDish,
  type PartySlot,
  type PartyStyle,
} from "@shared/party";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { mediaUrl } from "@/lib/platform";
import { importFailed, isImporting, scaleText } from "@/lib/party-format";
import { cn } from "@/lib/utils";

// Pieces shared by the host page, the guest page and the create walkthrough.

export const STYLE_TEXT: Record<PartyStyle, { title: string; short: string; explain: string }> = {
  dinner: {
    title: "Dinner party",
    short: "Dinner party",
    explain: "Everyone cooks for the whole table. Grammie scales each recipe up so there's enough for everyone.",
  },
  potluck: {
    title: "Potluck",
    short: "Potluck",
    explain: "Everyone brings one normal-sized dish to share. Recipes stay as written.",
  },
};

/** Big tappable on/off chips (allergies, diets) */
export function ChipToggle<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { id: T; label: string }[];
  value: T[];
  onChange: (next: T[]) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {options.map((o) => {
        const on = value.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o.id) : [...value, o.id])}
            className={cn(
              "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent",
            )}
          >
            {on && <Check className="h-4 w-4" aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Dinner party / Potluck choice with the plain explanation under each */
export function StylePicker({ value, onChange }: { value: PartyStyle; onChange: (s: PartyStyle) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Kind of party">
      {(["dinner", "potluck"] as PartyStyle[]).map((s) => {
        const on = value === s;
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(s)}
            className={cn(
              "rounded-lg border-2 p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "border-primary bg-primary/5" : "border-border hover:bg-accent/50",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-lg font-semibold">{STYLE_TEXT[s].title}</span>
              {on && <Check className="h-5 w-5 text-primary" aria-hidden />}
            </span>
            <span className="mt-1 block text-base text-muted-foreground">{STYLE_TEXT[s].explain}</span>
          </button>
        );
      })}
    </div>
  );
}

export type DraftSlot = { key: string; id?: string; course: PartyCourse; label: string };

let keySeq = 0;
export const draftKey = () => `k${++keySeq}`;

export function draftsFrom(slots: { id?: string; course: PartyCourse; label?: string | null }[]): DraftSlot[] {
  return slots.map((s) => ({ key: draftKey(), id: s.id, course: s.course, label: s.label ?? "" }));
}

export function slotsFromDrafts(drafts: DraftSlot[]) {
  return drafts.map((d) => ({ ...(d.id ? { id: d.id } : {}), course: d.course, label: d.label.trim() || null }));
}

/** The course list: each place someone can sign up for, with an optional note */
export function CourseEditor({
  value,
  onChange,
  style,
  headcount,
}: {
  value: DraftSlot[];
  onChange: (next: DraftSlot[]) => void;
  style: PartyStyle;
  headcount: number;
}) {
  const [adding, setAdding] = useState<PartyCourse>("side");
  const ordered = COURSES.flatMap((c) => value.filter((d) => d.course === c.id));
  const update = (key: string, patch: Partial<DraftSlot>) => onChange(value.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  return (
    <div className="space-y-4">
      {ordered.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-muted-foreground">No courses yet. Add one below.</p>
      ) : (
        <ul className="space-y-3">
          {ordered.map((d) => (
            <li key={d.key} className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
              <Select value={d.course} onValueChange={(v) => update(d.key, { course: v as PartyCourse })}>
                <SelectTrigger className="min-h-11 w-40" aria-label="Course">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COURSES.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                className="min-h-11 min-w-0 flex-1 basis-40"
                value={d.label}
                maxLength={60}
                placeholder="Note (optional), like “something green”"
                aria-label={`Note for this ${courseLabel(d.course).toLowerCase()}`}
                onChange={(e) => update(d.key, { label: e.target.value })}
              />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove this ${courseLabel(d.course).toLowerCase()}`} onClick={() => onChange(value.filter((x) => x.key !== d.key))}>
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={adding} onValueChange={(v) => setAdding(v as PartyCourse)}>
          <SelectTrigger className="min-h-11 w-44" aria-label="Course to add">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COURSES.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          disabled={value.length >= MAX_SLOTS}
          onClick={() => onChange([...value, { key: draftKey(), course: adding, label: "" }])}
        >
          <Plus aria-hidden /> Add
        </Button>
        <Button type="button" variant="ghost" onClick={() => onChange(draftsFrom(defaultSlots(style, headcount)))}>
          Start over with Grammie's list
        </Button>
      </div>
    </div>
  );
}

/** Where an import stands, in words */
export function ImportStatus({ dish }: { dish: PartyDish }) {
  if (isImporting(dish.recipe)) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
        {dish.recipe?.status === "enriching" ? "Almost ready…" : "Reading the recipe…"}
      </p>
    );
  }
  if (importFailed(dish.recipe)) {
    return <p className="text-sm text-destructive">We couldn't read that recipe. The dish is still on the menu.</p>;
  }
  return null;
}

export function ConflictBadges({ dish }: { dish: PartyDish }) {
  if (dish.conflicts.length === 0) return null;
  return (
    <ul className="space-y-1">
      {dish.conflicts.map((c) => (
        <li key={`${c.kind}-${c.what}`} className="flex items-start gap-1.5 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {c.message}
        </li>
      ))}
    </ul>
  );
}

/** One claimed dish: photo, title, cook, scale, conflicts, and any actions */
export function DishRow({
  dish,
  party,
  isYours,
  actions,
  href,
}: {
  dish: PartyDish;
  party: Pick<PartyDetail, "style">;
  isYours?: boolean;
  actions?: ReactNode;
  /** Where tapping the title goes (the dish's recipe) */
  href?: string;
}) {
  const img = dish.recipe?.image;
  const scale = scaleText(dish, party.style);
  return (
    <div className="flex gap-3">
      {img ? (
        <img src={mediaUrl(img)} alt="" className="h-16 w-16 shrink-0 rounded-md object-cover" loading="lazy" />
      ) : (
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-muted" aria-hidden>
          <Utensils className="h-6 w-6 text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-base font-semibold leading-snug break-words">
          {href ? <Link href={href} className="underline-offset-4 hover:underline">{dish.title}</Link> : dish.title}
        </p>
        <p className="text-sm text-muted-foreground">
          {isYours ? "You're bringing this" : `Brought by ${dish.guestName}`}
        </p>
        {dish.note && <p className="text-sm italic text-muted-foreground">“{dish.note}”</p>}
        {scale && isYours && <p className="text-sm font-medium">{scale}</p>}
        <ImportStatus dish={dish} />
        <ConflictBadges dish={dish} />
        {actions && <div className="flex flex-wrap gap-2 pt-1">{actions}</div>}
      </div>
    </div>
  );
}

export function StyleBadge({ style }: { style: PartyStyle }) {
  return <Badge variant="secondary">{STYLE_TEXT[style].short}</Badge>;
}

/** Small "×" close for dismissible notes */
export function DismissButton({ onClick, label = "Dismiss" }: { onClick: () => void; label?: string }) {
  return (
    <Button type="button" variant="ghost" size="icon" aria-label={label} onClick={onClick} className="shrink-0">
      <X aria-hidden />
    </Button>
  );
}

/** The slot's display name: "Main", or "Main: something hearty" */
export function slotName(slot: PartySlot): string {
  return slot.label ? `${courseLabel(slot.course)}: ${slot.label}` : courseLabel(slot.course);
}

import { useId, useState, type ReactNode } from "react";
import { Check, Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Small form controls for the meal-prep setup: big radio cards, a −/+ number
// stepper, toggle chips and a list-of-words input. Native inputs underneath,
// so keyboard and screen readers work without extra wiring.

export function ChoiceGroup<T extends string | number>({
  legend,
  hint,
  value,
  options,
  onChange,
  columns = 1,
}: {
  legend: ReactNode;
  hint?: ReactNode;
  value: T;
  options: Array<{ value: T; label: ReactNode; hint?: ReactNode }>;
  onChange: (v: T) => void;
  columns?: 1 | 2 | 3;
}) {
  const name = useId();
  return (
    <fieldset className="space-y-2">
      <legend className="text-base font-semibold">{legend}</legend>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      <div className={cn("grid gap-2 pt-1", columns === 2 && "sm:grid-cols-2", columns === 3 && "grid-cols-3")}>
        {options.map((o) => {
          const checked = o.value === value;
          return (
            <label
              key={String(o.value)}
              className={cn(
                "flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                checked ? "border-primary bg-primary/5" : "hover:bg-accent/50",
              )}
            >
              <input type="radio" name={name} className="sr-only" checked={checked} onChange={() => onChange(o.value)} />
              <span
                aria-hidden
                className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2", checked ? "border-primary bg-primary" : "border-muted-foreground")}
              >
                {checked && <span className="h-2 w-2 rounded-full bg-primary-foreground" />}
              </span>
              <span className="min-w-0">
                <span className="block text-base font-medium">{o.label}</span>
                {o.hint && <span className="block text-sm text-muted-foreground">{o.hint}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function NumberStepper({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = (n) => String(n),
}: {
  label: string;
  hint?: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (n: number) => string;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <div>
        <p id={id} className="text-base font-semibold">{label}</p>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex items-center gap-3" role="group" aria-labelledby={id}>
        <Button type="button" variant="outline" size="icon" onClick={() => onChange(Math.max(min, value - step))} disabled={value <= min} aria-label={`Fewer: ${label}`}>
          <Minus aria-hidden />
        </Button>
        <output className="min-w-[4ch] text-center text-xl font-semibold tabular-nums" aria-live="polite">{format(value)}</output>
        <Button type="button" variant="outline" size="icon" onClick={() => onChange(Math.min(max, value + step))} disabled={value >= max} aria-label={`More: ${label}`}>
          <Plus aria-hidden />
        </Button>
      </div>
    </div>
  );
}

/** Multi-select pills (aria-pressed buttons) */
export function ToggleChips({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(o.value)}
            className={cn(
              "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-accent/50",
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

/** A list of short words (allergies, dislikes) with an add field and removable chips */
export function WordListInput({
  label,
  hint,
  values,
  onChange,
  placeholder,
  suggestions = [],
}: {
  label: string;
  hint?: ReactNode;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
}) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const words = raw.split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
    const next = [...values];
    for (const w of words) if (!next.includes(w)) next.push(w);
    onChange(next);
    setDraft("");
  };
  const unused = suggestions.filter((s) => !values.includes(s));
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-base font-semibold">{label}</label>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={`${label}: ${values.length} added`}>
          {values.map((v) => (
            <li key={v} className="inline-flex items-center rounded-full border bg-secondary pl-4 text-base">
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                className="flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove ${v}`}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (draft.trim()) add(draft);
            }
          }}
          placeholder={placeholder}
          autoCapitalize="none"
          autoComplete="off"
          className="h-11 text-base"
        />
        <Button type="button" variant="outline" onClick={() => add(draft)} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
      {unused.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={`Common ${label.toLowerCase()}`}>
          {unused.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="inline-flex min-h-11 items-center gap-1 rounded-full border border-dashed px-3 text-sm hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="h-4 w-4" aria-hidden /> {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

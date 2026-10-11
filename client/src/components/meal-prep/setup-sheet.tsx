import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { PrepSetup } from "@shared/meal-prep/contract";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { setupSteps, stepSummary } from "./setup-steps";

// The setup as a list of answers (People, Goals, Meals, …). Tapping one opens
// that same walkthrough question in a sheet; "Done" hands the edited setup
// back. Used on the meal-prep start page and as "Adjust" on the plan review.

export function SetupSummaryList({ setup, onEdit }: { setup: PrepSetup; onEdit: (stepId: string) => void }) {
  const steps = setupSteps(setup);
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {steps.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            onClick={() => onEdit(s.id)}
            className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-muted-foreground">{s.label}</span>
              <span className="block truncate text-base">{stepSummary(s.id, setup)}</span>
            </span>
            <span className="sr-only">Change</span>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * One setup question in a sheet. With stepId "list" it opens on the list of
 * answers first and goes back to it on Cancel, all in one sheet (two sheets
 * handing over to each other fight over focus).
 */
export function SetupStepSheet({
  setup,
  stepId,
  onClose,
  onSave,
  saveLabel = "Done",
  listTitle = "Adjust the setup",
  listDescription,
}: {
  setup: PrepSetup;
  stepId: string | null;
  onClose: () => void;
  onSave: (next: PrepSetup) => void;
  saveLabel?: string;
  listTitle?: string;
  listDescription?: string;
}) {
  const isMobile = useIsMobile();
  const [draft, setDraft] = useState(setup);
  const [current, setCurrent] = useState(stepId);
  useEffect(() => {
    if (stepId) { setDraft(setup); setCurrent(stepId); }
  }, [stepId]); // eslint-disable-line react-hooks/exhaustive-deps
  const isList = current === "list";
  const step = current && !isList ? setupSteps(draft).find((s) => s.id === current) : null;
  const cancel = () => {
    if (stepId === "list" && !isList) { setDraft(setup); setCurrent("list"); } else onClose();
  };
  return (
    <Sheet open={!!stepId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={isMobile ? "bottom" : "right"} className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg md:max-h-none">
        <SheetHeader className="border-b px-4 py-4 pr-14 text-left">
          <SheetTitle className="font-serif text-2xl">{isList ? listTitle : step?.title}</SheetTitle>
          <SheetDescription className="text-base">{isList ? listDescription : step?.why}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 py-5">
          {isList ? <SetupSummaryList setup={draft} onEdit={setCurrent} /> : step?.render({ setup: draft, onChange: setDraft })}
        </div>
        {!isList && (
          <SheetFooter className="flex-row gap-2 border-t px-4 py-3">
            <Button variant="outline" className="flex-1" onClick={cancel}>{stepId === "list" ? "Back" : "Cancel"}</Button>
            <Button className="flex-1" onClick={() => onSave(draft)}>{saveLabel}</Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

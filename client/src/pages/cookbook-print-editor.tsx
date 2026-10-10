import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Download, Loader2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToastAction } from "@/components/ui/toast";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingState } from "@/components/page-states";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { CookbookPrintPreview } from "@/components/cookbook-print-preview";
import { RecipeReviewDialog } from "@/components/recipe-review-dialog";
import { PrintOrderPanel } from "@/components/print-order-panel";
import { RecipesStep } from "@/components/print/recipes-step";
import { LookStep } from "@/components/print/look-step";
import { PersonalizeStep } from "@/components/print/personalize-step";
import { ReadyToPrint } from "@/components/print/ready-to-print";
import { SaveStatus, StepBar, StepList } from "@/components/print/step-nav";
import { usePrintAutosave } from "@/components/print/use-print-autosave";
import { STEPS, isStepId, type BookDraft, type RecipeSummary, type Section, type StepId } from "@/components/print/types";
import { estimateBookPages, type BookPageDetails } from "@shared/print-readiness";
import { stepsVersionFor } from "@shared/print-recipe-transform";
import { replacePhotosForBook } from "@/lib/place-photos";
import { BINDING_PAGE_LIMITS } from "@/lib/print-constants";
import type { CookbookPrintProject, CustomTemplate, PrintLayoutData } from "@shared/schema";
import type { BindingTypeId, ColorTypeId, CoverFinishId, PaperTypeId, TrimSizeId } from "@/lib/print-constants";

// The print builder, as a short guided flow (docs/DESIGN_PRINCIPLES.md §8):
// 1 Recipes & chapters · 2 Look · 3 Personalize · 4 Ready to print? · 5 Order.
// Every change autosaves; the preview is one tap away on every step.

interface CookbookInfo {
  id: number;
  name: string;
  ownerUserId: string;
  coverImage: string | null;
}

class PrintEditorErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[PrintEditor] crashed:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-2xl px-4 py-8">
          <ErrorState
            title="The print builder hit a problem"
            description="Changes save automatically as you go. Reload the page to keep working."
            onRetry={() => window.location.reload()}
          />
        </div>
      );
    }
    return this.props.children;
  }
}

function draftFromProject(project: CookbookPrintProject): BookDraft {
  return {
    layoutData: project.layoutData,
    templateStyle: project.templateStyle,
    customTemplateId: project.customTemplateId ?? null,
    trimSize: (project.trimSize || "0600X0900") as TrimSizeId,
    bindingType: (project.bindingType || "PB") as BindingTypeId,
    paperType: (project.paperType || "080CW444") as PaperTypeId,
    colorType: (project.colorType || "FC") as ColorTypeId,
    coverFinish: (project.coverFinish || "M") as CoverFinishId,
  };
}

function CookbookPrintEditorInner() {
  const { id } = useParams<{ id: string }>();
  const cookbookId = parseInt(id || "0");
  const { user, isLoading: userLoading } = useAuth();
  const { toast } = useToast();

  const [step, setStepState] = useState<StepId>(() => {
    const s = new URLSearchParams(window.location.search).get("step");
    return isStepId(s) ? s : "recipes";
  });
  const [draft, setDraft] = useState<BookDraft | null>(null);
  const draftRef = useRef<BookDraft | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showIngredientReview, setShowIngredientReview] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [attentionCount, setAttentionCount] = useState(0);

  const cookbookQuery = useQuery<CookbookInfo>({
    queryKey: ["/api/cookbooks", cookbookId],
    enabled: cookbookId > 0,
  });
  const cookbook = cookbookQuery.data;
  const isOwner = !!user && user.id === cookbook?.ownerUserId;

  const recipesQuery = useQuery<{ recipes: RecipeSummary[] }>({
    queryKey: ["/api/cookbooks", cookbookId, "recipes", "all"],
    // The server sends at most 100 per page; big books need every page
    queryFn: async () => {
      const all: RecipeSummary[] = [];
      for (let page = 1; page <= 50; page++) {
        const res = await fetch(`/api/cookbooks/${cookbookId}/recipes?limit=100&page=${page}`, { credentials: "include" });
        if (!res.ok) throw new Error("Failed to load recipes");
        const body = (await res.json()) as { recipes: RecipeSummary[]; hasMore?: boolean };
        all.push(...body.recipes);
        if (!body.hasMore || !body.recipes.length) break;
      }
      return { recipes: all };
    },
    enabled: cookbookId > 0 && isOwner,
  });
  const projectsQuery = useQuery<CookbookPrintProject[]>({
    queryKey: ["/api/cookbooks", cookbookId, "print-projects"],
    enabled: cookbookId > 0 && isOwner,
  });
  const { data: customTemplates = [] } = useQuery<CustomTemplate[]>({ queryKey: ["/api/templates"], enabled: isOwner });

  const allRecipes = useMemo(() => recipesQuery.data?.recipes ?? [], [recipesQuery.data]);
  const recipeTitles = useMemo(() => new Map(allRecipes.map((r) => [r.id, r.title])), [allRecipes]);
  const currentProject = projectsQuery.data?.[0];

  const autosave = usePrintAutosave(cookbookId, currentProject?.id);

  // Load the saved book once; a new book starts with every recipe in one
  // chapter. Loading never counts as a change, so nothing saves until an edit.
  useEffect(() => {
    if (draftRef.current || !cookbook || !recipesQuery.isSuccess || !projectsQuery.isSuccess) return;
    const initial: BookDraft = currentProject?.layoutData?.sections
      ? draftFromProject(currentProject)
      : {
          layoutData: {
            sections: allRecipes.length ? [{ id: crypto.randomUUID(), title: "Recipes", recipeIds: allRecipes.map((r) => r.id) }] : [],
            title: cookbook.name,
            authorName: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || undefined,
          },
          templateStyle: "classic",
          customTemplateId: null,
          trimSize: "0600X0900",
          bindingType: "PB",
          paperType: "080CW444",
          colorType: "FC",
          coverFinish: "M",
        };
    draftRef.current = initial;
    setDraft(initial);
  }, [cookbook, recipesQuery.isSuccess, projectsQuery.isSuccess, currentProject, allRecipes, user]);

  /** Every edit goes through here: update, autosave, and offer Undo when asked */
  const apply = useCallback(
    (change: (d: BookDraft) => BookDraft, undoMessage?: string) => {
      const prev = draftRef.current;
      if (!prev) return;
      const next = change(prev);
      draftRef.current = next;
      setDraft(next);
      autosave.schedule(next);
      if (undoMessage) {
        toast({
          title: undoMessage,
          duration: 10_000,
          action: (
            <ToastAction
              altText="Undo"
              onClick={() => {
                draftRef.current = prev;
                setDraft(prev);
                autosave.schedule(prev);
              }}
            >
              Undo
            </ToastAction>
          ),
        });
      }
    },
    [autosave, toast],
  );

  const update = useCallback((c: Partial<BookDraft>) => apply((d) => ({ ...d, ...c })), [apply]);

  // A new size or template changes how much room each page has, so the
  // family photos are placed again for it (hand-placed ones stay put)
  const specKey = draft ? `${draft.trimSize}|${draft.bindingType}|${draft.templateStyle}|${draft.customTemplateId ?? ""}` : "";
  const lastSpecKey = useRef<string | null>(null);
  const replaceRun = useRef(0);
  useEffect(() => {
    if (!draft || !specKey) return;
    if (lastSpecKey.current === null || lastSpecKey.current === specKey) {
      lastSpecKey.current = specKey;
      return;
    }
    lastSpecKey.current = specKey;
    if (!(draft.layoutData.familyPhotos ?? []).length || !draft.layoutData.sections.some((s) => s.recipeIds.length)) return;
    const run = ++replaceRun.current;
    replacePhotosForBook(cookbookId, draft.layoutData, {
      templateStyle: draft.templateStyle, customTemplateId: draft.customTemplateId, trimSize: draft.trimSize, bindingType: draft.bindingType,
    })
      .then((r) => {
        if (run !== replaceRun.current) return; // a newer change is on its way
        apply((d) => ({ ...d, layoutData: { ...d.layoutData, familyPhotos: r.familyPhotos } }));
        toast({
          title: "Family photos placed for the new layout",
          description: `${r.besideRecipes} beside recipes · ${r.onSectionPages} on chapter pages · ${r.inAlbum} in the album`,
        });
      })
      .catch(() => {
        if (run === replaceRun.current) toast({ title: "Couldn't re-place the family photos", description: "Open Personalize and press Place photos.", variant: "destructive" });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey]);
  const updateLayout = useCallback(
    (c: Partial<PrintLayoutData>, undoMessage?: string) => apply((d) => ({ ...d, layoutData: { ...d.layoutData, ...c } }), undoMessage),
    [apply],
  );
  const updateCustomization = useCallback(
    (field: string, value: unknown) =>
      apply((d) => ({
        ...d,
        layoutData: {
          ...d.layoutData,
          customizations: {
            showNutrition: false,
            showTips: false,
            showVariations: false,
            showPageNumbers: true,
            pageSize: "6x9",
            ...d.layoutData.customizations,
            [field]: value,
          },
        },
      })),
    [apply],
  );
  const setSections = useCallback(
    (sections: Section[], undoMessage?: string) => updateLayout({ sections }, undoMessage),
    [updateLayout],
  );

  const setStep = useCallback((s: StepId) => {
    setStepState(s);
    const url = new URL(window.location.href);
    url.searchParams.set("step", s);
    window.history.replaceState(window.history.state, "", url.toString());
    window.scrollTo({ top: 0 });
  }, []);

  const handleDownloadPdf = async () => {
    if (!draft) return;
    setIsGeneratingPdf(true);
    try {
      const response = await fetch(`/api/cookbooks/${cookbookId}/generate-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ layoutData: draft.layoutData, templateStyle: draft.templateStyle, customTemplateId: draft.customTemplateId }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Couldn't make the PDF");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(draft.layoutData.title || "cookbook").replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "PDF downloaded" });
    } catch (error) {
      toast({
        title: "Couldn't make the PDF",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const container = "mx-auto max-w-4xl px-4 py-6 md:px-6 [--print-bar-bottom:calc(4.5rem+env(safe-area-inset-bottom,0px))] md:[--print-bar-bottom:0px]";

  if (cookbookQuery.isLoading || userLoading || (isOwner && (recipesQuery.isLoading || projectsQuery.isLoading)) || (isOwner && !draft && !recipesQuery.isError && !projectsQuery.isError)) {
    return (
      <div className={container}>
        <LoadingState label="Opening your book" rows={5} />
      </div>
    );
  }

  if (cookbookQuery.isError || !cookbook) {
    return (
      <div className={container}>
        <PageHeader title="Print your cookbook" back={{ href: "/cookbooks", label: "Cookbooks" }} />
        <ErrorState title="Can't open this cookbook" description="It doesn't exist, or you don't have access to it." onRetry={() => cookbookQuery.refetch()} />
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className={container}>
        <PageHeader title="Print your cookbook" back={{ href: `/cookbook/${cookbookId}`, label: cookbook.name }} />
        <ErrorState title="Only the cookbook's owner can print it" description="Ask them to make the printed book, or make a copy of the recipes in your own cookbook." />
      </div>
    );
  }

  if (recipesQuery.isError || projectsQuery.isError || !draft) {
    return (
      <div className={container}>
        <PageHeader title="Print your cookbook" back={{ href: `/cookbook/${cookbookId}`, label: cookbook.name }} />
        <ErrorState
          title="Couldn't load your book"
          onRetry={() => {
            recipesQuery.refetch();
            projectsQuery.refetch();
          }}
        />
      </div>
    );
  }

  const layout = draft.layoutData;
  const hasRecipes = layout.sections.some((s) => s.recipeIds.length > 0);
  const recipeCount = layout.sections.reduce((n, s) => n + s.recipeIds.length, 0);
  const selectedTemplate = draft.customTemplateId ? customTemplates.find((t) => t.id === draft.customTemplateId) : undefined;
  // Count the pages the PDF will have (the price quote uses this)
  const cardLayout = selectedTemplate ? !!(selectedTemplate.templateData as any)?.layout : draft.templateStyle === "card" || draft.templateStyle === "heirloom";
  const extras = layout.customizations;
  const pageDetails: BookPageDetails = {
    chapterSizes: layout.sections.map((s) => s.recipeIds.length).filter((n) => n > 0),
    extrasOn: cardLayout ? !!extras?.showVariations : !!(extras?.showNutrition || extras?.showTips || extras?.showVariations),
    spreadCount: Object.values(layout.recipePrintSettings ?? {}).filter((r) => r?.layoutOverride === "two-page-spread").length,
    albumPhotoCount: (layout.familyPhotos ?? []).filter((p) => p.placement?.type === "album").length,
    minPages: BINDING_PAGE_LIMITS[draft.bindingType]?.min,
  };
  const estimatedPageCount = estimateBookPages(recipeCount, layout.sections.filter((s) => s.recipeIds.length).length, draft.trimSize, pageDetails);
  const stepInfo = STEPS.find((s) => s.id === step)!;

  return (
    <div className={container}>
      <PageHeader
        title="Print your cookbook"
        description={cookbook.name}
        back={{ href: `/cookbook/${cookbookId}`, label: cookbook.name }}
        secondaryActions={
          <>
            <SaveStatus state={autosave.state} onRetry={() => void autosave.retry()} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions" title="More actions">
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleDownloadPdf} disabled={isGeneratingPdf || !hasRecipes} data-testid="button-download-pdf">
                  <Download className="mr-2 h-4 w-4" aria-hidden /> Download PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowIngredientReview(true)} data-testid="button-review-recipes">
                  Check ingredient amounts
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <StepList current={step} onSelect={setStep} />

      <h2 className="mb-4 font-serif text-2xl font-bold">{stepInfo.title}</h2>

      {step === "recipes" && (
        <RecipesStep
          cookbookId={cookbookId}
          sections={layout.sections}
          allRecipes={allRecipes}
          onChange={setSections}
          stepsFor={(id) => stepsVersionFor(id, layout)}
          onSetSteps={(id, steps) => {
            const settings = { ...(layout.recipePrintSettings ?? {}) };
            const rest = { ...(settings[id] ?? {}) };
            // Matching the book's choice clears the override, so a later book-wide change still applies
            if (steps === (layout.customizations?.stepsVersion ?? "improved")) delete rest.steps;
            else rest.steps = steps;
            if (Object.keys(rest).length) settings[id] = rest;
            else delete settings[id];
            updateLayout({ recipePrintSettings: settings });
          }}
        />
      )}

      {step === "look" && (
        <LookStep cookbookId={cookbookId} draft={draft} update={update} updateCustomization={updateCustomization} />
      )}

      {step === "personalize" && (
        <PersonalizeStep cookbookId={cookbookId} draft={draft} updateLayout={updateLayout} recipeTitles={recipeTitles} />
      )}

      {step === "review" && (
        <div className="space-y-6">
          <ReadyToPrint
            cookbookId={cookbookId}
            draft={draft}
            updateLayout={updateLayout}
            goToStep={setStep}
            onOpenPreview={() => setShowPreview(true)}
            onReviewIngredients={() => setShowIngredientReview(true)}
            onResult={setAttentionCount}
            pageDetails={pageDetails}
          />
          <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center">
            <p className="flex-1 text-sm text-muted-foreground">Want to print it yourself? Download the pages as a PDF.</p>
            <Button variant="outline" onClick={handleDownloadPdf} disabled={isGeneratingPdf || !hasRecipes}>
              {isGeneratingPdf ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
              {isGeneratingPdf ? "Making the PDF…" : "Download PDF"}
            </Button>
          </div>
        </div>
      )}

      {step === "order" && (
        <PrintOrderPanel
          cookbookId={cookbookId}
          cookbookName={cookbook.name}
          coverImage={cookbook.coverImage}
          book={draft}
          estimatedPageCount={estimatedPageCount}
          flushSave={autosave.flush}
          attentionCount={attentionCount}
          onGoToReview={() => setStep("review")}
          onGoToLook={() => setStep("look")}
          customTemplateName={selectedTemplate?.name}
          existingOrder={currentProject?.luluOrderId ? { id: currentProject.luluOrderId, status: currentProject.luluOrderStatus } : null}
        />
      )}

      <StepBar current={step} onSelect={setStep} onPreview={() => setShowPreview(true)} previewDisabled={!hasRecipes} />

      <CookbookPrintPreview
        open={showPreview}
        onClose={() => setShowPreview(false)}
        layoutData={layout}
        templateStyle={draft.templateStyle}
        cookbookId={cookbookId}
        trimSize={draft.trimSize}
        customTemplateData={(selectedTemplate?.templateData as any) || null}
        customFonts={(selectedTemplate?.customFonts as any) || null}
      />

      <RecipeReviewDialog cookbookId={cookbookId} open={showIngredientReview} onClose={() => setShowIngredientReview(false)} />
    </div>
  );
}

export default function CookbookPrintEditor() {
  return (
    <PrintEditorErrorBoundary>
      <CookbookPrintEditorInner />
    </PrintEditorErrorBoundary>
  );
}

import { useState } from "react";
import { Link } from "wouter";
import { Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/page-states";
import { JobStatus, type JobItem } from "@/components/job-status";
import { useUploadProgress } from "@/contexts/UploadProgressContext";
import { useAddRecipe } from "@/contexts/AddRecipeContext";
import { IMPORT_JOB_STATE, importStatusText } from "@/lib/import-jobs";

// Recipes being added: each one's status ("Reading…", "Needs a look",
// "Saved", or why it failed with Retry) plus "3 of 12" overall.

export default function Processing() {
  const { imports, retry, dismiss, clearFinished } = useUploadProgress();
  const { openAddRecipe } = useAddRecipe();
  const [retrying, setRetrying] = useState<Set<string>>(new Set());

  const handleRetry = async (key: string) => {
    setRetrying((s) => new Set(s).add(key));
    try {
      await retry(key);
    } finally {
      setRetrying((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    }
  };

  const items: JobItem[] = imports.map((i) => ({
    id: i.key,
    title: i.title === "Your Recipe" ? "New recipe" : i.title,
    state: IMPORT_JOB_STATE[i.status],
    statusText: importStatusText(i.status, i.kind),
    error: i.error,
    thumbnail: i.thumbnail,
    // The check page only for recipes waiting to be checked or that failed (it has Try again)
    href: i.recipeId ? (i.status === "needs_review" || i.status === "failed" ? `/recipe/${i.recipeId}/review` : `/recipe/${i.recipeId}`) : undefined,
    actionLabel: i.status === "needs_review" ? "Check it" : i.status === "saved" ? "Open" : undefined,
    onRetry: () => void handleRetry(i.key),
    retrying: retrying.has(i.key),
    onDismiss: i.status === "uploading" || i.status === "reading" ? undefined : () => dismiss(i.key),
    dismissLabel: i.status === "needs_review" ? `Don't ask me to check ${i.title}` : undefined,
  }));

  const needsReview = imports.filter((i) => i.status === "needs_review");
  const hasSaved = imports.some((i) => i.status === "saved");

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-8">
      <PageHeader
        title="Adding recipes"
        description={
          needsReview.length > 0
            ? "Grammie has read these. Check each one against the original before it's final."
            : "Keep using the app; Grammie reads your recipes in the background."
        }
        back={{ href: "/", label: "Recipes" }}
        primaryAction={
          needsReview.length > 0 && needsReview[0].recipeId ? (
            <Button asChild>
              <Link href={`/recipe/${needsReview[0].recipeId}/review`}>
                {needsReview.length === 1 ? "Check the recipe" : `Check ${needsReview.length} recipes`}
              </Link>
            </Button>
          ) : undefined
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Nothing being added right now"
          description="Snap a recipe card, paste a link, or type one in. You'll see each recipe here while Grammie reads it."
          action={
            <Button onClick={() => openAddRecipe()}>
              <Plus aria-hidden /> Add recipe
            </Button>
          }
        />
      ) : (
        <JobStatus
          items={items}
          progressLabel={(f, t) => `${f} of ${t} read`}
          failedLabel="couldn't be read"
          showOverall={items.length > 1}
          actions={
            hasSaved ? (
              <Button variant="outline" onClick={clearFinished} data-testid="button-clear-finished">
                Clear saved
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}

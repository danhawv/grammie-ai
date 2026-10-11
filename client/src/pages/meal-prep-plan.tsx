import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { CalendarX } from "lucide-react";
import type { PrepPlanView } from "@shared/meal-prep/api";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-states";
import { PlanReview } from "@/components/meal-prep/plan-review";
import { ApprovedView } from "@/components/meal-prep/approved-view";
import { BuildingState } from "@/components/meal-prep/building-state";
import { queryClient } from "@/lib/queryClient";
import { errorText, MealPrepApiError, mealPrepApi, mealPrepKeys } from "@/lib/meal-prep-api";

// /meal-prep/:id — a plan still being built (we poll), one that failed (try
// again), a draft to review, or an approved one to shop for, prepare and
// hand off.

export default function MealPrepPlanPage() {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({
    queryKey: mealPrepKeys.plan(id),
    queryFn: () => mealPrepApi.getPlan(id),
    refetchInterval: (q) => (q.state.data?.buildStatus === "building" ? 2000 : false),
  });
  const retry = useMutation({
    mutationFn: (v: PrepPlanView) => mealPrepApi.updatePlan(v.id, { setup: v.setup }),
    onSuccess: (r) => setRecord(r),
  });

  useEffect(() => { document.title = "Meal prep plan · Grammie"; }, []);

  const setRecord = (r: PrepPlanView) => {
    queryClient.setQueryData(mealPrepKeys.plan(id), r);
    queryClient.invalidateQueries({ queryKey: mealPrepKeys.plans });
  };

  const v = query.data;
  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      {query.isLoading ? (
        <LoadingState label="Opening your plan" rows={5} />
      ) : query.error instanceof MealPrepApiError && query.error.status === 404 ? (
        <EmptyState
          icon={CalendarX}
          title="This plan isn't here anymore"
          description="It may have been replaced by a newer plan."
          action={<Button asChild><Link href="/meal-prep">Plan my meal prep</Link></Button>}
        />
      ) : query.isError || !v ? (
        <ErrorState title="Couldn't open this plan" description={errorText(query.error)} onRetry={() => query.refetch()} />
      ) : v.buildStatus === "building" || retry.isPending ? (
        <BuildingState />
      ) : v.buildStatus === "failed" || !v.plan || !v.session ? (
        <>
          <ErrorState
            title="Grammie couldn't finish this plan"
            description={retry.isError ? errorText(retry.error) : v.buildError ?? "Try again, or change the setup."}
            onRetry={() => retry.mutate(v)}
          />
          <Button variant="ghost" asChild className="mt-4 w-full">
            <Link href="/meal-prep">Change the setup instead</Link>
          </Button>
        </>
      ) : v.status === "draft" ? (
        <PlanReview record={v} onRecord={setRecord} />
      ) : (
        <ApprovedView record={v} onRecord={setRecord} />
      )}
    </div>
  );
}

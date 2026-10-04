import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// Shown when the chosen template prints nutrition and tips on each recipe:
// says how many recipes are missing them and offers to fill them with AI.

interface Status {
  missing: number;
  fillable: number;
  aiAvailable: boolean;
}

export function PrintDetailsNotice({ cookbookId }: { cookbookId: number }) {
  const { toast } = useToast();
  const statusKey = [`/api/cookbooks/${cookbookId}/print-details-status`];
  const { data } = useQuery<Status>({ queryKey: statusKey });

  const fill = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/cookbooks/${cookbookId}/fill-print-details`);
      return res.json() as Promise<{ filled: number; attempted: number }>;
    },
    onSuccess: (r) => {
      toast({
        title: r.filled ? `Filled in ${r.filled} recipe${r.filled === 1 ? "" : "s"}` : "Nothing to fill",
        description: r.filled < r.attempted ? "Some recipes couldn't be estimated; try again later." : "Nutrition is an AI estimate. You can edit it on each recipe.",
      });
      queryClient.invalidateQueries({
        predicate: (q) => String(q.queryKey[0] ?? "").startsWith(`/api/cookbooks/${cookbookId}`),
      });
    },
    onError: () => toast({ title: "Couldn't fill recipe details", variant: "destructive" }),
  });

  if (!data || data.missing === 0) return null;

  return (
    <div className="rounded-md border border-dashed p-3 text-xs space-y-2" data-testid="print-details-notice">
      <p className="text-muted-foreground">
        {data.missing} recipe{data.missing === 1 ? " is" : "s are"} missing nutrition or tips, so those boxes will be left off.
        {data.fillable < data.missing && ` ${data.missing - data.fillable} belong to other people and can't be filled.`}
      </p>
      {data.aiAvailable && data.fillable > 0 && (
        <Button size="sm" variant="secondary" className="w-full gap-1.5" disabled={fill.isPending} onClick={() => fill.mutate()}>
          {fill.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {fill.isPending ? "Estimating…" : `Fill ${data.fillable} with AI`}
        </Button>
      )}
    </div>
  );
}

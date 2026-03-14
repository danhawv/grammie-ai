import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Wand2, Loader2, Leaf, Drumstick, Flame, Apple, Carrot, Sparkles, X, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface QuickModification {
  id: string;
  label: string;
  icon: typeof Leaf;
  description: string;
}

const QUICK_MODIFICATIONS: QuickModification[] = [
  {
    id: "low-calorie",
    label: "Low Calorie",
    icon: Apple,
    description: "Reduce calories while keeping it tasty",
  },
  {
    id: "high-protein",
    label: "High Protein",
    icon: Drumstick,
    description: "Boost protein content",
  },
  {
    id: "keto",
    label: "Keto-Friendly",
    icon: Flame,
    description: "Low-carb, high-fat version",
  },
  {
    id: "vegetarian",
    label: "Vegetarian",
    icon: Carrot,
    description: "No meat, keep eggs & dairy",
  },
  {
    id: "vegan",
    label: "Vegan",
    icon: Leaf,
    description: "100% plant-based",
  },
];

interface MakeYourOwnModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipeId: string;
  recipeTitle: string;
}

interface VariationResponse {
  id: string;
  title: string;
  variationNotes: string;
  appliedModifications: string[];
}

export function MakeYourOwnModal({
  open,
  onOpenChange,
  recipeId,
  recipeTitle,
}: MakeYourOwnModalProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [selectedMods, setSelectedMods] = useState<string[]>([]);
  const [customInstructions, setCustomInstructions] = useState("");

  const toggleMod = (modId: string) => {
    setSelectedMods((prev) =>
      prev.includes(modId)
        ? prev.filter((id) => id !== modId)
        : [...prev, modId]
    );
  };

  const createVariationMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(
        "POST",
        `/api/recipes/${recipeId}/make-your-own`,
        {
          quickModifications: selectedMods,
          customInstructions: customInstructions.trim() || undefined,
        }
      );
      return response.json() as Promise<VariationResponse>;
    },
    onSuccess: (data) => {
      toast({
        title: "Your variation is cooking!",
        description: `"${data.title}" has been created. AI enrichment is in progress.`,
      });
      onOpenChange(false);
      setSelectedMods([]);
      setCustomInstructions("");
      navigate(`/recipe/${data.id}`);
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Failed to create variation",
        description: error.message,
      });
    },
  });

  const canSubmit = selectedMods.length > 0 || customInstructions.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" />
            Make Your Own
          </DialogTitle>
          <DialogDescription>
            Create your personalized version of "{recipeTitle}"
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <p className="text-sm font-medium mb-3">Quick Modifications</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_MODIFICATIONS.map((mod) => {
                const isSelected = selectedMods.includes(mod.id);
                const Icon = mod.icon;
                return (
                  <Badge
                    key={mod.id}
                    variant={isSelected ? "default" : "outline"}
                    className={`cursor-pointer px-3 py-1.5 text-sm transition-colors ${
                      isSelected
                        ? "bg-primary text-primary-foreground"
                        : "hover-elevate"
                    }`}
                    onClick={() => toggleMod(mod.id)}
                    data-testid={`badge-mod-${mod.id}`}
                  >
                    {isSelected ? (
                      <Check className="h-3.5 w-3.5 mr-1.5" />
                    ) : (
                      <Icon className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    {mod.label}
                  </Badge>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">Custom Instructions</p>
            <Textarea
              placeholder="e.g., 'Use almond flour instead of regular flour' or 'Make it spicier'"
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              className="resize-none"
              rows={3}
              data-testid="input-custom-instructions"
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              Add specific swaps or adjustments you'd like
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createVariationMutation.isPending}
            data-testid="button-cancel-variation"
          >
            Cancel
          </Button>
          <Button
            onClick={() => createVariationMutation.mutate()}
            disabled={!canSubmit || createVariationMutation.isPending}
            data-testid="button-create-variation"
          >
            {createVariationMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Create My Version
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

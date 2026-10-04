import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Printer, BookOpen, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

// Header shortcut: pick one of your cookbooks and go straight to the print
// editor to create a physical copy.

interface CookbookSummary {
  id: number;
  name: string;
  ownerUserId: string;
  recipeCount?: number;
}

export function PrintCookbookPicker() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);

  const { data: cookbooks, isLoading } = useQuery<CookbookSummary[]>({
    queryKey: ["/api/cookbooks"],
    enabled: !!user && open,
  });

  if (!user) return null;

  // Only owners can print a cookbook (the print editor enforces this too)
  const own = (cookbooks ?? []).filter((c) => c.ownerUserId === user.id);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="inline-flex items-center justify-center"
          aria-label="Create a physical cookbook"
          title="Create a physical cookbook"
          data-testid="button-print-cookbook-nav"
        >
          <Printer className="w-5 h-5" strokeWidth={2} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <p className="px-2 pt-1 pb-2 text-sm font-semibold">Create a physical cookbook</p>
        <p className="px-2 pb-2 text-xs text-muted-foreground">Choose which cookbook to print.</p>
        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
        ) : own.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">You don't have any cookbooks yet.</p>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            {own.map((c) => (
              <button
                key={c.id}
                className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-sm hover:bg-accent"
                onClick={() => {
                  setOpen(false);
                  navigate(`/cookbook/${c.id}/print-editor`);
                }}
                data-testid={`print-pick-${c.id}`}
              >
                <BookOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate">{c.name.trim()}</span>
                {c.recipeCount != null && (
                  <span className="text-xs text-muted-foreground">{c.recipeCount}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

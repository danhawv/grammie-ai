import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Check, ChevronsUpDown, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";

interface CookbookMultiSelectProps {
  selectedIds: number[];
  onSelectionChange: (ids: number[]) => void;
  testId?: string;
}

export function CookbookMultiSelect({
  selectedIds,
  onSelectionChange,
  testId = "select-cookbooks-multi",
}: CookbookMultiSelectProps) {
  const [open, setOpen] = useState(false);

  const { data: cookbooks, isLoading } = useQuery<any[]>({
    queryKey: ["/api/cookbooks"],
  });

  const handleToggle = (cookbookId: number) => {
    if (selectedIds.includes(cookbookId)) {
      onSelectionChange(selectedIds.filter(id => id !== cookbookId));
    } else {
      onSelectionChange([...selectedIds, cookbookId]);
    }
  };

  const handleSelectAll = () => {
    if (cookbooks) {
      onSelectionChange(cookbooks.map(c => c.id));
    }
  };

  const handleClearAll = () => {
    onSelectionChange([]);
  };

  const getDisplayText = () => {
    if (selectedIds.length === 0) {
      return "All Cookbooks";
    }
    if (selectedIds.length === 1 && cookbooks) {
      const cookbook = cookbooks.find(c => c.id === selectedIds[0]);
      return cookbook?.name || "1 cookbook";
    }
    return `${selectedIds.length} cookbooks`;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="sm:w-auto sm:px-3 gap-2"
          size="icon"
          data-testid={testId}
        >
          <BookOpen className="h-4 w-4 shrink-0" strokeWidth={2} />
          <span className="hidden sm:inline">{getDisplayText()}</span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50 hidden sm:block" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0" align="start">
        <Command>
          <CommandList>
            <CommandEmpty>No cookbooks found.</CommandEmpty>
            <CommandGroup>
              <div className="flex items-center justify-between px-2 py-1.5 border-b">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSelectAll}
                  className="h-7 text-xs"
                  data-testid="button-select-all-cookbooks"
                >
                  Select All
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearAll}
                  className="h-7 text-xs"
                  data-testid="button-clear-cookbooks"
                >
                  Clear
                </Button>
              </div>
              {isLoading ? (
                <CommandItem disabled>Loading...</CommandItem>
              ) : cookbooks && cookbooks.length > 0 ? (
                cookbooks.map((cookbook) => (
                  <CommandItem
                    key={cookbook.id}
                    value={cookbook.name}
                    onSelect={() => handleToggle(cookbook.id)}
                    data-testid={`checkbox-cookbook-${cookbook.id}`}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selectedIds.includes(cookbook.id) ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="truncate">{cookbook.name}</span>
                    {cookbook.recipeCount !== undefined && (
                      <Badge variant="secondary" className="ml-auto text-xs">
                        {cookbook.recipeCount}
                      </Badge>
                    )}
                  </CommandItem>
                ))
              ) : (
                <CommandItem disabled>No cookbooks yet</CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useState } from "react";
import { CreateCookbookDialog } from "./create-cookbook-dialog";

interface CookbookSelectProps {
  value?: string;
  onValueChange: (value: string | undefined) => void;
  placeholder?: string;
  allowNone?: boolean;
  testId?: string;
}

export function CookbookSelect({
  value,
  onValueChange,
  placeholder = "Select a cookbook (optional)",
  allowNone = true,
  testId = "select-cookbook",
}: CookbookSelectProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const { data: cookbooks, isLoading } = useQuery<any[]>({
    queryKey: ["/api/cookbooks"],
  });

  const handleCreateSuccess = (newCookbookId: number) => {
    onValueChange(String(newCookbookId));
    setShowCreateDialog(false);
  };

  return (
    <>
      <div className="flex gap-2">
        <Select
          value={value || "none"}
          onValueChange={(val) => onValueChange(val === "none" ? undefined : val)}
        >
          <SelectTrigger data-testid={testId} className="flex-1">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {allowNone && (
              <SelectItem value="none" data-testid="option-no-cookbook">
                None
              </SelectItem>
            )}
            {isLoading ? (
              <SelectItem value="loading" disabled data-testid="option-loading">
                Loading...
              </SelectItem>
            ) : cookbooks && cookbooks.length > 0 ? (
              cookbooks.map((cookbook) => (
                <SelectItem
                  key={cookbook.id}
                  value={String(cookbook.id)}
                  data-testid={`option-cookbook-${cookbook.id}`}
                >
                  {cookbook.name}
                </SelectItem>
              ))
            ) : (
              <SelectItem value="empty" disabled data-testid="option-no-cookbooks">
                No cookbooks yet
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={() => setShowCreateDialog(true)}
          data-testid="button-create-cookbook"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <CreateCookbookDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSuccess={handleCreateSuccess}
      />
    </>
  );
}

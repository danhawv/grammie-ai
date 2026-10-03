import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { UserPlus, X, Users, Mail } from "lucide-react";

type Collaborator = {
  id: string;
  mealPlanId: string;
  userId: string;
  role: string;
  user: {
    id: string;
    email: string;
    displayName: string;
  };
};

interface MealPlanCollaboratorsProps {
  planId: string;
  isOwner: boolean;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function MealPlanCollaborators({ planId, isOwner }: MealPlanCollaboratorsProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("editor");
  const [message, setMessage] = useState("");
  const { toast } = useToast();

  const { data: collaborators = [] } = useQuery<Collaborator[]>({
    queryKey: ["/api/meal-plans", planId, "collaborators"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/meal-plans/${planId}/invite`, {
        email,
        role,
        ...(message ? { message } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meal-plans", planId, "collaborators"] });
      toast({ title: "Invitation sent", description: `Invited ${email} as ${role}` });
      setEmail("");
      setMessage("");
      setRole("editor");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to send invite", description: error.message, variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("DELETE", `/api/meal-plans/${planId}/collaborators/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meal-plans", planId, "collaborators"] });
      toast({ title: "Collaborator removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove collaborator", description: error.message, variant: "destructive" });
    },
  });

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    inviteMutation.mutate();
  };

  return (
    <div className="flex items-center gap-2">
      {/* Avatar stack */}
      {collaborators.length > 0 && (
        <div className="flex -space-x-2">
          {collaborators.slice(0, 4).map((c) => (
            <Avatar key={c.id} className="h-7 w-7 border-2 border-background">
              <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                {getInitials(c.user.displayName || c.user.email)}
              </AvatarFallback>
            </Avatar>
          ))}
          {collaborators.length > 4 && (
            <Avatar className="h-7 w-7 border-2 border-background">
              <AvatarFallback className="text-[10px] bg-muted text-muted-foreground">
                +{collaborators.length - 4}
              </AvatarFallback>
            </Avatar>
          )}
        </div>
      )}

      {/* Invite dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <UserPlus className="h-4 w-4" />
            Invite
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Collaborators
            </DialogTitle>
          </DialogHeader>

          {/* Invite form */}
          {isOwner && (
            <form onSubmit={handleInvite} className="space-y-3 border-b pb-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Mail className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="Email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-9"
                    required
                  />
                </div>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger className="w-[110px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">Editor</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Input
                placeholder="Add a message (optional)"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <Button
                type="submit"
                size="sm"
                className="w-full"
                disabled={inviteMutation.isPending || !email.trim()}
              >
                {inviteMutation.isPending ? "Sending..." : "Send Invite"}
              </Button>
            </form>
          )}

          {/* Collaborator list */}
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {collaborators.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No collaborators yet
              </p>
            ) : (
              collaborators.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 py-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback className="text-xs bg-primary/10 text-primary">
                        {getInitials(c.user.displayName || c.user.email)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {c.user.displayName || c.user.email}
                      </p>
                      {c.user.displayName && (
                        <p className="text-xs text-muted-foreground truncate">{c.user.email}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="secondary" className="text-xs capitalize">
                      {c.role}
                    </Badge>
                    {isOwner && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => removeMutation.mutate(c.userId)}
                        disabled={removeMutation.isPending}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { UserPlus, X, Loader2, Mail, Clock, Check, AlertCircle } from "lucide-react";

interface CookbookCollaboratorWithUser {
  id: number;
  cookbookId: number;
  userId: string;
  role: string;
  addedByUserId: string;
  createdAt: string;
  user: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    profileImageUrl: string | null;
  };
}

interface CookbookInvitation {
  id: number;
  cookbookId: number;
  inviterUserId: string;
  inviteeEmail: string;
  inviteeUserId: string | null;
  status: string;
  token: string;
  message: string | null;
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
}

interface CookbookCollaboratorsDialogProps {
  cookbookId: number;
  cookbookName: string;
  isOwner: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CookbookCollaboratorsDialog({
  cookbookId,
  cookbookName,
  isOwner,
  open,
  onOpenChange,
}: CookbookCollaboratorsDialogProps) {
  const { toast } = useToast();
  const [inviteEmail, setInviteEmail] = useState("");

  const { data: collaborators = [], isLoading: collaboratorsLoading } = useQuery<CookbookCollaboratorWithUser[]>({
    queryKey: ['/api/cookbooks', cookbookId, 'collaborators'],
    enabled: open,
  });

  const { data: invitations = [], isLoading: invitationsLoading } = useQuery<CookbookInvitation[]>({
    queryKey: ['/api/cookbooks', cookbookId, 'invitations'],
    enabled: open && isOwner,
  });

  const inviteMutation = useMutation({
    mutationFn: async (email: string) => {
      return apiRequest("POST", `/api/cookbooks/${cookbookId}/invitations`, { email });
    },
    onSuccess: () => {
      toast({ title: "Invitation sent" });
      setInviteEmail("");
      queryClient.invalidateQueries({ queryKey: ['/api/cookbooks', cookbookId, 'invitations'] });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to send invitation", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const removeCollaboratorMutation = useMutation({
    mutationFn: async (userId: string) => {
      return apiRequest("DELETE", `/api/cookbooks/${cookbookId}/collaborators/${userId}`);
    },
    onSuccess: () => {
      toast({ title: "Collaborator removed" });
      queryClient.invalidateQueries({ queryKey: ['/api/cookbooks', cookbookId, 'collaborators'] });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to remove collaborator", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const cancelInvitationMutation = useMutation({
    mutationFn: async (invitationId: number) => {
      return apiRequest("DELETE", `/api/cookbooks/${cookbookId}/invitations/${invitationId}`);
    },
    onSuccess: () => {
      toast({ title: "Invitation cancelled" });
      queryClient.invalidateQueries({ queryKey: ['/api/cookbooks', cookbookId, 'invitations'] });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to cancel invitation", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    inviteMutation.mutate(inviteEmail.trim());
  };

  const pendingInvitations = invitations.filter(inv => inv.status === 'pending');

  const getUserName = (user: CookbookCollaboratorWithUser['user']) => {
    if (user.firstName || user.lastName) {
      return [user.firstName, user.lastName].filter(Boolean).join(' ');
    }
    return user.email || 'Unknown';
  };

  const getUserInitials = (user: CookbookCollaboratorWithUser['user']) => {
    if (user.firstName || user.lastName) {
      return [user.firstName?.[0], user.lastName?.[0]].filter(Boolean).join('').toUpperCase();
    }
    return user.email?.[0]?.toUpperCase() || '?';
  };

  const formatExpiry = (expiresAt: string) => {
    const expires = new Date(expiresAt);
    const now = new Date();
    const diffDays = Math.ceil((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return "Expired";
    if (diffDays === 1) return "Expires tomorrow";
    return `Expires in ${diffDays} days`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Collaborators</DialogTitle>
          <DialogDescription>
            Collaborators can add, edit, and remove recipes from "{cookbookName}"
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isOwner && (
            <form onSubmit={handleInvite} className="flex gap-2">
              <Input
                type="email"
                placeholder="Enter email to invite"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={inviteMutation.isPending}
                data-testid="input-invite-email"
              />
              <Button 
                type="submit" 
                disabled={!inviteEmail.trim() || inviteMutation.isPending}
                data-testid="button-send-invite"
              >
                {inviteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UserPlus className="h-4 w-4" />
                )}
              </Button>
            </form>
          )}

          <ScrollArea className="max-h-64">
            {collaboratorsLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : collaborators.length === 0 && pendingInvitations.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <UserPlus className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No collaborators yet</p>
                {isOwner && (
                  <p className="text-xs mt-1">Invite someone to start collaborating</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {collaborators.map((collab) => (
                  <div
                    key={collab.id}
                    className="flex items-center justify-between p-2 rounded-md bg-muted/50"
                    data-testid={`collaborator-${collab.userId}`}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={collab.user.profileImageUrl || undefined} />
                        <AvatarFallback className="text-xs">
                          {getUserInitials(collab.user)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium">{getUserName(collab.user)}</p>
                        {collab.user.email && (
                          <p className="text-xs text-muted-foreground">{collab.user.email}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">
                        {collab.role}
                      </Badge>
                      {isOwner && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeCollaboratorMutation.mutate(collab.userId)}
                          disabled={removeCollaboratorMutation.isPending}
                          data-testid={`button-remove-collaborator-${collab.userId}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}

                {isOwner && pendingInvitations.length > 0 && (
                  <>
                    {collaborators.length > 0 && <Separator className="my-3" />}
                    <p className="text-xs text-muted-foreground mb-2 px-1">Pending Invitations</p>
                    {pendingInvitations.map((invitation) => (
                      <div
                        key={invitation.id}
                        className="flex items-center justify-between p-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800"
                        data-testid={`invitation-${invitation.id}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-amber-100 dark:bg-amber-900 flex items-center justify-center">
                            <Mail className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">{invitation.inviteeEmail}</p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatExpiry(invitation.expiresAt)}
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => cancelInvitationMutation.mutate(invitation.id)}
                          disabled={cancelInvitationMutation.isPending}
                          data-testid={`button-cancel-invitation-${invitation.id}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}

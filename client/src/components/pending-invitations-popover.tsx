import { useQuery, useMutation } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Bell, BookOpen, Check, X, Loader2 } from "lucide-react";
import { useLocation } from "wouter";

interface CookbookInvitationWithDetails {
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
  cookbook: {
    id: number;
    name: string;
    description: string | null;
  };
  inviter: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    profileImageUrl: string | null;
  };
}

export function PendingInvitationsPopover() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { data: invitations = [], isLoading } = useQuery<CookbookInvitationWithDetails[]>({
    queryKey: ['/api/user/invitations'],
    refetchInterval: 60000,
  });

  const respondMutation = useMutation({
    mutationFn: async ({ invitationId, accept }: { invitationId: number; accept: boolean }) => {
      return apiRequest("POST", `/api/invitations/${invitationId}/respond`, { accept });
    },
    onSuccess: (_, variables) => {
      toast({ 
        title: variables.accept ? "Invitation accepted" : "Invitation declined",
        description: variables.accept ? "You can now collaborate on this cookbook" : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/user/invitations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/cookbooks'] });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to respond to invitation", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const getInviterName = (inviter: CookbookInvitationWithDetails['inviter']) => {
    if (inviter.firstName || inviter.lastName) {
      return [inviter.firstName, inviter.lastName].filter(Boolean).join(' ');
    }
    return 'Someone';
  };

  const getInviterInitials = (inviter: CookbookInvitationWithDetails['inviter']) => {
    if (inviter.firstName || inviter.lastName) {
      return [inviter.firstName?.[0], inviter.lastName?.[0]].filter(Boolean).join('').toUpperCase();
    }
    return '?';
  };

  const pendingCount = invitations.length;

  if (pendingCount === 0 && !isLoading) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon" 
          className="relative"
          data-testid="button-pending-invitations"
        >
          <Bell className="h-5 w-5" />
          {pendingCount > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs"
            >
              {pendingCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="p-3 border-b">
          <h4 className="font-semibold text-sm">Cookbook Invitations</h4>
        </div>
        <ScrollArea className="max-h-80">
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : invitations.length === 0 ? (
            <div className="py-6 text-center text-muted-foreground text-sm">
              No pending invitations
            </div>
          ) : (
            <div className="divide-y">
              {invitations.map((invitation) => (
                <div 
                  key={invitation.id} 
                  className="p-3"
                  data-testid={`invitation-item-${invitation.id}`}
                >
                  <div className="flex items-start gap-3">
                    <Avatar className="h-8 w-8 flex-shrink-0">
                      <AvatarImage src={invitation.inviter.profileImageUrl || undefined} />
                      <AvatarFallback className="text-xs">
                        {getInviterInitials(invitation.inviter)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">
                        <span className="font-medium">{getInviterName(invitation.inviter)}</span>
                        {' '}invited you to collaborate on
                      </p>
                      <button
                        onClick={() => navigate(`/cookbook/${invitation.cookbookId}`)}
                        className="text-sm font-medium text-primary hover:underline flex items-center gap-1 mt-0.5"
                        data-testid={`link-cookbook-${invitation.cookbookId}`}
                      >
                        <BookOpen className="h-3 w-3" />
                        {invitation.cookbook.name}
                      </button>
                      {invitation.message && (
                        <p className="text-xs text-muted-foreground mt-1 italic">
                          "{invitation.message}"
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <Button
                          size="sm"
                          onClick={() => respondMutation.mutate({ invitationId: invitation.id, accept: true })}
                          disabled={respondMutation.isPending}
                          data-testid={`button-accept-invitation-${invitation.id}`}
                        >
                          {respondMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Check className="h-3 w-3 mr-1" />
                          )}
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => respondMutation.mutate({ invitationId: invitation.id, accept: false })}
                          disabled={respondMutation.isPending}
                          data-testid={`button-decline-invitation-${invitation.id}`}
                        >
                          <X className="h-3 w-3 mr-1" />
                          Decline
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

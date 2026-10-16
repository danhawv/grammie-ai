import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { CalendarX, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-states";
import { GuestView } from "@/components/party/guest-view";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { PartyApiError, clearGuestToken, getGuestToken, partyApi, partyErrorText, partyKeys } from "@/lib/party-api";
import { anyImporting, guestPath, signUpPath } from "@/lib/party-format";

// /p/:token — the invite link. Works signed out (in a browser or the app).
// After "Create a free account" sign-up comes back here with ?claim=1, and
// the dish this device added as a guest moves to the new account.

export function PartyChrome({ signedIn, token, children }: { signedIn: boolean; token: string; children: React.ReactNode }) {
  // Signed-out visitors get no app shell (it's all sign-in-only places), just
  // the name and a way to sign in
  return (
    <div className="min-h-screen supports-[height:100dvh]:min-h-dvh bg-background">
      {!signedIn && (
        <header className="border-b" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
          <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
            <span className="font-serif text-2xl font-bold">Grammie</span>
            <Button variant="ghost" asChild><Link href={signUpPath(token, !!getGuestToken(token), "signin")}>Sign in</Link></Button>
          </div>
        </header>
      )}
      <div className="container mx-auto max-w-3xl px-4 py-6" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)" }}>
        {children}
      </div>
    </div>
  );
}

export default function PartyGuestPage() {
  const { token } = useParams<{ token: string }>();
  const search = useSearch();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user, isLoading: authLoading } = useAuth();
  const signedIn = !!user;
  const wantsClaim = new URLSearchParams(search).get("claim") === "1";
  const [hasStoredGuest, setHasStoredGuest] = useState(() => !!getGuestToken(token));

  const query = useQuery({
    queryKey: partyKeys.invite(token),
    queryFn: () => partyApi.byToken(token),
    // Poll while a recipe is being read so it appears when ready
    refetchInterval: (q) => (anyImporting(q.state.data) ? 3000 : false),
    enabled: !authLoading,
  });

  const claim = useMutation({
    mutationFn: () => partyApi.claim(token),
    onSuccess: () => {
      clearGuestToken(token);
      setHasStoredGuest(false);
      queryClient.invalidateQueries({ queryKey: partyKeys.invite(token) });
      queryClient.invalidateQueries({ queryKey: partyKeys.list });
      toast({ title: "Your dish is saved to your account", description: "You'll find the party under Kitchen → Parties." });
    },
    onError: (err) => toast({ title: "We couldn't move your dish to your account", description: partyErrorText(err), variant: "destructive" }),
  });

  // Back from sign-up: claim once, then tidy the address
  const claimed = useRef(false);
  useEffect(() => {
    if (!wantsClaim || authLoading || !signedIn || claimed.current) return;
    claimed.current = true;
    if (getGuestToken(token)) claim.mutate();
    navigate(guestPath(token), { replace: true });
  }, [wantsClaim, authLoading, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (query.data?.title) document.title = `${query.data.title} · Grammie`;
  }, [query.data?.title]);

  const party = query.data;
  return (
    <PartyChrome signedIn={signedIn} token={token}>
      {authLoading || query.isLoading ? (
        <LoadingState label="Opening the party" rows={5} />
      ) : query.error instanceof PartyApiError && (query.error.status === 404 || query.error.status === 410) ? (
        <EmptyState
          icon={CalendarX}
          title="This invite link doesn't work anymore"
          description="The party may have been cancelled, or the host made a new link. Ask the host to send it again."
        />
      ) : query.isError || !party ? (
        <ErrorState title="Couldn't open the party" description={partyErrorText(query.error)} onRetry={() => query.refetch()} />
      ) : (
        <div className="space-y-6">
          {signedIn && hasStoredGuest && !wantsClaim && (
            <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-4">
              <p className="text-base font-medium">You joined this party as a guest on this device.</p>
              <p className="text-sm">Move your answers and dish to your account?</p>
              <Button disabled={claim.isPending} onClick={() => claim.mutate()}>
                {claim.isPending && <Loader2 className="motion-safe:animate-spin" aria-hidden />} Move them to my account
              </Button>
            </div>
          )}
          <GuestView party={party} token={token} signedIn={signedIn} firstName={user?.firstName} />
        </div>
      )}
    </PartyChrome>
  );
}

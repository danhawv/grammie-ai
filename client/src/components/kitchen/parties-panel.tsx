import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CalendarDays, ChevronRight, MapPin, PartyPopper, Plus } from "lucide-react";
import type { PartySummary } from "@shared/party";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-states";
import { CreatePartySheet } from "@/components/party/create-party";
import { STYLE_TEXT } from "@/components/party/party-bits";
import { useAuth } from "@/hooks/useAuth";
import { mediaUrl } from "@/lib/platform";
import { partyApi, partyKeys, partyErrorText } from "@/lib/party-api";
import { formatPartyDate, partyPath } from "@/lib/party-format";

// Kitchen → Parties: dinner parties and potlucks you're hosting or going to,
// and "Plan a party".

export function PartiesPanel() {
  const { user, isLoading: authLoading } = useAuth();
  const [creating, setCreating] = useState(false);
  const query = useQuery({ queryKey: partyKeys.list, queryFn: partyApi.list, enabled: !!user });

  if (!authLoading && !user) {
    return (
      <EmptyState
        icon={PartyPopper}
        title="Plan a dinner party or potluck"
        description="Sign in to make a party. Guests pick what they're bringing from one link, and Grammie flags allergies."
        action={<Button asChild><Link href="/login">Sign in</Link></Button>}
      />
    );
  }

  const parties = query.data ?? [];
  const hosting = parties.filter((p) => p.role === "host");
  const going = parties.filter((p) => p.role !== "host");

  return (
    <div className="space-y-6">
      {query.isLoading || authLoading ? (
        <LoadingState label="Loading your parties" rows={3} />
      ) : query.isError ? (
        <ErrorState title="Couldn't load your parties" description={partyErrorText(query.error)} onRetry={() => query.refetch()} />
      ) : parties.length === 0 ? (
        <EmptyState
          icon={PartyPopper}
          title="No parties yet"
          description="Plan a dinner party or a potluck. Send one link, and guests pick what they're bringing. Grammie flags allergies and sizes the recipes."
          action={<Button onClick={() => setCreating(true)} data-testid="button-plan-party"><Plus aria-hidden /> Plan a party</Button>}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-base text-muted-foreground">Dinner parties and potlucks</p>
            <Button onClick={() => setCreating(true)} data-testid="button-plan-party"><Plus aria-hidden /> Plan a party</Button>
          </div>
          {hosting.length > 0 && <PartyList title="You're hosting" parties={hosting} />}
          {going.length > 0 && <PartyList title="You're going" parties={going} />}
        </>
      )}
      <CreatePartySheet open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function PartyList({ title, parties }: { title: string; parties: PartySummary[] }) {
  return (
    <section className="space-y-3" aria-label={title}>
      <h2 className="text-xl font-semibold">{title}</h2>
      <ul className="divide-y rounded-lg border bg-card">
        {parties.map((p) => {
          const when = formatPartyDate(p.startsAt);
          return (
            <li key={p.id}>
              <Link href={partyPath(p.id)} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                {p.coverImage ? (
                  <img src={mediaUrl(p.coverImage)} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" loading="lazy" />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-primary/10" aria-hidden>
                    <PartyPopper className="h-6 w-6 text-primary" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold break-words">{p.title}</span>
                    <Badge variant="secondary">{STYLE_TEXT[p.style].short}</Badge>
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                    {when && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" aria-hidden />{when}</span>}
                    {p.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden />{p.location}</span>}
                    <span>{p.guestCount} {p.guestCount === 1 ? "guest" : "guests"} · {p.dishCount} {p.dishCount === 1 ? "dish" : "dishes"}</span>
                  </span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

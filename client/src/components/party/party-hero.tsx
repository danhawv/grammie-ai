import { CalendarDays, ExternalLink, MapPin, Users } from "lucide-react";
import { inviteSite, type PartyDetail } from "@shared/party";
import { Button } from "@/components/ui/button";
import { mediaUrl, openExternal } from "@/lib/platform";
import { formatPartyDate } from "@/lib/party-format";
import { STYLE_TEXT, StyleBadge } from "./party-bits";

// The top of a party page: cover, name, when and where, the kind of party in
// plain words, and the host's note.

const SITE_NAMES: Record<string, string> = { partiful: "Partiful", evite: "Evite", luma: "Luma", paperless: "Paperless Post" };

export function PartyFacts({ party }: { party: PartyDetail }) {
  const when = formatPartyDate(party.startsAt);
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-base text-muted-foreground">
      {when && <li className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" aria-hidden />{when}</li>}
      {party.location && <li className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" aria-hidden />{party.location}</li>}
      <li className="inline-flex items-center gap-1.5">
        <Users className="h-4 w-4" aria-hidden />
        {party.confirmedPeople} coming{party.role === "host" ? ` · planning for ${party.headcount}` : ""}
      </li>
    </ul>
  );
}

export function PartyHero({ party }: { party: PartyDetail }) {
  const ext = party.externalInviteUrl;
  const site = ext ? SITE_NAMES[inviteSite(ext)] : null;
  return (
    <header className="space-y-4">
      {party.coverImage && (
        <img src={mediaUrl(party.coverImage)} alt="" className="aspect-[2/1] w-full rounded-lg object-cover" />
      )}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <StyleBadge style={party.style} />
          {party.theme && <span className="text-sm text-muted-foreground">{party.theme}</span>}
        </div>
        <h1 className="font-serif text-3xl font-bold leading-tight break-words">{party.title}</h1>
        <p className="text-base">Hosted by {party.hostName}</p>
        <PartyFacts party={party} />
      </div>
      <p className="text-base text-muted-foreground">{STYLE_TEXT[party.style].explain}</p>
      {party.hostNote && (
        <blockquote className="rounded-lg border-l-4 border-primary bg-muted/40 px-4 py-3 text-base">
          {party.hostNote}
          <span className="mt-1 block text-sm text-muted-foreground">— {party.hostName}</span>
        </blockquote>
      )}
      {ext && (
        <Button variant="outline" onClick={() => void openExternal(ext)}>
          <ExternalLink aria-hidden /> {site ? `See the ${site} invite` : "See the invite"}
        </Button>
      )}
    </header>
  );
}

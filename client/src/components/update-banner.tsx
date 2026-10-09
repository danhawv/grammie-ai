import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// A tab left open keeps running the app it loaded, even after a new version
// is deployed (a tab open since the morning still showed a message we'd
// already removed). Look for a new build every few minutes and when the
// tab comes back into view, and offer a refresh. The build is identified by
// the hashed name of the main script in index.html.

const CHECK_EVERY_MS = 5 * 60_000;

function currentBuild(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return s ? new URL(s.src, location.href).pathname : null;
}

async function latestBuild(): Promise<string | null> {
  const res = await fetch("/", { cache: "no-store", headers: { Accept: "text/html" } });
  if (!res.ok) return null;
  return (await res.text()).match(/\/assets\/index-[\w-]+\.js/)?.[0] ?? null;
}

export function UpdateBanner() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const mine = currentBuild();
    if (!mine) return; // dev server: no built script to compare
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const latest = await latestBuild();
        if (latest && latest !== mine) setStale(true);
      } catch {
        /* offline; try again later */
      }
    };
    const timer = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  if (!stale) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-50 flex flex-wrap items-center justify-center gap-3 border-t bg-background p-3 shadow-lg sm:bottom-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:rounded-lg sm:border"
      data-testid="update-banner"
    >
      <p className="text-sm">Grammie has been updated. Refresh to get the latest version.</p>
      <Button size="sm" onClick={() => location.reload()}>
        <RefreshCw aria-hidden /> Refresh
      </Button>
    </div>
  );
}

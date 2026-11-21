import { useEffect, useId, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/platform";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// "Delete my account" (Me > Account; Apple guideline 5.1.1(v)). The server
// side is DELETE /api/account (server/routes/account.ts). After it's done the
// caller signs out and goes home.

const CONFIRM_WORD = "DELETE";
const DELETED_FLAG = "grammie-account-deleted";

/** Call just before signing out: the toast shows on the next page, even after a reload */
export function noteAccountDeleted(): void {
  try { sessionStorage.setItem(DELETED_FLAG, "1"); } catch { /* storage blocked: no toast */ }
}

/** Mounted once (App.tsx): shows "Your account has been deleted." after the sign-out */
export function AccountDeletedToast() {
  const [location] = useLocation();
  const { toast } = useToast();
  useEffect(() => {
    let flagged = false;
    try {
      flagged = sessionStorage.getItem(DELETED_FLAG) === "1";
      if (flagged) sessionStorage.removeItem(DELETED_FLAG);
    } catch { /* ignore */ }
    if (flagged) toast({ title: "Your account has been deleted." });
  }, [location, toast]);
  return null;
}

export function DeleteAccount({ onDeleted }: { onDeleted: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();
  const ready = typed.trim().toUpperCase() === CONFIRM_WORD;

  const close = (o: boolean) => {
    if (busy) return;
    setOpen(o);
    if (!o) { setTyped(""); setError(null); }
  };

  const remove = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Nothing should ask for (and recreate) the account while it goes
      await queryClient.cancelQueries();
      const res = await apiFetch("/api/account", { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || "We couldn't delete your account just now. Nothing was removed. Please try again.");
        setBusy(false);
        return;
      }
      queryClient.clear();
      await onDeleted();
    } catch {
      setError("We couldn't reach Grammie. Check your connection and try again. Nothing was removed.");
      setBusy(false);
    }
  };

  return (
    <div className="border-t pt-4">
      <Button variant="destructive" onClick={() => setOpen(true)} data-testid="button-delete-account">
        <Trash2 aria-hidden /> Delete my account
      </Button>

      <AlertDialog open={open} onOpenChange={close}>
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-left text-base text-foreground">
                <p>This deletes your account and everything in it, for good. It can't be undone.</p>
                <div>
                  <p className="font-semibold">What will be deleted</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    <li>All your recipes and the photos you uploaded</li>
                    <li>Your cookbooks, and the sharing you set up for them</li>
                    <li>Your meal plans and meal-prep plans</li>
                    <li>Your grocery list and pantry</li>
                    <li>Parties you're hosting, and your places at other people's parties</li>
                    <li>Your food profile and settings</li>
                    <li>Any credits you have left</li>
                    <li>Your sign-in, so you can't sign back in to this account</li>
                  </ul>
                </div>
                <p>
                  Your recipes will also disappear from other people's cookbooks you added them to. Copies other people
                  saved of your recipes are theirs, and stay.
                </p>
                <p>
                  If a printed book is still on its way, you'll be able to delete your account once it's delivered.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor={inputId} className="text-base">Type {CONFIRM_WORD} to confirm</Label>
            <Input
              id={inputId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void remove(); } }}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy}
              className="text-base"
              aria-describedby={error ? errorId : undefined}
              data-testid="input-delete-confirm"
            />
            {error && (
              <p id={errorId} role="alert" className="text-sm text-destructive">{error}</p>
            )}
          </div>

          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={busy}>Keep my account</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => void remove()}
              disabled={!ready || busy}
              data-testid="button-delete-account-confirm"
            >
              {busy ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
              {busy ? "Deleting…" : "Delete everything"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

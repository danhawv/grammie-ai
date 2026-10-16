import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Pencil, ShoppingCart, Trash2 } from "lucide-react";
import { COURSES, openSlots, type PartyCourse, type PartyDetail, type PartyDish } from "@shared/party";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { partyApi, partyErrorText, partyKeys } from "@/lib/party-api";
import { formatScale, isImporting } from "@/lib/party-format";
import { slotName } from "./party-bits";

// What a guest can do with their own dish: change it, take it off the menu,
// and (signed in) put its ingredients on their grocery list.

function refreshParty(token: string) {
  queryClient.invalidateQueries({ queryKey: partyKeys.invite(token) });
  queryClient.invalidateQueries({ queryKey: ["parties", "host"] });
  queryClient.invalidateQueries({ queryKey: partyKeys.list });
}

export function OwnDishActions({ party, token, dish, signedIn }: { party: PartyDetail; token: string; dish: PartyDish; signedIn: boolean }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);

  const remove = useMutation({
    mutationFn: () => partyApi.removeDish(token, dish.id),
    onSuccess: () => { refreshParty(token); toast({ title: `${dish.title} is off the menu` }); },
    onError: (err) => toast({ title: "Couldn't remove that dish", description: partyErrorText(err), variant: "destructive" }),
  });

  // The usual recipe → grocery list call. The scale goes along for the server
  // to use; until it does, the list has one batch and we say how much more.
  const grocery = useMutation({
    mutationFn: () => apiRequest("POST", `/api/grocery-list/recipes/${dish.recipe!.id}`, dish.scale !== 1 ? { scale: dish.scale } : undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/grocery-list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/grocery-list/by-aisle"] });
      toast({
        title: "Added to your grocery list",
        description: dish.scale !== 1 ? `Remember you're making ${formatScale(dish.scale)}× the recipe.` : undefined,
      });
    },
    onError: () => toast({ title: "Couldn't add to your grocery list", description: "Check your connection and try again.", variant: "destructive" }),
  });

  const canGrocery = signedIn && !!dish.recipe && !isImporting(dish.recipe) && dish.recipe.status !== "failed";
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil aria-hidden /> Change</Button>
      {canGrocery && (
        <Button variant="outline" size="sm" disabled={grocery.isPending} onClick={() => grocery.mutate()}>
          {grocery.isPending ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <ShoppingCart aria-hidden />} Add ingredients to my grocery list
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={() => setRemoving(true)}><Trash2 aria-hidden /> Remove</Button>

      <EditDishDialog party={party} token={token} dish={dish} open={editing} onClose={() => setEditing(false)} />
      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Take {dish.title} off the menu?</AlertDialogTitle>
            <AlertDialogDescription>The place opens up again for someone else.{dish.recipe ? " The recipe stays saved." : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => remove.mutate()}>Take it off</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const EXTRA = "__extra";

function EditDishDialog({ party, token, dish, open, onClose }: { party: PartyDetail; token: string; dish: PartyDish; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [place, setPlace] = useState<string>(EXTRA);
  const [course, setCourse] = useState<PartyCourse>(dish.course);
  const [title, setTitle] = useState(dish.title);
  const [note, setNote] = useState(dish.note ?? "");

  useEffect(() => {
    if (!open) return;
    setPlace(dish.slotId ?? EXTRA); setCourse(dish.course); setTitle(dish.title); setNote(dish.note ?? "");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const choices = [
    ...party.slots.filter((s) => s.id === dish.slotId),
    ...openSlots(party.slots, party.dishes),
  ].sort((a, b) => a.position - b.position);

  const save = useMutation({
    mutationFn: () => {
      const slot = party.slots.find((s) => s.id === place);
      return partyApi.updateDish(token, dish.id, {
        slotId: slot ? slot.id : null,
        course: slot ? slot.course : course,
        ...(dish.recipe ? {} : { title: title.trim() }),
        note: note.trim() || null,
      });
    },
    onSuccess: () => { refreshParty(token); toast({ title: "Saved" }); onClose(); },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change your dish</DialogTitle>
          <DialogDescription>Move it to another course or add a note.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!dish.recipe && (
            <div className="space-y-2">
              <Label htmlFor="ed-title" className="text-base">What you're bringing</Label>
              <Input id="ed-title" className="min-h-11" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          )}
          <div className="space-y-2">
            <Label className="text-base">Where it goes on the menu</Label>
            <Select value={place} onValueChange={setPlace}>
              <SelectTrigger className="min-h-11" aria-label="Where it goes on the menu"><SelectValue /></SelectTrigger>
              <SelectContent>
                {choices.map((s) => <SelectItem key={s.id} value={s.id}>{slotName(s)}</SelectItem>)}
                <SelectItem value={EXTRA}>Something extra</SelectItem>
              </SelectContent>
            </Select>
            {place === EXTRA && (
              <Select value={course} onValueChange={(v) => setCourse(v as PartyCourse)}>
                <SelectTrigger className="min-h-11" aria-label="Course"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COURSES.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="ed-note" className="text-base">A note (optional)</Label>
            <Input id="ed-note" className="min-h-11" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {save.isError && <p className="text-sm text-destructive" role="alert">{partyErrorText(save.error)}</p>}
        </div>
        <DialogFooter className="flex-row gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" disabled={save.isPending || (!dish.recipe && !title.trim())} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="motion-safe:animate-spin" aria-hidden />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

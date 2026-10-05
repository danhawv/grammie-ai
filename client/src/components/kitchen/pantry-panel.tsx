import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  Camera,
  ChefHat,
  Loader2,
  Mic,
  Package,
  Plus,
  ShoppingCart,
  Sparkles,
  Square,
  Star,
  Trash2,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToastAction } from "@/components/ui/toast";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-states";
import { PhotoPicker } from "@/components/photo-picker";
import { useToast } from "@/hooks/use-toast";
import { useUndoable } from "@/hooks/use-undoable";
import { downscaleImage } from "@/lib/images";
import { useHiddenIds } from "./use-hidden-ids";
import type { PantryItem, PantryScanSession, PantryStaple } from "@shared/schema";
import { parseAmount } from "@shared/pantry-match";

const PANTRY_CATEGORIES = [
  "produce", "dairy", "meat", "seafood", "bakery", "frozen",
  "canned", "dry-goods", "condiments", "beverages", "snacks", "other",
] as const;

const categoryLabel = (c: string) => c.charAt(0).toUpperCase() + c.slice(1).replace("-", " ");

const US_UNITS = ["oz", "lb", "fl oz", "cup", "tbsp", "tsp", "pcs", "bunch", "can", "jar", "bag", "box", "bottle", "pack"];
const METRIC_UNITS = ["g", "kg", "ml", "L", "pcs", "bunch", "can", "jar", "bag", "box", "bottle", "pack"];
const UNIT_LABELS: Record<string, string> = {
  oz: "ounces (oz)", lb: "pounds (lb)", "fl oz": "fluid ounces", cup: "cups", tbsp: "tablespoons", tsp: "teaspoons",
  pcs: "pieces", g: "grams (g)", kg: "kilograms (kg)", ml: "milliliters (ml)", L: "liters (L)",
};

// Suggested shelf life by category, in days
const EXPIRATION_DEFAULTS: Record<string, number> = {
  produce: 5, dairy: 10, meat: 3, seafood: 2, bakery: 5, frozen: 90, canned: 365, "dry-goods": 180,
};

type ExpiryState = "none" | "ok" | "soon" | "expired";

/** Expiry in words; a badge only shows when it's worth acting on. */
function expiryInfo(expiresAt: string | Date | null | undefined): { state: ExpiryState; text: string | null; badge: string | null } {
  if (!expiresAt) return { state: "none", text: null, badge: null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expiresAt);
  exp.setHours(0, 0, 0, 0);
  const days = Math.round((exp.getTime() - today.getTime()) / 86_400_000);
  const date = exp.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (days < 0) return { state: "expired", text: `Expired ${Math.abs(days)} day${days === -1 ? "" : "s"} ago`, badge: "Expired" };
  if (days === 0) return { state: "soon", text: "Expires today", badge: "Use today" };
  if (days <= 3) return { state: "soon", text: `Expires ${date}`, badge: "Use soon" };
  return { state: "ok", text: `Expires ${date}`, badge: null };
}

function formatQuantity(qty: number | null | undefined): string {
  if (qty === null || qty === undefined) return "";
  if (Number.isInteger(qty)) return qty.toString();
  return (Math.round(qty * 100) / 100).toString();
}

function invalidatePantry() {
  queryClient.invalidateQueries({ queryKey: ["/api/pantry/items"] });
  queryClient.invalidateQueries({ queryKey: ["/api/pantry"] });
  queryClient.invalidateQueries({ queryKey: ["/api/pantry/restock"] });
  queryClient.invalidateQueries({ queryKey: ["/api/recipes/what-can-i-make"] });
}

/** Toast after adding several items, with an Undo that removes them again. */
function useAddedToast() {
  const { toast } = useToast();
  return useCallback(
    (items: { id: string }[], title: string) => {
      if (items.length === 0) return;
      toast({
        title,
        duration: 10_000,
        action: (
          <ToastAction
            altText="Undo"
            onClick={async () => {
              await Promise.allSettled(items.map((i) => apiRequest("DELETE", `/api/pantry/items/${i.id}`)));
              invalidatePantry();
            }}
          >
            Undo
          </ToastAction>
        ),
      });
    },
    [toast],
  );
}

// ============================================================================
// Add / edit dialog
// ============================================================================

interface ItemFormValues {
  name: string;
  category: string;
  quantity: string;
  unit: string;
  expires: string;
}

const EMPTY_FORM: ItemFormValues = { name: "", category: "other", quantity: "", unit: "", expires: "" };

function ItemDialog({
  open,
  onOpenChange,
  item,
  defaultUnitSystem,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: PantryItem | null;
  defaultUnitSystem: "us" | "metric";
}) {
  const { toast } = useToast();
  const [values, setValues] = useState<ItemFormValues>(EMPTY_FORM);
  const [unitSystem, setUnitSystem] = useState<"us" | "metric">(defaultUnitSystem);
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuantityError(null);
    setNameError(null);
    setUnitSystem(defaultUnitSystem);
    setValues(
      item
        ? {
            name: item.name,
            category: item.category || "other",
            quantity: item.quantity != null ? formatQuantity(item.quantity) : "",
            unit: item.unit || "",
            expires: item.expiresAt ? new Date(item.expiresAt).toISOString().split("T")[0] : "",
          }
        : EMPTY_FORM,
    );
  }, [open, item, defaultUnitSystem]);

  const units = unitSystem === "us" ? US_UNITS : METRIC_UNITS;
  // Keep an existing unit selectable even if it belongs to the other system
  const unitOptions = values.unit && !units.includes(values.unit) ? [values.unit, ...units] : units;

  const saveMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      item ? apiRequest("PATCH", `/api/pantry/items/${item.id}`, body) : apiRequest("POST", "/api/pantry/items", body),
    onSuccess: () => {
      invalidatePantry();
      onOpenChange(false);
      toast({ title: item ? "Saved" : `Added ${values.name.trim()} to your pantry` });
    },
  });

  const validateQuantity = (q: string) => {
    if (!q.trim()) return null;
    return parseAmount(q) === null ? "Enter a number like 2, 1.5 or 1 1/2." : null;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = values.name.trim();
    const qErr = validateQuantity(values.quantity);
    setNameError(name ? null : "Enter what the item is, for example “eggs”.");
    setQuantityError(qErr);
    if (!name || qErr) return;
    const quantity = values.quantity.trim() ? parseAmount(values.quantity) : null;
    const expiresAt = values.expires ? new Date(values.expires).toISOString() : null;
    if (item) {
      saveMutation.mutate({ name, category: values.category, quantity, unit: values.unit || null, expiresAt });
    } else {
      saveMutation.mutate({
        name,
        category: values.category,
        quantity: quantity ?? undefined,
        unit: values.unit || undefined,
        expiresAt: expiresAt ?? undefined,
      });
    }
  };

  const suggestDays = EXPIRATION_DEFAULTS[values.category];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? `Edit ${item.name}` : "Add to your pantry"}</DialogTitle>
          <DialogDescription>Only the name is needed. Amounts and dates help Grammie suggest what to cook first.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1">
            <Label htmlFor="pantry-name">Item</Label>
            <Input
              id="pantry-name"
              value={values.name}
              onChange={(e) => { setValues({ ...values, name: e.target.value }); if (nameError) setNameError(null); }}
              placeholder="e.g. eggs"
              autoComplete="off"
              className="h-11 text-base"
              aria-invalid={!!nameError}
              aria-describedby={nameError ? "pantry-name-error" : undefined}
              data-testid="input-item-name"
            />
            {nameError && <p id="pantry-name-error" className="text-sm text-destructive">{nameError}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor="pantry-category">Category</Label>
            <Select value={values.category} onValueChange={(v) => setValues({ ...values, category: v })}>
              <SelectTrigger id="pantry-category" className="h-11 text-base" data-testid="select-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PANTRY_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c} className="min-h-11 text-base">{categoryLabel(c)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Amount (optional)</legend>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Unit system">
              {(["us", "metric"] as const).map((sys) => (
                <Button
                  key={sys}
                  type="button"
                  variant={unitSystem === sys ? "secondary" : "outline"}
                  aria-pressed={unitSystem === sys}
                  onClick={() => setUnitSystem(sys)}
                >
                  {sys === "us" ? "US units" : "Metric units"}
                </Button>
              ))}
            </div>
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="pantry-quantity" className="sr-only">How much</Label>
                <Input
                  id="pantry-quantity"
                  inputMode="decimal"
                  value={values.quantity}
                  onChange={(e) => { setValues({ ...values, quantity: e.target.value }); if (quantityError) setQuantityError(validateQuantity(e.target.value)); }}
                  onBlur={() => setQuantityError(validateQuantity(values.quantity))}
                  placeholder="e.g. 1 1/2"
                  className="h-11 text-base"
                  aria-invalid={!!quantityError}
                  aria-describedby={quantityError ? "pantry-quantity-error" : undefined}
                  data-testid="input-quantity"
                />
              </div>
              <div className="w-44">
                <Label htmlFor="pantry-unit" className="sr-only">Unit</Label>
                <Select value={values.unit || "none"} onValueChange={(v) => setValues({ ...values, unit: v === "none" ? "" : v })}>
                  <SelectTrigger id="pantry-unit" className="h-11 text-base" data-testid="select-unit">
                    <SelectValue placeholder="Unit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" className="min-h-11 text-base">No unit</SelectItem>
                    {unitOptions.map((u) => (
                      <SelectItem key={u} value={u} className="min-h-11 text-base">{UNIT_LABELS[u] || u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {quantityError && <p id="pantry-quantity-error" className="text-sm text-destructive">{quantityError}</p>}
          </fieldset>

          <div className="space-y-1">
            <Label htmlFor="pantry-expires">Use by (optional)</Label>
            <Input
              id="pantry-expires"
              type="date"
              value={values.expires}
              onChange={(e) => setValues({ ...values, expires: e.target.value })}
              className="h-11 text-base"
            />
            {suggestDays && !values.expires && (
              <Button
                type="button"
                variant="ghost"
                className="px-2 text-primary"
                onClick={() => {
                  const d = new Date();
                  d.setDate(d.getDate() + suggestDays);
                  setValues({ ...values, expires: d.toISOString().split("T")[0] });
                }}
              >
                Use a typical date ({suggestDays} days from today)
              </Button>
            )}
          </div>

          {saveMutation.isError && (
            <p role="alert" className="text-sm text-destructive">Couldn't save. Check your connection and try again.</p>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saveMutation.isPending} data-testid="button-confirm-add">
              {saveMutation.isPending && <Loader2 className="motion-safe:animate-spin" aria-hidden />}
              {item ? "Save changes" : "Add to pantry"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Photo scan: upload → Grammie reads it → you review → add
// ============================================================================

type ScanItem = NonNullable<PantryScanSession["extractedItems"]>[number] & { keep: boolean };

function ScanDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const showAdded = useAddedToast();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [review, setReview] = useState<ScanItem[] | null>(null);
  const lastFile = useRef<File | null>(null);

  const reset = () => {
    setSessionId(null);
    setReview(null);
    setUploadError(null);
    setUploading(false);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
  };

  useEffect(() => {
    if (!open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { data: session } = useQuery<PantryScanSession>({
    queryKey: ["/api/pantry/scan", sessionId],
    enabled: !!sessionId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "ready" || s === "failed" ? false : 2000;
    },
  });

  useEffect(() => {
    if (session?.status === "ready" && review === null) {
      setReview((session.extractedItems || []).map((i) => ({ ...i, keep: true })));
    }
  }, [session, review]);

  const upload = async (file: File) => {
    lastFile.current = file;
    setUploadError(null);
    setReview(null);
    setSessionId(null);
    setUploading(true);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    try {
      const blob = await downscaleImage(file);
      const form = new FormData();
      form.append("image", blob, blob === file ? file.name : "pantry.jpg");
      const res = await apiRequest("POST", "/api/pantry/scan", form);
      const data = await res.json();
      setSessionId(data.sessionId);
    } catch {
      setUploadError("Couldn't send the photo. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  const confirmMutation = useMutation({
    mutationFn: async (items: ScanItem[]) =>
      (await apiRequest("POST", `/api/pantry/scan/${sessionId}/confirm`, {
        items: items.map(({ keep: _keep, ...rest }) => ({ ...rest, name: rest.name.trim() })),
      })).json(),
    onSuccess: (data: { added: number; items: { id: string }[] }) => {
      invalidatePantry();
      onOpenChange(false);
      showAdded(data.items || [], `Added ${data.added} item${data.added === 1 ? "" : "s"} to your pantry`);
    },
  });

  const reading = uploading || (!!sessionId && session?.status !== "ready" && session?.status !== "failed");
  const failed = session?.status === "failed";
  const kept = (review || []).filter((i) => i.keep && i.name.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Scan a photo of your shelves</DialogTitle>
          <DialogDescription>
            Take a photo of your fridge or pantry. Grammie lists what she sees, and you choose what to add.
          </DialogDescription>
        </DialogHeader>

        {preview && <img src={preview} alt="Your photo" className="max-h-56 w-full rounded-lg object-cover" />}

        {!sessionId && !uploading && (
          <>
            <PhotoPicker onPick={(files) => upload(files[0])} multiple={false} libraryLabel="Choose a photo" />
            {uploadError && (
              <div role="alert" className="space-y-2">
                <p className="text-sm text-destructive">{uploadError}</p>
                {lastFile.current && <Button variant="outline" onClick={() => upload(lastFile.current!)}>Try again</Button>}
              </div>
            )}
          </>
        )}

        {reading && (
          <p role="status" className="flex items-center gap-2 text-base text-muted-foreground">
            <Loader2 className="h-5 w-5 motion-safe:animate-spin" aria-hidden />
            Reading your photo… this takes about 10–20 seconds.
          </p>
        )}

        {failed && (
          <div role="alert" className="space-y-3">
            <p className="text-base">Grammie couldn't read that photo. A closer, brighter photo of the shelf usually works.</p>
            <Button variant="outline" onClick={reset}>Choose another photo</Button>
          </div>
        )}

        {review && (
          review.length === 0 ? (
            <div className="space-y-3">
              <p className="text-base">Grammie didn't find any food in that photo. Try a closer photo of one shelf.</p>
              <Button variant="outline" onClick={reset}>Choose another photo</Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm font-medium text-primary">
                <Sparkles className="h-4 w-4" aria-hidden />
                Found by Grammie — check the names before adding
              </p>
              <ul className="space-y-2">
                {review.map((item, idx) => (
                  <li key={idx} className="flex items-center gap-2">
                    <Checkbox
                      id={`scan-keep-${idx}`}
                      checked={item.keep}
                      onCheckedChange={(v) => setReview(review.map((r, i) => (i === idx ? { ...r, keep: Boolean(v) } : r)))}
                      className="h-6 w-6"
                      aria-label={`Add ${item.name}`}
                    />
                    <Label htmlFor={`scan-name-${idx}`} className="sr-only">Item name</Label>
                    <Input
                      id={`scan-name-${idx}`}
                      value={item.name}
                      onChange={(e) => setReview(review.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)))}
                      className="h-11 flex-1 text-base"
                    />
                    {item.quantity != null && (
                      <span className="shrink-0 text-sm text-muted-foreground">{item.quantity} {item.unit || ""}</span>
                    )}
                  </li>
                ))}
              </ul>
              {confirmMutation.isError && (
                <p role="alert" className="text-sm text-destructive">Couldn't add these. Check your connection and try again.</p>
              )}
              <Button
                className="w-full"
                disabled={kept.length === 0 || confirmMutation.isPending}
                onClick={() => confirmMutation.mutate(kept)}
                data-testid="button-confirm-scan"
              >
                {confirmMutation.isPending && <Loader2 className="motion-safe:animate-spin" aria-hidden />}
                Add {kept.length} item{kept.length === 1 ? "" : "s"} to pantry
              </Button>
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Voice: speak, review the transcript, add
// ============================================================================

function useSpeech() {
  const [supported] = useState(
    () => typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition),
  );
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<any>(null);

  const start = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    let finalText = "";
    rec.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalText += r[0].transcript + " ";
        else interim += r[0].transcript;
      }
      setTranscript(finalText + interim);
    };
    rec.onerror = (event: any) => {
      setError(
        event.error === "not-allowed"
          ? "The microphone is blocked. Allow microphone access for this site in your browser settings, then try again."
          : "Couldn't hear that. Try again in a quieter spot.",
      );
      setRecording(false);
    };
    rec.onend = () => setRecording(false);
    ref.current = rec;
    setTranscript("");
    setError(null);
    rec.start();
    setRecording(true);
  }, []);

  const stop = useCallback(() => {
    ref.current?.stop();
    ref.current = null;
    setRecording(false);
  }, []);

  useEffect(() => () => ref.current?.stop(), []);

  return { supported, recording, transcript, setTranscript, error, start, stop };
}

function VoiceCard({ speech, onClose }: { speech: ReturnType<typeof useSpeech>; onClose: () => void }) {
  const showAdded = useAddedToast();
  const voiceMutation = useMutation({
    mutationFn: async (transcript: string) =>
      (await apiRequest("POST", "/api/pantry/voice", { transcript })).json() as Promise<{ items: { id: string }[]; message: string }>,
    onSuccess: (data) => {
      invalidatePantry();
      if (data.items.length > 0) {
        showAdded(data.items, data.message);
        speech.setTranscript("");
        onClose();
      }
    },
  });

  return (
    <section aria-label="Add by voice" className="space-y-3 rounded-lg border border-primary/30 bg-card p-4">
      {speech.recording ? (
        <>
          <p className="flex items-center gap-2 text-base font-medium" role="status">
            <span className="h-3 w-3 rounded-full bg-red-600" aria-hidden />
            Listening… say what you have, like “a dozen eggs, milk and two pounds of chicken thighs”.
          </p>
          {speech.transcript && <p className="text-base text-muted-foreground">{speech.transcript}</p>}
          <Button variant="outline" onClick={speech.stop}>
            <Square aria-hidden /> Stop
          </Button>
        </>
      ) : (
        <>
          <Label htmlFor="voice-transcript" className="text-base font-medium">Here's what Grammie heard — fix anything before adding</Label>
          <textarea
            id="voice-transcript"
            value={speech.transcript}
            onChange={(e) => speech.setTranscript(e.target.value)}
            rows={3}
            className="w-full rounded-md border bg-background px-3 py-2 text-base"
          />
          {speech.error && <p role="alert" className="text-sm text-destructive">{speech.error}</p>}
          {voiceMutation.data && voiceMutation.data.items.length === 0 && (
            <p role="alert" className="text-sm">{voiceMutation.data.message}</p>
          )}
          {voiceMutation.isError && (
            <p role="alert" className="text-sm text-destructive">Couldn't add those. Check your connection and try again.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => voiceMutation.mutate(speech.transcript.trim())}
              disabled={!speech.transcript.trim() || voiceMutation.isPending}
              data-testid="button-submit-voice"
            >
              {voiceMutation.isPending && <Loader2 className="motion-safe:animate-spin" aria-hidden />}
              Add to pantry
            </Button>
            <Button variant="outline" onClick={speech.start} disabled={voiceMutation.isPending}>
              <Mic aria-hidden /> Say it again
            </Button>
            <Button variant="ghost" onClick={() => { speech.setTranscript(""); onClose(); }}>Cancel</Button>
          </div>
        </>
      )}
    </section>
  );
}

// ============================================================================
// Staples: things you always want stocked
// ============================================================================

function StaplesSection({ onOpenGrocery }: { onOpenGrocery: () => void }) {
  const { toast } = useToast();
  const undoable = useUndoable();
  const { hidden, hide, show } = useHiddenIds();
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [minQuantity, setMinQuantity] = useState("");
  const [unit, setUnit] = useState("");

  const { data: staples, isLoading, isError, refetch } = useQuery<PantryStaple[]>({ queryKey: ["/api/pantry/staples"] });
  const { data: restock } = useQuery<{ staple: PantryStaple; currentQuantity: number | null; needed: boolean }[]>({
    queryKey: ["/api/pantry/restock"],
  });

  const addMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/pantry/staples", {
        name: name.trim(),
        minQuantity: parseAmount(minQuantity) ?? undefined,
        preferredUnit: unit.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pantry/staples"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pantry/restock"] });
      setAddOpen(false);
      setName("");
      setMinQuantity("");
      setUnit("");
    },
  });

  const restockMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/pantry/restock/add-to-grocery"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/grocery-list/by-aisle"] });
      queryClient.invalidateQueries({ queryKey: ["/api/grocery-list"] });
      toast({
        title: "Added to your grocery list",
        action: <ToastAction altText="Open grocery list" onClick={onOpenGrocery}>Open list</ToastAction>,
      });
    },
    onError: () => toast({ title: "Couldn't add to your grocery list", description: "Check your connection and try again.", variant: "destructive" }),
  });

  const removeStaple = (staple: PantryStaple) =>
    undoable({
      message: `Removed ${staple.name} from staples`,
      hide: () => hide([staple.id]),
      restore: () => show([staple.id]),
      commit: async () => {
        await apiRequest("DELETE", `/api/pantry/staples/${staple.id}`);
        queryClient.invalidateQueries({ queryKey: ["/api/pantry/staples"] });
        queryClient.invalidateQueries({ queryKey: ["/api/pantry/restock"] });
      },
    });

  const visible = (staples || []).filter((s) => !hidden.has(s.id));
  const needsRestock = (restock || []).filter((r) => r.needed && !hidden.has(r.staple.id));

  if (isLoading) return <LoadingState label="Loading staples" rows={3} />;
  if (isError) return <ErrorState title="Couldn't load your staples" onRetry={() => refetch()} />;

  return (
    <div className="space-y-4">
      <p className="text-base text-muted-foreground">
        Things you always want in the house. When one runs low, add it to your grocery list in one tap.
      </p>

      {needsRestock.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="flex items-center gap-2 text-base font-medium text-amber-900 dark:text-amber-100">
            <ShoppingCart className="h-5 w-5" aria-hidden />
            {needsRestock.length} staple{needsRestock.length > 1 ? "s" : ""} running low
          </p>
          <Button variant="outline" onClick={() => restockMutation.mutate()} disabled={restockMutation.isPending}>
            {restockMutation.isPending && <Loader2 className="motion-safe:animate-spin" aria-hidden />}
            Add to grocery list
          </Button>
        </div>
      )}

      <Button variant="outline" onClick={() => setAddOpen(true)}>
        <Plus aria-hidden /> Add a staple
      </Button>

      {visible.length === 0 ? (
        <EmptyState
          icon={Star}
          title="No staples yet"
          description="Add things like eggs, milk or coffee, and set how much you like to keep on hand."
        />
      ) : (
        <ul className="space-y-2">
          {visible.map((staple) => {
            const r = restock?.find((x) => x.staple.id === staple.id);
            const low = r?.needed;
            const have = r?.currentQuantity;
            return (
              <li key={staple.id} className="flex items-center gap-3 rounded-lg border bg-card py-2 pl-4 pr-1">
                <div className="min-w-0 flex-1">
                  <p className="text-base font-medium">{staple.emoji ? `${staple.emoji} ` : ""}{staple.name}</p>
                  <p className="text-sm text-muted-foreground">
                    Keep at least {staple.minQuantity ?? 1} {staple.preferredUnit || ""}
                    {have != null && <> · You have {formatQuantity(have)} {staple.preferredUnit || ""}</>}
                  </p>
                </div>
                {low && (
                  <span className="shrink-0 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-sm font-medium text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                    {have == null ? "Out" : "Low"}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeStaple(staple)}
                  aria-label={`Remove ${staple.name} from staples`}
                  title={`Remove ${staple.name}`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a staple</DialogTitle>
            <DialogDescription>Something you always want in the house.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) addMutation.mutate();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="staple-name">Item</Label>
              <Input id="staple-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. eggs" className="h-11 text-base" />
            </div>
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="staple-min">Keep at least (optional)</Label>
                <Input id="staple-min" inputMode="decimal" value={minQuantity} onChange={(e) => setMinQuantity(e.target.value)} placeholder="e.g. 12" className="h-11 text-base" />
              </div>
              <div className="w-36 space-y-1">
                <Label htmlFor="staple-unit">Unit (optional)</Label>
                <Input id="staple-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. eggs" className="h-11 text-base" />
              </div>
            </div>
            {addMutation.isError && <p role="alert" className="text-sm text-destructive">Couldn't save. Check your connection and try again.</p>}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={!name.trim() || addMutation.isPending}>Add staple</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// Pantry panel
// ============================================================================

export function PantryPanel({ onOpenGrocery }: { onOpenGrocery: () => void }) {
  const undoable = useUndoable();
  const { hidden, hide, show } = useHiddenIds();
  const speech = useSpeech();
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PantryItem | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [groupBy, setGroupBy] = useState<"category" | "expiry">("category");
  const [soonOnly, setSoonOnly] = useState(false);
  const [section, setSection] = useState<"have" | "staples">("have");

  const { data: authStatus } = useQuery<{ user: { preferences?: { unitSystem?: "metric" | "us" } } }>({
    queryKey: ["/api/auth/status"],
  });
  const unitSystem = authStatus?.user?.preferences?.unitSystem || "us";

  const { data: pantryItems, isLoading, isError, refetch } = useQuery<PantryItem[]>({ queryKey: ["/api/pantry/items"] });

  const items = useMemo(() => (pantryItems || []).filter((i) => !hidden.has(i.id)), [pantryItems, hidden]);
  const soonItems = items.filter((i) => {
    const s = expiryInfo(i.expiresAt).state;
    return s === "soon" || s === "expired";
  });
  const shown = soonOnly ? soonItems : items;

  const groups = useMemo(() => {
    if (groupBy === "expiry") {
      const sorted = [...shown].sort((a, b) => {
        if (!a.expiresAt && !b.expiresAt) return a.name.localeCompare(b.name);
        if (!a.expiresAt) return 1;
        if (!b.expiresAt) return -1;
        return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
      });
      return [["By use-by date", sorted]] as [string, PantryItem[]][];
    }
    const map = new Map<string, PantryItem[]>();
    for (const item of [...shown].sort((a, b) => a.name.localeCompare(b.name))) {
      const c = item.category || "other";
      if (!map.has(c)) map.set(c, []);
      map.get(c)!.push(item);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => PANTRY_CATEGORIES.indexOf(a as any) - PANTRY_CATEGORIES.indexOf(b as any))
      .map(([c, list]) => [categoryLabel(c), list] as [string, PantryItem[]]);
  }, [shown, groupBy]);

  const removeItem = (item: PantryItem) =>
    undoable({
      message: `Removed ${item.name}`,
      hide: () => hide([item.id]),
      restore: () => show([item.id]),
      commit: async () => {
        await apiRequest("DELETE", `/api/pantry/items/${item.id}`);
        invalidatePantry();
      },
    });

  const openAdd = () => { setEditing(null); setItemDialogOpen(true); };
  const openEdit = (item: PantryItem) => { setEditing(item); setItemDialogOpen(true); };
  const startVoice = () => { setVoiceOpen(true); speech.start(); };

  return (
    <div className="space-y-6">
      {/* The main action on this tab */}
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">What can I make?</h2>
          <p className="text-base text-muted-foreground">Recipes ranked by how much you already have.</p>
        </div>
        <Button asChild size="lg" className="w-full sm:w-auto" data-testid="button-what-can-i-make">
          <Link href="/what-can-i-make">
            <ChefHat aria-hidden />
            What can I make?
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={openAdd} data-testid="button-add-item">
          <Plus aria-hidden /> Add item
        </Button>
        <Button variant="outline" onClick={() => setScanOpen(true)} data-testid="button-scan-pantry">
          <Camera aria-hidden /> Scan a photo
        </Button>
        {speech.supported && (
          <Button
            variant="outline"
            onClick={speech.recording ? speech.stop : startVoice}
            data-testid="button-voice-pantry"
          >
            {speech.recording ? <Square aria-hidden /> : <Mic aria-hidden />}
            {speech.recording ? "Stop listening" : "Add by voice"}
          </Button>
        )}
      </div>

      {voiceOpen && <VoiceCard speech={speech} onClose={() => { speech.stop(); setVoiceOpen(false); }} />}

      <Tabs value={section} onValueChange={(v) => setSection(v as "have" | "staples")}>
        <TabsList className="grid h-auto w-full grid-cols-2">
          <TabsTrigger value="have" className="min-h-11 text-base" data-testid="tab-inventory">What I have</TabsTrigger>
          <TabsTrigger value="staples" className="min-h-11 text-base" data-testid="tab-staples">Always keep stocked</TabsTrigger>
        </TabsList>

        <TabsContent value="have" className="mt-4 space-y-4">
          {isLoading ? (
            <LoadingState label="Loading your pantry" rows={5} />
          ) : isError ? (
            <ErrorState title="Couldn't load your pantry" onRetry={() => refetch()} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Your pantry is empty"
              description="Add what's in your fridge and cupboards, and Grammie will show recipes you can make with it. Salt, oil, flour, sugar and common spices are assumed, so you don't need to add those."
              action={<Button onClick={openAdd}><Plus aria-hidden /> Add item</Button>}
              secondaryAction={<Button variant="outline" onClick={() => setScanOpen(true)}><Camera aria-hidden /> Scan a photo</Button>}
            />
          ) : (
            <>
              {soonItems.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                  <p className="flex items-center gap-2 text-base font-medium text-amber-900 dark:text-amber-100">
                    <AlertTriangle className="h-5 w-5" aria-hidden />
                    {soonItems.length} item{soonItems.length > 1 ? "s" : ""} to use soon
                  </p>
                  <Button variant="outline" onClick={() => setSoonOnly(!soonOnly)} aria-pressed={soonOnly}>
                    {soonOnly ? "Show everything" : "Show them"}
                  </Button>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Group items">
                <span className="text-sm text-muted-foreground">Group by</span>
                <Button variant={groupBy === "category" ? "secondary" : "outline"} aria-pressed={groupBy === "category"} onClick={() => setGroupBy("category")}>
                  Category
                </Button>
                <Button variant={groupBy === "expiry" ? "secondary" : "outline"} aria-pressed={groupBy === "expiry"} onClick={() => setGroupBy("expiry")}>
                  Use-by date
                </Button>
              </div>

              <div className="space-y-6">
                {groups.map(([label, list]) => (
                  <section key={label} aria-label={label}>
                    <h3 className="mb-2 border-b pb-2 text-sm font-semibold text-muted-foreground">{label}</h3>
                    <ul className="space-y-2">
                      {list.map((item) => {
                        const exp = expiryInfo(item.expiresAt);
                        const qty = item.quantity != null || item.unit ? `${formatQuantity(item.quantity)} ${item.unit || ""}`.trim() : "";
                        return (
                          <li key={item.id} className="flex items-center gap-1 rounded-lg border bg-card pr-1" data-testid={`pantry-item-${item.id}`}>
                            <button
                              type="button"
                              onClick={() => openEdit(item)}
                              className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-lg px-4 py-2 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              aria-label={`Edit ${item.name}`}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block text-base font-medium">{item.emoji ? `${item.emoji} ` : ""}{item.name}</span>
                                {(qty || exp.text) && (
                                  <span className="block text-sm text-muted-foreground">
                                    {qty}
                                    {qty && exp.text ? " · " : ""}
                                    {exp.text && (
                                      <span className={exp.state === "expired" ? "font-medium text-red-800 dark:text-red-300" : exp.state === "soon" ? "font-medium text-amber-900 dark:text-amber-200" : ""}>
                                        {exp.text}
                                      </span>
                                    )}
                                  </span>
                                )}
                              </span>
                              {exp.badge && (
                                <span
                                  className={`shrink-0 rounded-full border px-2 py-0.5 text-sm font-medium ${
                                    exp.state === "expired"
                                      ? "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
                                      : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
                                  }`}
                                >
                                  {exp.badge}
                                </span>
                              )}
                            </button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeItem(item)}
                              aria-label={`Remove ${item.name}`}
                              title={`Remove ${item.name}`}
                              className="shrink-0 text-muted-foreground hover:text-destructive"
                              data-testid={`delete-${item.id}`}
                            >
                              <Trash2 aria-hidden />
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="staples" className="mt-4">
          <StaplesSection onOpenGrocery={onOpenGrocery} />
        </TabsContent>
      </Tabs>

      <ItemDialog open={itemDialogOpen} onOpenChange={setItemDialogOpen} item={editing} defaultUnitSystem={unitSystem} />
      <ScanDialog open={scanOpen} onOpenChange={setScanOpen} />
    </div>
  );
}

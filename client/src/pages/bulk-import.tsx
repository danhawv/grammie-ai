import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useRoute } from "wouter";
import { Boxes, Cloud, Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ToastAction } from "@/components/ui/toast";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-states";
import { PhotoPicker } from "@/components/photo-picker";
import { JobStatus, type JobItem } from "@/components/job-status";
import { IntakeReview } from "@/components/bulk-import/intake-review";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/import-api";
import { collectPhotos, uploadPhotos, UploadStopped, type Collected, type SourcePhoto, type UploadProgress } from "@/lib/bulk-upload";
import { DriveError, photosFromPicker, photosFromSharedLink } from "@/lib/google-drive";
import {
  cancelIntake,
  expectPhotos,
  pendingSources,
  restoreIntake,
  startIntake,
  thumbUrl,
  uploadsDone,
  type BulkConfig,
  type IntakeState,
  type IntakeSummaryRow,
} from "@/lib/bulk-api";
import { estimateFirstLook, progressText } from "@shared/bulk-intake";

// "Bring in a whole box of recipes" (docs/BULK_IMPORT.md). /import starts
// one: drop a folder or .zip, choose lots of photos, or bring them from
// Google Drive. /import/:id follows it: uploading and a first look at each
// photo, then the review screen, then the import's progress.

export default function BulkImport() {
  const [, params] = useRoute("/import/:id");
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-8">
      {params?.id ? <IntakePage id={params.id} /> : <StartPage />}
    </div>
  );
}

function useConfig() {
  return useQuery<BulkConfig>({ queryKey: ["/api/bulk-intake/config"] });
}

// ---- Start ------------------------------------------------------------------

function describeSkipped(c: Collected): string | null {
  const bits: string[] = [];
  if (c.skippedPdfs.length) bits.push(`${c.skippedPdfs.length} PDF ${c.skippedPdfs.length === 1 ? "file" : "files"} (PDFs can't be read here yet; save the pages as photos)`);
  if (c.skippedOther) bits.push(`${c.skippedOther} other ${c.skippedOther === 1 ? "file" : "files"}`);
  return bits.length ? `We left out ${bits.join(" and ")}.` : null;
}

function StartPage() {
  const [, navigate] = useLocation();
  const { data: config, isLoading, isError, refetch } = useConfig();
  const { data: open } = useQuery<IntakeSummaryRow[]>({ queryKey: ["/api/bulk-intake"], enabled: !!config?.available });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState("");

  const begin = async (photos: SourcePhoto[], source: "device" | "drive_picker" | "drive_link", note: string | null) => {
    if (!config) return;
    if (!photos.length) {
      setError(note ? `We didn't find any photos. ${note}` : "We didn't find any photos there.");
      return;
    }
    if (photos.length > config.limits.maxPhotosPerBatch) {
      setError(`That's ${photos.length} photos. One box can hold up to ${config.limits.maxPhotosPerBatch}; split them into two folders and bring in one at a time.`);
      return;
    }
    setBusy("Getting ready…");
    try {
      const id = await startIntake(source);
      pendingSources.set(id, photos);
      if (note) sessionStorage.setItem(`bulk-note-${id}`, note);
      navigate(`/import/${id}`);
    } catch (err) {
      setError(apiErrorMessage(err, "We couldn't start. Check your connection and try again."));
      setBusy(null);
    }
  };

  // Called straight from the drop handler: folders in a drop must be opened before it returns
  const fromDevice = (input: File[] | DataTransfer) => {
    setError(null);
    setBusy("Opening your photos…");
    collectPhotos(input)
      .then((c) => {
        const note = [describeSkipped(c), ...c.problems].filter(Boolean).join(" ") || null;
        return begin(c.photos, "device", note);
      })
      .catch(() => setError("We couldn't open those files. Try choosing them again."))
      .finally(() => setBusy(null));
  };

  const fromDrive = async (how: "picker" | "link") => {
    if (!config) return;
    setError(null);
    setBusy("Opening Google Drive…");
    try {
      const photos = how === "picker" ? await photosFromPicker(config.drive.picker!) : await photosFromSharedLink(link, config.drive.link!.apiKey);
      if (how === "picker" && !photos.length) return;
      await begin(photos, how === "picker" ? "drive_picker" : "drive_link", null);
    } catch (err) {
      setError(err instanceof DriveError ? err.message : "Google Drive didn't answer. Try again in a minute.");
    } finally {
      setBusy(null);
    }
  };

  const header = <PageHeader title="Bring in a whole box of recipes" back={{ href: "/", label: "Recipes" }} />;
  if (isLoading) return <>{header}<LoadingState variant="spinner" label="Getting ready…" /></>;
  if (isError || !config) return <>{header}<ErrorState onRetry={() => refetch()} /></>;
  if (!config.available) {
    return (
      <>
        {header}
        <EmptyState icon={Boxes} title="Not turned on yet" description="Bringing in hundreds of photos at once is coming soon. For now, add up to 10 recipes at a time from the Add button." />
      </>
    );
  }

  const resumable = (open ?? []).filter((i) => ["uploading", "pairing", "review", "importing"].includes(i.status));
  const exampleTime = estimateFirstLook(200).timeText;

  return (
    <>
      {header}
      <div className="space-y-6">
        <p className="text-base">
          Got a recipe box, a binder or a folder of photos? Bring them all at once. We'll turn each photo the right way up, put
          fronts and backs together, and set aside ones you already have. You'll see everything before anything is added.
        </p>

        {resumable.length > 0 && (
          <section className="space-y-3 rounded-lg border bg-card p-4" aria-labelledby="resume-heading">
            <h2 id="resume-heading" className="text-lg font-semibold">Pick up where you left off</h2>
            <ul className="space-y-2">
              {resumable.map((i) => (
                <li key={i.id}>
                  <Button asChild variant="outline" className="h-auto min-h-11 w-full justify-start py-2 text-left">
                    <Link href={`/import/${i.id}`}>
                      {i.photos} photos · started {new Date(i.createdAt).toLocaleDateString()} · {i.status === "review" ? "ready for you to check" : i.status === "importing" ? "importing" : "in progress"}
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {busy ? (
          <LoadingState variant="spinner" label={busy} />
        ) : (
          <PhotoPicker onPick={fromDevice} bulk={{ onDropBulk: fromDevice }} allowCamera={false} libraryLabel="Choose photos">
            <Boxes className="h-10 w-10 text-muted-foreground" aria-hidden />
            <p className="hidden text-base md:block">Drag a folder, a .zip file or lots of photos here</p>
            <p className="text-base md:hidden">Choose all your recipe photos at once, or a .zip file</p>
            <p className="text-sm text-muted-foreground">Up to {config.limits.maxPhotosPerBatch} photos. Looking at 200 photos takes {exampleTime}.</p>
          </PhotoPicker>
        )}

        {error && <p className="text-base text-destructive" role="alert">{error}</p>}

        {(config.drive.picker || config.drive.link) && !busy && (
          <section className="space-y-4 rounded-lg border p-4" aria-labelledby="drive-heading">
            <h2 id="drive-heading" className="text-lg font-semibold">From Google Drive</h2>
            {config.drive.picker && (
              <Button variant="outline" onClick={() => void fromDrive("picker")}>
                <Cloud aria-hidden /> Choose from Google Drive
              </Button>
            )}
            {config.drive.link && (
              <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void fromDrive("link"); }}>
                <Label htmlFor="drive-link" className="text-base">Or paste a link to a shared folder</Label>
                <p className="text-sm text-muted-foreground">In Drive, choose Share, set it to “Anyone with the link”, then Copy link.</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input id="drive-link" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="https://drive.google.com/drive/folders/…" value={link} onChange={(e) => setLink(e.target.value)} className="h-11 text-base" />
                  <Button type="submit" variant="outline" disabled={!link.trim()}>
                    <Link2 aria-hidden /> Use this folder
                  </Button>
                </div>
              </form>
            )}
          </section>
        )}
      </div>
    </>
  );
}

// ---- One box of recipes -----------------------------------------------------------

const ACTIVE = new Set(["uploading", "pairing", "importing"]);

function IntakePage({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: config } = useConfig();
  const key = ["/api/bulk-intake", id];
  const { data: intake, isLoading, isError, refetch } = useQuery<IntakeState>({
    queryKey: key,
    refetchInterval: (q) => (q.state.data && ACTIVE.has(q.state.data.status) ? 2000 : false),
  });

  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [note] = useState(() => sessionStorage.getItem(`bulk-note-${id}`));
  const running = useRef(false);

  const send = async (photos: SourcePhoto[], received: Set<string>) => {
    if (running.current) return;
    running.current = true;
    setUploadError(null);
    try {
      // A resumed upload is the same folder again, so this is still the whole count
      await expectPhotos(id, Math.max(photos.length, received.size));
      const result = await uploadPhotos(id, photos, received, setUpload);
      if (result.failed.length === 0) await uploadsDone(id, result.total);
      queryClient.invalidateQueries({ queryKey: key });
    } catch (err) {
      setUploadError(err instanceof UploadStopped ? err.message : "The upload stopped. Pick the same photos again to carry on; photos already sent won't be sent twice.");
    } finally {
      running.current = false;
    }
  };

  // Photos chosen on the start page
  useEffect(() => {
    if (!intake) return;
    const photos = pendingSources.get(id);
    if (!photos) return;
    pendingSources.delete(id);
    void send(photos, new Set(intake.received));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!intake]);

  const resume = (input: File[] | DataTransfer) => {
    collectPhotos(input).then((c) => send(c.photos, new Set(intake?.received ?? []))).catch(() => setUploadError("We couldn't open those files."));
  };

  const finishUploads = useMutation({
    mutationFn: () => uploadsDone(id, intake?.progress.uploaded ?? 0),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const cancel = useMutation({
    mutationFn: () => cancelIntake(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-intake"] });
      navigate("/import");
      toast({
        title: "Cancelled",
        description: "Nothing was imported. You can bring it back for 7 days.",
        duration: 10_000,
        action: (
          <ToastAction altText="Undo" onClick={() => void restoreIntake(id).then(() => navigate(`/import/${id}`))}>
            Undo
          </ToastAction>
        ),
      });
    },
    onError: (err) => toast({ title: "Couldn't cancel", description: apiErrorMessage(err, "Try again."), variant: "destructive" }),
  });

  const header = (desc?: string) => (
    <PageHeader
      title="Bring in a whole box of recipes"
      description={desc}
      back={{ href: "/import", label: "Back" }}
      secondaryActions={
        intake && ["uploading", "review"].includes(intake.status) ? (
          <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>Cancel this box</Button>
        ) : undefined
      }
    />
  );

  if (isLoading) return <>{header()}<LoadingState rows={5} label="Loading your photos" /></>;
  if (isError || !intake) return <>{header()}<ErrorState title="We couldn't load this box of recipes" onRetry={() => refetch()} /></>;

  if (intake.status === "cancelled") {
    return (
      <>
        {header()}
        <EmptyState
          icon={Boxes}
          title="This box was cancelled"
          description="Nothing from it was imported."
          action={<Button onClick={() => void restoreIntake(id).then(() => refetch())}>Bring it back</Button>}
        />
      </>
    );
  }

  if (intake.status === "uploading" || intake.status === "pairing") {
    const p = intake.progress;
    const sending = upload && running.current;
    const total = Math.max(p.expected ?? 0, p.uploaded, upload?.total ?? 0);
    const looked = p.checked + p.failed;
    const stalled = !sending && intake.status === "uploading" && p.expected !== null && p.uploaded < p.expected;
    return (
      <>
        {header("We're looking at every photo. You can leave this page; we'll keep going.")}
        <section className="space-y-5 rounded-lg border bg-card p-4 md:p-6" aria-live="polite">
          <ProgressLine label={`Uploading photos: ${Math.min(upload?.done ?? p.uploaded, total)} of ${total}`} value={total ? ((upload?.done ?? p.uploaded) / total) * 100 : 0} />
          <ProgressLine
            label={intake.status === "pairing" ? progressText("pairing", p) : `Looking at your photos: ${looked} of ${total}`}
            value={intake.status === "pairing" ? 100 : total ? (looked / total) * 100 : 0}
          />
          <p className="text-sm text-muted-foreground">Turning each photo upright and reading its name. About {intake.estimates.firstLook.timeText} for all of them.</p>
          {note && <p className="text-sm">{note}</p>}
          {upload && upload.repeats > 0 && <p className="text-sm">{upload.repeats} {upload.repeats === 1 ? "photo was" : "photos were"} picked twice; we used one copy.</p>}
        </section>

        {upload && upload.failed.length > 0 && (
          <section className="mt-6 space-y-2 rounded-lg border border-destructive/50 p-4" role="alert">
            <h2 className="text-lg font-semibold">{upload.failed.length} {upload.failed.length === 1 ? "photo" : "photos"} didn't upload</h2>
            <ul className="space-y-1 text-base">
              {upload.failed.slice(0, 8).map((f) => <li key={f.path}><span className="font-medium">{f.path.split("/").pop()}</span>: {f.reason}</li>)}
            </ul>
            <p className="text-base">Pick the same photos again to retry them, or carry on without them.</p>
          </section>
        )}

        {(uploadError || stalled || (upload && upload.failed.length > 0)) && (
          <section className="mt-6 space-y-4">
            {uploadError && <p className="text-base text-destructive" role="alert">{uploadError}</p>}
            {stalled && !uploadError && <p className="text-base">Some photos haven't arrived yet. Pick the same folder or photos again and we'll send only the ones that are missing.</p>}
            <PhotoPicker onPick={resume} bulk={{ onDropBulk: resume }} allowCamera={false} variant="buttons" libraryLabel="Pick the photos again" />
            <Button variant="outline" onClick={() => finishUploads.mutate()} disabled={finishUploads.isPending}>
              Carry on with the {p.uploaded} photos we have
            </Button>
          </section>
        )}
      </>
    );
  }

  if (intake.status === "review") {
    return (
      <>
        {header()}
        <IntakeReview intake={intake} confirmAbove={config?.limits.confirmAbove ?? 100} onImported={() => refetch()} />
      </>
    );
  }

  // Importing or done: each recipe's progress through the normal pipeline
  const chosen = intake.plan.groups.filter((g) => g.include || g.recipeId);
  const items: JobItem[] = chosen.map((g) => {
    const st = g.recipe?.status;
    return {
      id: g.key,
      title: g.recipe && g.recipe.title !== "Your Recipe" ? g.recipe.title : g.title || "Recipe card",
      thumbnail: thumbUrl(intake.id, g.key),
      state: !g.recipeId ? "queued" : st === "ready" ? "done" : st === "failed" ? "failed" : "working",
      statusText: !g.recipeId ? (g.problem ?? "Waiting its turn…") : st === "extracting" ? "Reading the card…" : st === "enriching" ? "Adding the details…" : undefined,
      error: st === "failed" ? "We couldn't read this one. Open it to try again." : undefined,
      href: g.recipeId ? `/recipe/${g.recipeId}` : undefined,
    };
  });
  return (
    <>
      {header(intake.status === "done" ? "Every recipe is in. Photos of each dish may take a little longer." : `Importing your recipes. This takes ${intake.estimates.import.timeText}; you can close this page.`)}
      <JobStatus items={items} progressLabel={(f, t) => `${f} of ${t} recipes imported`} failedLabel="couldn't be read" />
    </>
  );
}

function ProgressLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-base font-medium">
        {value < 100 && <Loader2 className="h-4 w-4 text-primary motion-safe:animate-spin" aria-hidden />}
        {label}
      </p>
      <Progress value={Math.min(100, value)} className="h-2" aria-label={label} />
    </div>
  );
}

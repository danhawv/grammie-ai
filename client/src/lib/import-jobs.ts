import type { ImportStatus } from "@shared/import-review";
import type { JobState } from "@/lib/job-summary";

// Words and states for recipe imports shown through JobStatus.

export const IMPORT_JOB_STATE: Record<ImportStatus, JobState> = {
  uploading: "working",
  reading: "working",
  needs_review: "needs_review",
  saved: "done",
  failed: "failed",
};

export function importStatusText(status: ImportStatus, kind?: string): string {
  switch (status) {
    case "uploading":
      return "Sending…";
    case "reading":
      return kind === "photo" ? "Reading the card…" : kind === "link" || kind === "social" ? "Reading the page…" : "Reading…";
    case "needs_review":
      return "Needs a look";
    case "saved":
      return "Saved";
    case "failed":
      return "Couldn't be read";
  }
}

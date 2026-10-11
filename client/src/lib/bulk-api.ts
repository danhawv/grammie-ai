import { apiRequest } from "@/lib/queryClient";
import type { BulkLimits, Estimate, ImportLane, IntakeStatus, PlanGroup, PlanSummary } from "@shared/bulk-intake";
import type { PickerConfig } from "@/lib/google-drive";
import type { SourcePhoto } from "@/lib/bulk-upload";

// Server calls for bulk intake (server/routes/bulk-intake.ts).

export interface BulkConfig {
  available: boolean;
  limits: BulkLimits;
  lane: ImportLane;
  drive: { picker: PickerConfig | null; link: { apiKey: string } | null };
}

export interface IntakeSummaryRow {
  id: string;
  status: IntakeStatus;
  createdAt: string;
  photos: number;
}

export interface IntakeGroup extends PlanGroup {
  recipe: { title: string; status: string | null; error: string | null } | null;
  problem: string | null;
}

export interface IntakePhoto {
  id: string;
  fileName: string | null;
  status: "uploaded" | "checking" | "checked" | "failed";
  title: string;
  kind: string | null;
  side: "front" | "back" | null;
  pairedTo: string | null;
  pairSource: string | null;
  problem: string | null;
}

export interface IntakeState {
  id: string;
  status: IntakeStatus;
  source: string;
  cookbookId: number | null;
  createdAt: string;
  spentCents: number;
  progress: { uploaded: number; expected: number | null; checked: number; failed: number };
  received: string[];
  photos: IntakePhoto[];
  plan: { groups: IntakeGroup[]; summary: PlanSummary };
  estimates: { firstLook: Estimate; import: Estimate; lane: ImportLane };
}

export const thumbUrl = (intakeId: string, photoId: string) => `/api/bulk-intake/${intakeId}/photos/${photoId}/thumb`;
export const imageUrl = (intakeId: string, photoId: string) => `/api/bulk-intake/${intakeId}/photos/${photoId}/image`;

export async function startIntake(source: "device" | "drive_picker" | "drive_link"): Promise<string> {
  const res = await apiRequest("POST", "/api/bulk-intake", { source });
  return ((await res.json()) as { id: string }).id;
}

export const expectPhotos = (id: string, expected: number) => apiRequest("POST", `/api/bulk-intake/${id}/expect`, { expected });
export const uploadsDone = (id: string, expected: number) => apiRequest("POST", `/api/bulk-intake/${id}/uploads-done`, { expected });

export type Choice =
  | { action: "include" | "exclude" | "retry"; front: string }
  | { action: "pair"; front: string; back: string }
  | { action: "unpair"; back: string }
  | { action: "cookbook"; cookbookId: number | null };

export const makeChoice = (id: string, choice: Choice) => apiRequest("POST", `/api/bulk-intake/${id}/choices`, choice);

export async function startImport(id: string, body: { cookbookId?: number | null; expectedCount: number; confirmed: boolean }) {
  return apiRequest("POST", `/api/bulk-intake/${id}/import`, body);
}

export const cancelIntake = (id: string) => apiRequest("POST", `/api/bulk-intake/${id}/cancel`);
export const restoreIntake = (id: string) => apiRequest("POST", `/api/bulk-intake/${id}/restore`);

// Photos picked on the start page, waiting for the intake page to upload
// them (navigation can't carry File objects through the URL)
export const pendingSources = new Map<string, SourcePhoto[]>();

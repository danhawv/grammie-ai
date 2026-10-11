import { folderIdFromLink, isPhotoName } from "@/lib/bulk-files";
import type { SourcePhoto } from "@/lib/bulk-upload";

// Bringing photos in from Google Drive (docs/BULK_IMPORT.md, "Google Drive").
// Off until the owner sets the Google keys on the server; /api/bulk-intake/config
// then hands them to the page. Everything happens in the browser: the photos
// are downloaded here and go through the same shrink-and-upload path as
// photos from the computer, so the server never holds a Google token.
//
// Two ways in:
//  1. Picker (recommended): the person signs in to Google and picks photos
//     in Google's own window. Uses the drive.file scope, which only reaches
//     files the person picks, and needs no Google security review.
//  2. Shared link: a folder shared "Anyone with the link", read with the API
//     key. No sign-in, but the folder has to be public.

export interface PickerConfig {
  clientId: string;
  apiKey: string;
  appId: string;
}

export class DriveError extends Error {}

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";
const MAX_FILES = 2000;

const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scripts.delete(src);
        reject(new DriveError("We couldn't reach Google. Check your connection and try again."));
      };
      document.head.appendChild(s);
    }));
  }
  return scripts.get(src)!;
}

/** "2026:10:09 14:03:22" (Drive's photo time) -> ISO */
function driveTime(t: unknown): string | null {
  const m = typeof t === "string" ? t.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  imageMediaMetadata?: { time?: string };
}

function toSource(f: DriveFile, path: string, download: (id: string) => Promise<Response>): SourcePhoto {
  return {
    path,
    size: Number(f.size) || 0,
    lastModified: f.modifiedTime ? Date.parse(f.modifiedTime) : 0,
    takenAt: driveTime(f.imageMediaMetadata?.time),
    open: async () => {
      const res = await download(f.id);
      if (!res.ok) throw new Error(`Google Drive wouldn't send ${f.name}.`);
      return res.blob();
    },
  };
}

/** Every photo in a folder and its subfolders */
async function listFolder(folderId: string, auth: { token?: string; key?: string }, prefix = "", depth = 0): Promise<{ files: DriveFile[]; paths: string[] }> {
  const files: DriveFile[] = [];
  const paths: string[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, size, modifiedTime, imageMediaMetadata/time)",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      ...(auth.key ? { key: auth.key } : {}),
      ...(pageToken ? { pageToken } : {}),
    });
    const res = await fetch(`${DRIVE}?${params}`, auth.token ? { headers: { Authorization: `Bearer ${auth.token}` } } : undefined);
    if (res.status === 404 || res.status === 403) {
      throw new DriveError(auth.key
        ? "We couldn't open that folder. In Google Drive, choose Share, set it to \"Anyone with the link\", then paste the link again."
        : "Google didn't let us see inside that folder. Open the folder in the Google window and select the photos inside it instead.");
    }
    if (!res.ok) throw new DriveError("Google Drive didn't answer. Try again in a minute.");
    const body = await res.json();
    for (const f of body.files as DriveFile[]) {
      if (f.mimeType === FOLDER && depth < 4) {
        const sub = await listFolder(f.id, auth, `${prefix}${f.name}/`, depth + 1);
        files.push(...sub.files);
        paths.push(...sub.paths);
      } else if (f.mimeType.startsWith("image/") || isPhotoName(f.name)) {
        files.push(f);
        paths.push(prefix + f.name);
      }
      if (files.length >= MAX_FILES) return { files, paths };
    }
    pageToken = body.nextPageToken ?? "";
  } while (pageToken);
  return { files, paths };
}

/** Photos in a folder shared "Anyone with the link" */
export async function photosFromSharedLink(link: string, apiKey: string): Promise<SourcePhoto[]> {
  const id = folderIdFromLink(link);
  if (!id) throw new DriveError("That doesn't look like a Google Drive folder link. In Drive, choose Share, then Copy link.");
  const { files, paths } = await listFolder(id, { key: apiKey });
  if (!files.length) throw new DriveError("We didn't find any photos in that folder.");
  return files.map((f, i) => toSource(f, paths[i], (fid) => fetch(`${DRIVE}/${fid}?alt=media&key=${encodeURIComponent(apiKey)}`)));
}

/** Opens Google's sign-in, then Google's picker; resolves with the chosen photos (empty if cancelled) */
export async function photosFromPicker(cfg: PickerConfig): Promise<SourcePhoto[]> {
  await Promise.all([loadScript("https://accounts.google.com/gsi/client"), loadScript("https://apis.google.com/js/api.js")]);
  const w = window as any;
  await new Promise<void>((resolve) => w.gapi.load("picker", { callback: resolve }));

  const token: string = await new Promise((resolve, reject) => {
    const client = w.google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: (r: any) => (r?.access_token ? resolve(r.access_token) : reject(new DriveError("Google sign-in didn't finish."))),
      error_callback: () => reject(new DriveError("Google sign-in was closed.")),
    });
    client.requestAccessToken();
  });

  const picked: DriveFile[] = await new Promise((resolve) => {
    const p = w.google.picker;
    const view = new p.DocsView(p.ViewId.DOCS_IMAGES).setIncludeFolders(true).setSelectFolderEnabled(true);
    new p.PickerBuilder()
      .addView(view)
      .enableFeature(p.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(token)
      .setDeveloperKey(cfg.apiKey)
      .setAppId(cfg.appId)
      .setTitle("Choose your recipe photos, or a folder of them")
      .setCallback((data: any) => {
        if (data.action === p.Action.PICKED) resolve((data.docs ?? []).map((d: any) => ({ id: d.id, name: d.name, mimeType: d.mimeType, size: d.sizeBytes })));
        else if (data.action === p.Action.CANCEL) resolve([]);
      })
      .build()
      .setVisible(true);
  });

  const download = (id: string) => fetch(`${DRIVE}/${id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  const out: SourcePhoto[] = [];
  for (const f of picked) {
    if (f.mimeType === FOLDER) {
      const { files, paths } = await listFolder(f.id, { token }, `${f.name}/`);
      files.forEach((x, i) => out.push(toSource(x, paths[i], download)));
    } else {
      out.push(toSource(f, f.name, download));
    }
  }
  return out;
}

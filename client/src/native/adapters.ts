import { Browser } from "@capacitor/browser";
import { Camera, MediaTypeSelection } from "@capacitor/camera";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { Share } from "@capacitor/share";
import { KeepAwake } from "@capacitor-community/keep-awake";
import type { NativeAdapters } from "@/lib/platform";
import { waitUntilBack } from "./returns";

// What lib/platform.ts does differently inside the iPhone/iPad app.

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** A file name the phone's file system accepts */
function safeName(filename: string): string {
  return filename.replace(/[/\\?%*:|"<>]/g, "-").trim() || "Grammie";
}

async function saveFile(data: Blob, filename: string): Promise<void> {
  // Written to the cache (the system clears it) and handed to the share
  // sheet: Save to Files, Print, AirDrop, Messages, Mail…
  const { uri } = await Filesystem.writeFile({
    path: safeName(filename),
    data: await blobToBase64(data),
    directory: Directory.Cache,
  });
  try {
    await Share.share({ title: filename, files: [uri] });
  } catch (err) {
    // Closing the share sheet without choosing is not a problem
    if (!/cancel/i.test(String((err as Error)?.message ?? err))) throw err;
  }
}

async function openExternal(url: string): Promise<void> {
  await Browser.open({ url });
}

async function openExternalAndWait(url: string): Promise<void> {
  const back = waitUntilBack();
  await Browser.open({ url });
  await back;
}

let photoCount = 0;
async function toFile(webPath: string, format?: string): Promise<File> {
  const blob = await (await fetch(webPath)).blob();
  const ext = (format || blob.type.split("/")[1] || "jpeg").toLowerCase();
  photoCount += 1;
  return new File([blob], `photo-${Date.now()}-${photoCount}.${ext}`, { type: blob.type || `image/${ext}` });
}

async function pickPhotos(source: "camera" | "library", multiple: boolean): Promise<File[] | null> {
  try {
    if (source === "camera") {
      // Full quality: the app shrinks photos itself before upload
      const shot = await Camera.takePhoto({ quality: 90, correctOrientation: true, saveToGallery: false, editable: "no" });
      return shot.webPath ? [await toFile(shot.webPath, shot.metadata?.format)] : null;
    }
    const { results } = await Camera.chooseFromGallery({
      mediaType: MediaTypeSelection.Photo,
      allowMultipleSelection: multiple,
      limit: multiple ? 10 : 1,
      quality: 90,
      correctOrientation: true,
      editable: "no",
    });
    const files = await Promise.all(results.filter((r) => r.webPath).map((r) => toFile(r.webPath!, r.metadata?.format)));
    return files.length ? files : null;
  } catch (err) {
    // Backing out of the camera or picker
    if (/cancel/i.test(String((err as Error)?.message ?? err))) return null;
    throw err;
  }
}

export const nativeAdapters: Partial<NativeAdapters> = {
  openExternal,
  openExternalAndWait,
  saveFile,
  async print(pdf?: Blob) {
    // The share sheet has Print (AirPrint) for a PDF
    if (pdf) return saveFile(pdf, "Grammie.pdf");
    window.print();
  },
  async keepAwake(on: boolean) {
    if (on) await KeepAwake.keepAwake();
    else await KeepAwake.allowSleep();
  },
  haptic(kind) {
    const run =
      kind === "success"
        ? Haptics.notification({ type: NotificationType.Success })
        : kind === "warning"
          ? Haptics.notification({ type: NotificationType.Warning })
          : Haptics.impact({ style: ImpactStyle.Light });
    run.catch(() => {});
  },
  pickPhotos,
};

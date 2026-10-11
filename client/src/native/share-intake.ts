import { Capacitor } from "@capacitor/core";
import { Filesystem } from "@capacitor/filesystem";
import { CapacitorShareTarget, type ShareReceivedEvent, type SharedFile } from "@capgo/capacitor-share-target";
import { requestAddRecipe } from "@/contexts/AddRecipeContext";
import { firstSharedUrl, sharedRecipeText } from "./share-text";

// "Share to Grammie" from another app. The Share Extension
// (ios/App/ShareExtension) saves what was shared and opens the app; the
// plugin delivers it here, at launch or whenever the app comes back to the
// front. It then starts the same Add recipe flow as in the app: a link is
// imported as if pasted, photos go to the photo import, text to "Type or
// paste".

const MAX_PHOTOS = 10;

async function readSharedPhoto(file: SharedFile): Promise<File | null> {
  try {
    const res = await fetch(Capacitor.convertFileSrc(file.uri));
    if (!res.ok) return null;
    const blob = await res.blob();
    const type = file.mimeType || blob.type || "image/jpeg";
    return new File([blob], file.name || "shared-photo.jpg", { type });
  } catch {
    return null;
  } finally {
    // The copy in the App Group isn't needed once it's in memory
    Filesystem.deleteFile({ path: file.uri }).catch(() => {});
  }
}

export async function handleShare(event: ShareReceivedEvent): Promise<void> {
  const texts = event.texts ?? [];
  const images = (event.files ?? []).filter((f) => f.mimeType?.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
  if (images.length) {
    const files = (await Promise.all(images.slice(0, MAX_PHOTOS).map(readSharedPhoto))).filter((f): f is File => !!f);
    if (files.length) {
      requestAddRecipe("image", { files });
      return;
    }
  }
  const link = firstSharedUrl(texts);
  if (link) {
    requestAddRecipe("link", { link });
    return;
  }
  const text = sharedRecipeText(texts);
  if (text) requestAddRecipe("text", { text });
  else requestAddRecipe("link");
}

export async function startShareIntake(): Promise<void> {
  await CapacitorShareTarget.addListener("shareReceived", (event) => {
    void handleShare(event);
  });
}

import { App } from "@capacitor/app";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { CapacitorUpdater } from "@capgo/capacitor-updater";
import { focusManager } from "@tanstack/react-query";
import { registerNativeAdapters } from "@/lib/platform";
import { nativeAdapters } from "./adapters";
import { startLinkHandling } from "./links";
import { startShareIntake } from "./share-intake";
import { startStore } from "./store";
import { syncUnfinishedPurchases } from "@/lib/purchases";

// Start-up for the iPhone/iPad app. main.tsx loads this (as its own chunk,
// so the website never downloads it) only when isNativeApp() is true.

/** The page draws edge to edge; the CSS keeps clear of the notch and home bar */
function drawUnderSystemBars(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (meta && !meta.content.includes("viewport-fit")) meta.content += ", viewport-fit=cover";
  document.documentElement.classList.add("native-app");
}

/** Dark status bar text on the light theme, light text on the dark theme */
function followThemeInStatusBar(): void {
  const apply = () => {
    const dark = document.documentElement.classList.contains("dark");
    StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
  };
  apply();
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
}

/** Lists refresh when the app comes back to the front (like a browser tab regaining focus) */
function refreshOnResume(): void {
  focusManager.setEventListener((setFocused) => {
    const handle = App.addListener("appStateChange", ({ isActive }) => setFocused(isActive));
    return () => {
      handle.then((h) => h.remove()).catch(() => {});
    };
  });
}

function finishUnfinishedPurchases(): void {
  // Tried again on the next launch or resume if it fails
  syncUnfinishedPurchases().catch(() => {});
}

export async function startNativeApp(): Promise<void> {
  drawUnderSystemBars();
  registerNativeAdapters(nativeAdapters);
  followThemeInStatusBar();
  refreshOnResume();
  await Promise.all([
    startLinkHandling().catch((err) => console.warn("[native] links", err)),
    startShareIntake().catch((err) => console.warn("[native] share", err)),
    startStore().catch((err) => console.warn("[native] store", err)),
  ]);
  // Tells over-the-air updates (when turned on) that this version started fine
  CapacitorUpdater.notifyAppReady().catch(() => {});
  // A credits purchase paid for but not yet recorded (app closed mid-way)
  // (after a moment, so sign-in is ready to send with it)
  setTimeout(finishUnfinishedPurchases, 5000);
  App.addListener("resume", finishUnfinishedPurchases).catch(() => {});
  // Android's back button (later): nothing yet
}

export function hideSplash(): void {
  SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {});
}

import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { isNativeApp } from "./lib/platform";

async function start() {
  // Inside the iPhone/iPad app: native helpers first (links, share sheet,
  // camera). Loaded on demand so the website doesn't download them.
  const native = isNativeApp() ? await import("./native").catch((err) => {
    console.error("[native] failed to load", err);
    return null;
  }) : null;
  if (native) {
    try {
      await native.startNativeApp();
    } catch (err) {
      console.error("[native] start-up", err);
    }
  }
  createRoot(document.getElementById("root")!).render(<App />);
  if (isNativeApp()) {
    requestAnimationFrame(() => {
      if (native) native.hideSplash();
      else (globalThis as any).Capacitor?.Plugins?.SplashScreen?.hide?.();
    });
  }
}

void start();

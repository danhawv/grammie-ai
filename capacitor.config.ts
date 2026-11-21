import type { CapacitorConfig } from "@capacitor/cli";

// The iPhone/iPad app: a Capacitor shell around the same web app, built with
// `npm run build:app` (see docs/MOBILE_APP.md). The web files ship inside the
// app (no server.url), are served from capacitor://localhost, and talk to the
// API on https://grammie.ai through client/src/lib/platform.ts.

// Over-the-air web updates (Capgo) stay off until the owner subscribes and
// builds with GRAMMIE_OTA=1. Off means no update checks and no stats sent.
const otaEnabled = process.env.GRAMMIE_OTA === "1";

const config: CapacitorConfig = {
  appId: "ai.grammie.app",
  appName: "Grammie",
  webDir: "dist/public",
  server: {
    // Default iOS scheme ("capacitor") and host give the origin capacitor://localhost
    hostname: "localhost",
  },
  ios: {
    // The page draws under the status bar and home indicator; the CSS keeps
    // content clear of them with env(safe-area-inset-*)
    contentInset: "never",
    // Links in the page that leave the app open in Safari
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    SplashScreen: {
      // Hidden by client/src/native once the first screen has drawn
      launchAutoHide: false,
      backgroundColor: "#fdfaf5",
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: true,
      style: "DEFAULT",
    },
    Keyboard: {
      // Shrink the web view above the keyboard so forms stay visible
      resize: "native",
      resizeOnFullScreen: true,
    },
    CapacitorShareTarget: {
      // Shared with the Share Extension (ios/App/ShareExtension)
      appGroupId: "group.ai.grammie.app",
    },
    NativePurchases: {
      // Credits are granted by our server; the purchase is finished only after
      // the server has recorded it (client/src/lib/purchases.ts)
      autoFinishTransactions: false,
    },
    CapacitorUpdater: otaEnabled
      ? {
          autoUpdate: true,
          appReadyTimeout: 10000,
          resetWhenUpdate: true,
        }
      : {
          autoUpdate: false,
          statsUrl: "",
        },
  },
};

export default config;

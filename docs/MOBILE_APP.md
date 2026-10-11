# The Grammie iPhone/iPad app

The app is a [Capacitor 8](https://capacitorjs.com) shell around this same web app. One codebase: the website and the app run the same React code; the few things that differ go through `client/src/lib/platform.ts`.

- App id `ai.grammie.app`, name "Grammie", iOS 15+, iPhone and iPad.
- The web files are **bundled inside the app** (`webDir: dist/public`, no `server.url`). They are served from `capacitor://localhost` and call the API on `https://grammie.ai` with a bearer token (no cookies).
- Native project: `ios/App` (Swift Package Manager, no CocoaPods). Config: `capacitor.config.ts`.

## How it fits together

| Piece | Where |
| --- | --- |
| Platform contract (API host, sign-in token, links, files, print, keep-awake, haptics, photo picker) | `client/src/lib/platform.ts` |
| Native start-up (loaded only in the app build) | `client/src/native/index.ts` |
| Native versions of the platform helpers | `client/src/native/adapters.ts` |
| Universal links and `grammie://` links → app routes | `client/src/native/links.ts`, `app-links.ts` |
| Sign-in (Clerk Native API, Google/Apple in the system browser) | `client/src/native/auth.tsx`, `sign-in-buttons.tsx`, `client/src/pages/sso-callback.tsx` |
| "Share to Grammie" | `ios/App/ShareExtension/ShareViewController.swift` → `client/src/native/share-intake.ts` → the Add recipe sheet |
| Credits through the App Store | `client/src/lib/purchases.ts` (flow) + `client/src/native/store.ts` (StoreKit adapter) |
| Universal links file | `server/lib/app-site-association.ts`, served at `/.well-known/apple-app-site-association` |
| App icon and launch screen | `npm run app:icons` (`scripts/generate-app-icons.mjs`) |

**Native code never reaches the website.** Everything under `client/src/native/` (and Clerk's bundled sign-in screens) is imported behind `__APP_BUILD__`, which is `true` only in `npm run build:app` (set in `vite.config.ts`). The website build (`npm run build`, what Railway runs) leaves it out entirely. Use `isNativeApp()` for behaviour that differs at run time, and import from `@/native/...` only behind `__APP_BUILD__`.

## Building and running

Needs Node 22+, **Xcode 26+** (from the App Store, then `sudo xcode-select -s /Applications/Xcode.app` and open Xcode once to install the iOS simulator), and an Apple Developer account for devices/TestFlight.

```bash
export VITE_CLERK_PUBLISHABLE_KEY=pk_live_...   # the production key (same as Railway)
npm run cap:sync     # vite build for the app (GRAMMIE_APP_BUILD=1, VITE_PUBLIC_ORIGIN=https://grammie.ai) + cap sync ios
npm run cap:open     # opens ios/App/App.xcodeproj in Xcode
```

In Xcode: choose an iPhone simulator and press Run. The first open resolves the Swift packages (Capacitor and the plugins) — that needs Xcode and can't be done without it.

- `VITE_PUBLIC_ORIGIN` defaults to `https://grammie.ai`. To test against another server: `VITE_PUBLIC_ORIGIN=https://<preview>.up.railway.app npm run cap:sync`.
- After changing only web code, `npm run cap:sync` and Run again. After adding a plugin, also `npm run cap:sync` (it rewrites `ios/App/CapApp-SPM/Package.swift`).
- Debug the web view: Safari → Develop → Simulator → localhost.

### First time in Xcode (one-off, needs Xcode)

1. Select the **App** target → Signing & Capabilities → Team = the Grammie team. Do the same for **ShareExtension**.
2. Check the capabilities are on (they're in the entitlements files already; Xcode registers them with Apple):
   - App: **Associated Domains** (`applinks:grammie.ai`, `webcredentials:grammie.ai`), **App Groups** (`group.ai.grammie.app`), **In-App Purchase**.
   - ShareExtension: **App Groups** (`group.ai.grammie.app`).
3. Build once for a simulator and once for a device. The Share Extension target and its embedding were added by hand to `project.pbxproj`; if Xcode complains about it, delete the ShareExtension target and recreate it (File → New → Target → Share Extension, name `ShareExtension`, bundle id `ai.grammie.app.ShareExtension`, no storyboard), then put back `ShareViewController.swift`, `Info.plist` and `ShareExtension.entitlements` from git.

## TestFlight

1. In Xcode, set the version (`MARKETING_VERSION`) and bump the build number (`CURRENT_PROJECT_VERSION`) for both targets.
2. Product → Archive (device "Any iOS Device") → Distribute App → App Store Connect → Upload.
3. In App Store Connect → TestFlight, add testers. `ITSAppUsesNonExemptEncryption` is already `false`, so no export questions.

## Over-the-air updates (Capgo)

`@capgo/capacitor-updater` is installed but **off**. Off means no update checks and no stats sent. To turn it on after subscribing to Capgo:

1. Build with `GRAMMIE_OTA=1 npm run cap:sync` (sets `autoUpdate: true` in `capacitor.config.ts`) and ship that build through the App Store once.
2. Then publish web-only changes with `npx @capgo/cli bundle upload` after `npm run build:app`.
3. The app already calls `notifyAppReady()` at start-up (a broken update rolls back).

**OTA can only change web code.** Anything below needs a new App Store build:

- New or upgraded Capacitor plugins, or any Swift change (`ios/`)
- New permissions or usage strings in `Info.plist`, new entitlements/capabilities (associated domains, app groups, push)
- App icon, launch screen, app name, bundle id, version
- `capacitor.config.ts` changes (they're copied into the app at build time)
- In-app purchase products (created in App Store Connect; code that sells a new product needs that product to exist)

Apple allows OTA fixes and improvements to the web code; new features that change what the app is should still go through review.

## Per-feature checklist (app + web)

Every feature, before merging:

- [ ] Works at phone **and** iPad widths (portrait and landscape), with safe areas (`env(safe-area-inset-*)`) respected.
- [ ] Uses the `platform.ts` helpers: `apiFetch`/`apiUrl` for the server, `mediaUrl` for images, `publicUrl` for links people share, `openExternal`/`ExternalAnchor` for outside sites, `saveFile` for downloads, `printPage`, `keepAwake`, `haptic`, `pickPhotos` (via `PhotoPicker`). No `window.location.assign` to another site, no `<a download>`, no relative `/api` fetches.
- [ ] No new native permission, plugin or entitlement without planning a store release.
- [ ] Tested on the web, in the iOS simulator, and on TestFlight before it's announced.

## Sign-in spike: what must be verified on a phone

Implemented but **not yet run on a device** (no Xcode on the build Mac yet):

1. **Email sign-in in the app** (Clerk's form inside the web view, `standardBrowser: false`, client token in Preferences). Check: sign in, quit the app, reopen → still signed in; sign out works; `/api/auth/status` is signed in (the bearer token reaches the server).
2. **Google and Apple** (system browser): tap "Continue with Apple/Google" → Safari sheet → sign in → back in the app signed in. Check the return path:
   - Universal link `https://grammie.ai/sso-callback?app=1&rotating_token_nonce=…` should open the app directly.
   - If iOS shows the grammie.ai page in the sheet instead (universal links often don't fire on redirects inside the sheet), the page sends people on with `grammie://sso-callback…` and shows an "Open Grammie" button. Confirm one of the two works for both providers.
   - First-time Google/Apple account → account is created ("transferable" path).
3. Cancelling (tap Done in the sheet) returns to the sign-in page with no error.
4. Clerk's own Google/Apple buttons are hidden in the app (they'd try to sign in inside the web view); the app's buttons replace them.

Owner steps in the **Clerk dashboard** (production instance):

- **Native applications**: enable the Native API.
- Add `capacitor://localhost` to the instance's allowed origins (Clerk Backend API `PATCH /v1/instance` with `allowed_origins`, or the dashboard setting if shown).
- Allow-list the redirect URLs for native SSO: `https://grammie.ai/sso-callback?app=1` and `grammie://sso-callback` (Native applications → redirect URLs).
- Add the **Apple** social connection (Services ID, key, Team ID from the Apple Developer account). Apple requires Sign in with Apple in an app that offers Google sign-in.
- Register the iOS app in Clerk (App ID prefix = Team ID, bundle id `ai.grammie.app`) if the dashboard asks for it.

## Other things to check on a device

- **Share to Grammie** from Safari (a recipe page), Instagram and TikTok (link only), Photos (1, 3 and 10 photos). The app should open the Add recipe sheet with the link importing, or the photos listed. If the extension can't open the app on your iOS version, open Grammie by hand — the share is waiting there.
- **Print checkout** (`print-order-panel.tsx`): checkout opens in the Safari sheet; paying returns to the app (universal link to `/cookbook/…/print-editor?…&order=…`) or tap Done; the app shows "Checking your payment…" and then the order. Cancelling shows "Payment wasn't finished" with "Go back to checkout".
- **Camera**: Add recipe → Photo → Take photo / Choose photos (system camera and picker).
- **Saving and printing PDFs**: the share sheet opens with Save to Files and Print. Printing the current page (`window.print()` without a PDF) may do nothing in the web view; prefer passing a PDF.
- **Keep screen on** in cooking mode; status bar text readable in light and dark themes; the keyboard doesn't cover form fields.
- **Credits** (App Store sandbox account): buy a pack, kill the app mid-purchase and reopen → credits still arrive.

## Owner steps (Apple and hosting)

1. Install Xcode 26+ and sign in with the Apple Developer account.
2. Apple Developer → Identifiers: App ID `ai.grammie.app` with Associated Domains, App Groups, In-App Purchase, Sign in with Apple; App ID `ai.grammie.app.ShareExtension` with App Groups; App Group `group.ai.grammie.app`. (Xcode's automatic signing can create these.)
3. Railway: set `APPLE_TEAM_ID` (10 characters) so `https://grammie.ai/.well-known/apple-app-site-association` lists the app. Check it returns JSON, with no redirect.
4. App Store Connect: create the app; create the consumable products `ai.grammie.app.credits.starter`, `.family`, `.cookbook`, `.heirloom`; privacy details; screenshots (iPhone and iPad).
5. Clerk dashboard steps above.
6. **Supply the real artwork**: `resources/app-icon.png`, square, 1024 × 1024 PNG, no transparency, no rounded corners (iOS rounds it). Then `npm run app:icons` regenerates `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` and the three `Splash.imageset/splash-2732x2732*.png` files. Today they are a placeholder "G" on the brand color.

## Android

Not set up yet. `npx cap add android` later; the share-target plugin needs intent filters, and the Android back button handler in `client/src/native/index.ts` is a placeholder.

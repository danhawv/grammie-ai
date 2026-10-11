// Where the app is running, and the few things that work differently in the
// iPhone/iPad app (a Capacitor shell around this same web app) than in a
// browser. Every feature talks to the server, opens links, saves files and so
// on through these helpers, so it works in both places without its own checks.
//
// In a browser the app and the API share a website, so paths stay relative
// and the sign-in cookie does the work. In the app, the page is served from
// capacitor://localhost: requests must go to the real server, and sign-in
// travels as a bearer token because the cookie can't cross sites.
//
// Native behaviour (system browser, file saving, keep-awake) is supplied by
// client/src/native/ at startup through registerNativeAdapters(); without it
// everything falls back to the browser version.

/** True inside the iPhone/iPad (or later Android) app */
export function isNativeApp(): boolean {
  const cap = (globalThis as any).Capacitor;
  return !!cap?.isNativePlatform?.();
}

/** The public website, used for API calls from the app and for links people share */
export const PUBLIC_ORIGIN: string =
  (import.meta.env.VITE_PUBLIC_ORIGIN as string | undefined)?.replace(/\/$/, "") || "https://grammie.ai";

/** Turns "/api/..." (or "/media/...") into the URL to fetch from where we're running */
export function apiUrl(path: string): string {
  if (!isNativeApp() || /^[a-z][a-z0-9+.-]*:/i.test(path)) return path;
  return PUBLIC_ORIGIN + (path.startsWith("/") ? path : `/${path}`);
}

/**
 * A link to a page of the site that works for anyone it's sent to: the
 * current site in a browser, the public site from inside the app.
 */
export function publicUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (isNativeApp() || typeof window === "undefined") return PUBLIC_ORIGIN + p;
  return window.location.origin + p;
}

/** WebSocket URL for a server path such as "/ws/grocery" */
export function socketUrl(path: string): string {
  const base = isNativeApp() || typeof window === "undefined"
    ? PUBLIC_ORIGIN
    : window.location.origin;
  return base.replace(/^http/, "ws") + (path.startsWith("/") ? path : `/${path}`);
}

// ---------- Sign-in token ----------

type TokenGetter = () => Promise<string | null>;
let tokenGetter: TokenGetter | null = null;

/** Set once sign-in is ready (App.tsx); returns the current session token */
export function setAuthTokenGetter(getter: TokenGetter | null): void {
  tokenGetter = getter;
}

/** The signed-in user's session token, for requests that can't use the cookie */
export async function authToken(): Promise<string | null> {
  try {
    return tokenGetter ? await tokenGetter() : null;
  } catch {
    return null;
  }
}

/**
 * fetch() for our own server. Use it for every request to /api: it points at
 * the right host and carries sign-in in both the browser and the app.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (isNativeApp() && !headers.has("Authorization")) {
    const token = await authToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(apiUrl(path), { credentials: "include", ...init, headers });
}

// ---------- Native adapters ----------

export interface NativeAdapters {
  /** Open a website outside the app (in-app Safari sheet) */
  openExternal(url: string): Promise<void>;
  /** Save or share a file the app made (PDF, image): shows the share sheet */
  saveFile(data: Blob, filename: string): Promise<void>;
  /** Print the current page or a PDF */
  print(pdf?: Blob): Promise<void>;
  /** Keep the screen on while cooking */
  keepAwake(on: boolean): Promise<void>;
  /** Light tap feedback for important actions */
  haptic(kind: "light" | "success" | "warning"): void;
}

let native: Partial<NativeAdapters> = {};

/** Called by client/src/native/ at startup inside the app */
export function registerNativeAdapters(adapters: Partial<NativeAdapters>): void {
  native = { ...native, ...adapters };
}

/** Opens a website outside Grammie: a new tab in the browser, an in-app browser in the app */
export async function openExternal(url: string): Promise<void> {
  if (native.openExternal) return native.openExternal(url);
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Saves a file: a download in the browser, the share sheet in the app */
export async function saveFile(data: Blob, filename: string): Promise<void> {
  if (native.saveFile) return native.saveFile(data, filename);
  const href = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

/** Prints the page (or a PDF in the app) */
export async function printPage(pdf?: Blob): Promise<void> {
  if (native.print) return native.print(pdf);
  window.print();
}

/** Keeps the screen on while cooking; returns false if it couldn't */
export async function keepAwake(on: boolean): Promise<boolean> {
  if (native.keepAwake) {
    try {
      await native.keepAwake(on);
      return true;
    } catch {
      return false;
    }
  }
  return false; // the browser path stays in use-cooking-session (Wake Lock API)
}

export function haptic(kind: "light" | "success" | "warning" = "light"): void {
  native.haptic?.(kind);
}

// Coming back to Grammie from outside it: the in-app browser (checkout,
// sign-in) closing, or a grammie.ai / grammie:// link opening the app.
// links.ts reports these; adapters.ts and auth.ts wait on them.

type Waiter = () => void;
const backInApp = new Set<Waiter>();
const ssoWaiters = new Set<(url: string | null) => void>();

/** Resolves when the person is back in the app (browser closed or a link brought them back) */
export function waitUntilBack(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      backInApp.delete(done);
      resolve();
    };
    backInApp.add(done);
  });
}

export function reportBack(): void {
  Array.from(backInApp).forEach((w) => w());
}

/** Resolves with the /sso-callback link, or null if the sign-in browser was closed first */
export function waitForSsoCallback(): Promise<string | null> {
  return new Promise((resolve) => {
    const done = (url: string | null) => {
      ssoWaiters.delete(done);
      resolve(url);
    };
    ssoWaiters.add(done);
  });
}

export function reportSsoCallback(url: string | null): void {
  Array.from(ssoWaiters).forEach((w) => w(url));
}

export function isWaitingForSso(): boolean {
  return ssoWaiters.size > 0;
}

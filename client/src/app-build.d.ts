/**
 * True only in the build that ships inside the iPhone/iPad app
 * (`npm run build:app`, set in vite.config.ts). Native-only code is imported
 * behind it, so the website's build leaves that code out entirely.
 */
declare const __APP_BUILD__: boolean;

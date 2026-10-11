// /.well-known/apple-app-site-association: tells iOS which grammie.ai links
// open the Grammie app instead of Safari (universal links), and lets the app
// offer saved grammie.ai passwords. Apple fetches it over HTTPS with no
// redirects, as JSON. Needs APPLE_TEAM_ID (the 10-character Team ID from the
// Apple Developer account); without it the file lists no apps.

export const APP_BUNDLE_ID = "ai.grammie.app";

/** Paths that open in the app when it is installed */
export const APP_LINK_PATHS = [
  "/sso-callback*",
  "/recipe/*",
  "/cookbook/*",
  "/prep/cook/*",
  "/credits*",
  "/print-orders*",
  "/share*",
];

export function appSiteAssociation(teamId: string | undefined) {
  const id = teamId?.trim();
  const appIDs = id ? [`${id}.${APP_BUNDLE_ID}`] : [];
  return {
    applinks: {
      details: appIDs.length
        ? [{ appIDs, components: APP_LINK_PATHS.map((path) => ({ "/": path })) }]
        : [],
    },
    webcredentials: { apps: appIDs },
  };
}

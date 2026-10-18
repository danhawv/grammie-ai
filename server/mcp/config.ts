// AI connector settings from the environment (see docs/MCP_CONNECTOR.md)

/** The Clerk Frontend API origin, from MCP_AUTH_SERVER_URL or the publishable key */
export function clerkIssuer(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.MCP_AUTH_SERVER_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const key = (env.CLERK_PUBLISHABLE_KEY || env.VITE_CLERK_PUBLISHABLE_KEY || "").trim();
  const m = /^pk_(?:live|test)_(.+)$/.exec(key);
  if (!m) return null;
  try {
    const host = Buffer.from(m[1], "base64").toString("utf8").replace(/\$$/, "");
    return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : null;
  } catch {
    return null;
  }
}

export function mcpEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MCP_ENABLED === "true" && !!env.CLERK_SECRET_KEY && !!clerkIssuer(env);
}

export function scopesFromEnv(env: NodeJS.ProcessEnv = process.env): string[] | undefined {
  const raw = env.MCP_SCOPES?.trim();
  return raw ? raw.split(/[\s,]+/).filter(Boolean) : undefined;
}

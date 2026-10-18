// The Grammie connector: a remote MCP server (Streamable HTTP, stateless)
// that lets someone connect their own Claude, ChatGPT, Grok or Gemini to their
// Grammie recipes, cookbooks, pantry, grocery list and meal plans.
// Setup and directory checklists: docs/MCP_CONNECTOR.md.
//
//   POST /mcp                                        the MCP endpoint (Bearer token)
//   GET  /.well-known/oauth-protected-resource[/mcp] RFC 9728 metadata
//   GET  /.well-known/oauth-authorization-server     Clerk's metadata, for older clients
//   GET  /api/mcp/status                             { enabled } for the settings page
//
// This server is an OAuth 2.1 resource server: Clerk is the authorization
// server and issues the access tokens (Clerk "OAuth applications"); we only
// verify them. Everything but the status route answers 404 unless
// MCP_ENABLED=true and Clerk is configured.

import { Router, type RequestHandler } from "express";
import crypto from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createRateLimiter } from "../meal-prep/limits";
import { createGrammieMcpServer, type ToolContext, type ToolDeps, type ToolLimiters } from "../mcp/tools";
import type { McpData, McpEnrichment } from "../mcp/data";

export interface VerifiedToken {
  /** Clerk user id (the token's subject) */
  subject: string;
  clientId: string;
  scopes: string[];
  /** seconds since epoch */
  expiresAt?: number;
}

export interface McpRouterDeps {
  /** MCP_ENABLED=true and Clerk keys present */
  enabled: () => boolean;
  /** Clerk-issued OAuth access token -> who it's for; null when invalid, expired or revoked */
  verifyToken: (token: string) => Promise<VerifiedToken | null>;
  /** Clerk user id -> Grammie user id, the same way sign-in does it */
  resolveUserId: (clerkUserId: string) => Promise<string | null>;
  /** The authorization server's issuer URL (Clerk Frontend API), e.g. https://clerk.grammie.ai */
  authorizationServer: () => string | null;
  /** Clerk's /.well-known/oauth-authorization-server document */
  fetchAuthServerMetadata: () => Promise<unknown>;
  /** https://grammie.ai; defaults to the request's own host */
  publicOrigin?: () => string | undefined;
  /** Scopes listed in the resource metadata */
  scopes?: string[];
  data: McpData;
  enrichment: McpEnrichment;
  /** false = read-only connector (MCP_READ_ONLY=true) */
  writesEnabled?: () => boolean;
  audit?: (entry: Record<string, unknown>) => void;
  now?: () => Date;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Fresh per router, so tests start clean */
export function mcpLimiters() {
  return {
    /** HTTP requests per access token */
    token: createRateLimiter(90, MINUTE),
    /** HTTP requests per user, across all their tokens/assistants */
    user: createRateLimiter(180, MINUTE),
    /** unauthenticated or failed attempts, per address */
    anonIp: createRateLimiter(60, MINUTE),
    tools: {
      writeMinute: createRateLimiter(20, MINUTE),
      writeDay: createRateLimiter(300, DAY),
      createDay: createRateLimiter(50, DAY),
    } satisfies ToolLimiters,
  };
}

export const METADATA_PATH = "/.well-known/oauth-protected-resource";
const DEFAULT_SCOPES = ["openid", "profile", "email"];
const MAX_BODY_BYTES = 512 * 1024;

function bearer(req: any): string | null {
  const h = req.headers?.authorization;
  if (typeof h !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

/** A short, non-secret handle for a token (limits and the audit log) */
export function tokenKey(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function jsonRpcError(res: any, status: number, code: number, message: string) {
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}

/**
 * CORS for the connector paths (browser-based MCP clients and inspectors).
 * Mount before the site's own CORS middleware, which answers preflights
 * itself. Bearer tokens only, no cookies, so any origin is fine.
 */
export function mcpCors(enabled: () => boolean): RequestHandler {
  return (req, res, next) => {
    const p = req.path;
    const isMcpPath = p === "/mcp" || p.startsWith("/.well-known/oauth-");
    if (!isMcpPath || !enabled()) return next();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID");
    res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version");
    res.setHeader("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  };
}

export function createMcpRouter(deps: McpRouterDeps): Router {
  const router = Router();
  const limiters = mcpLimiters();
  const now = deps.now ?? (() => new Date());
  const audit = deps.audit ?? ((entry) => console.log(`[MCP audit] ${JSON.stringify(entry)}`));
  const origin = (req: any): string =>
    (deps.publicOrigin?.() || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  const resourceUrl = (req: any) => `${origin(req)}/mcp`;
  const metadataUrl = (req: any) => `${origin(req)}${METADATA_PATH}/mcp`;

  router.get("/api/mcp/status", (_req, res) => {
    res.json({ enabled: deps.enabled() });
  });

  // Everything below is invisible while the connector is off
  const onlyWhenEnabled: RequestHandler = (_req, res, next) => {
    if (!deps.enabled()) return res.status(404).json({ error: "Not found" });
    next();
  };

  const protectedResource: RequestHandler = (req, res) => {
    const issuer = deps.authorizationServer();
    if (!issuer) return res.status(503).json({ error: "The connector isn't set up yet." });
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json({
      resource: resourceUrl(req),
      authorization_servers: [issuer],
      scopes_supported: deps.scopes ?? DEFAULT_SCOPES,
      bearer_methods_supported: ["header"],
      resource_name: "Grammie",
      resource_documentation: `${origin(req)}/settings#connect-ai`,
    });
  };
  router.get(METADATA_PATH, onlyWhenEnabled, protectedResource);
  router.get(`${METADATA_PATH}/mcp`, onlyWhenEnabled, protectedResource);

  // Not required by the current MCP spec, but some clients still look here
  router.get("/.well-known/oauth-authorization-server", onlyWhenEnabled, async (_req, res) => {
    try {
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.json(await deps.fetchAuthServerMetadata());
    } catch (err) {
      console.error("[MCP] Couldn't fetch authorization server metadata:", err);
      res.status(502).json({ error: "Couldn't reach the sign-in server. Try again shortly." });
    }
  });

  function challenge(req: any, res: any, error?: { code: string; description: string }) {
    let header = `Bearer resource_metadata="${metadataUrl(req)}"`;
    if (error) header += `, error="${error.code}", error_description="${error.description}"`;
    res.setHeader("WWW-Authenticate", header);
    jsonRpcError(res, 401, -32001, error ? error.description : "Sign in to Grammie to use this connector.");
  }

  const handle: RequestHandler = async (req: any, res) => {
    const ip = String(req.ip || req.socket?.remoteAddress || "unknown");
    const token = bearer(req);
    if (!token) {
      if (!limiters.anonIp.hit(ip)) return jsonRpcError(res, 429, -32000, "Too many requests. Wait a minute and try again.");
      return challenge(req, res);
    }

    let verified: VerifiedToken | null = null;
    try {
      verified = await deps.verifyToken(token);
    } catch (err) {
      console.error("[MCP] Token check failed:", err);
    }
    if (verified?.expiresAt && verified.expiresAt * 1000 <= now().getTime()) verified = null;
    if (!verified) {
      if (!limiters.anonIp.hit(ip)) return jsonRpcError(res, 429, -32000, "Too many requests. Wait a minute and try again.");
      return challenge(req, res, { code: "invalid_token", description: "The access token is invalid or has expired." });
    }

    const key = tokenKey(token);
    if (!limiters.token.hit(key)) return jsonRpcError(res, 429, -32000, "Too many requests. Wait a minute and try again.");

    let userId: string | null = null;
    try {
      userId = await deps.resolveUserId(verified.subject);
    } catch (err) {
      console.error("[MCP] Couldn't find the Grammie account for a token:", err);
    }
    if (!userId) return challenge(req, res, { code: "invalid_token", description: "No Grammie account for this sign-in." });
    if (!limiters.user.hit(userId)) return jsonRpcError(res, 429, -32000, "Too many requests. Wait a minute and try again.");

    if (req.method !== "POST") {
      // Stateless server: no standalone SSE stream (GET) and no sessions to end (DELETE)
      res.setHeader("Allow", "POST");
      return jsonRpcError(res, 405, -32000, "Method not allowed.");
    }
    if (Number(req.headers["content-length"] || 0) > MAX_BODY_BYTES) {
      return jsonRpcError(res, 413, -32000, "Request too large.");
    }

    const ctx: ToolContext = { userId, tokenKey: key, clientId: verified.clientId || null, origin: origin(req) };
    const toolDeps: ToolDeps = {
      data: deps.data,
      enrichment: deps.enrichment,
      limiters: limiters.tools,
      writesEnabled: deps.writesEnabled?.() ?? true,
      audit,
      now,
    };
    const server = createGrammieMcpServer(ctx, toolDeps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[MCP] Request failed:", err);
      if (!res.headersSent) jsonRpcError(res, 500, -32603, "Something went wrong. Try again.");
    }
  };
  router.all("/mcp", onlyWhenEnabled, handle);

  return router;
}


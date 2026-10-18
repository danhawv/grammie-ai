# Grammie connector (MCP)

The Grammie connector lets people connect their own AI assistant (Claude, ChatGPT, Grok, Gemini, or any MCP client) to their Grammie data. It is a remote MCP server at `https://grammie.ai/mcp`. It uses the Streamable HTTP transport in stateless mode, with JSON responses.

- Code: `server/routes/mcp.ts` (HTTP, auth, limits), `server/mcp/tools.ts` (tools), `server/mcp/format.ts` (output shaping and caps), `server/mcp/wiring.ts` (production deps), `server/mcp/config.ts` (env). Tests: `server/routes/mcp.test.ts`, `server/mcp/format.test.ts`.
- Spec basis: MCP 2025-06-18 / 2026-07-28 authorization. This server is an OAuth 2.1 **resource server**. Clerk is the **authorization server**: it signs users in, shows consent, and issues tokens. We serve Protected Resource Metadata (RFC 9728), and every 401 carries `WWW-Authenticate: Bearer resource_metadata="…"`.
- It ships **off**. While `MCP_ENABLED` isn't `true`, `/mcp` and the `/.well-known/oauth-*` routes answer 404, and the settings section stays hidden.

## Routes

| Route | Purpose |
|---|---|
| `POST /mcp` | MCP JSON-RPC (Bearer token required). `GET`/`DELETE` → 405 (stateless: no SSE stream, no sessions). |
| `GET /.well-known/oauth-protected-resource/mcp` | RFC 9728 metadata: `resource`, `authorization_servers: [Clerk]`, `scopes_supported`, `bearer_methods_supported`. |
| `GET /.well-known/oauth-protected-resource` | Same document, for clients that look at the root. |
| `GET /.well-known/oauth-authorization-server` | Clerk's own metadata, proxied and cached for an hour. Older clients still look here. |
| `GET /api/mcp/status` | `{ enabled }`. The settings page uses it to show or hide "Connect your AI assistant". |

CORS: the connector paths allow any origin (`*`). They are bearer-only, with no cookies. They expose `WWW-Authenticate` and answer their own preflights (`mcpCors`, mounted in `server/index.ts` before the site CORS).

## Tools

All tools are thin wrappers over the storage the app already uses. None of them calls an AI model or spends credits, except `create_recipe` with `enrich: true`. Every tool has a `title` and `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint` annotations. There are **no delete tools**.

| Tool | Kind | What it does |
|---|---|---|
| `search_recipes` | read | Search by title or description, with optional scope (all/mine/shared), diets, meal types, cuisines and allergens to exclude. Up to 25 cards. |
| `get_recipe` | read | Full recipe: ingredients, steps, times, nutrition per serving, tips and tags. Optional `servings` scales the amount at the start of each ingredient line. |
| `list_cookbooks` | read | Own cookbooks plus cookbooks shared with the user. |
| `get_cookbook_recipes` | read | Recipes in one cookbook. If someone else's public cookbook holds their private recipes, those are left out. |
| `what_can_i_make` | read | Matches the pantry to recipes the user can see, following their food profile. Same logic as the app (`server/lib/what-can-i-make.ts`). |
| `get_pantry` | read | Pantry items with amounts and expiry dates. |
| `get_grocery_list` | read | The active grocery list. |
| `get_meal_plan` | read | The plan covering a date (default: today in UTC), otherwise the latest plan, plus its entries. |
| `add_to_grocery_list` | write (additive) | Adds items and/or a recipe's ingredients (with `scale`). Returns what was added and how to undo it. |
| `add_recipe_to_meal_plan` | write (additive) | Adds a recipe to a day and meal. If no plan covers that day, starts a new Monday–Sunday plan. Returns the entry id and how to undo it. |
| `create_recipe` | write (additive) | Saves a **private** recipe from structured fields. Free by default (no AI). `enrich: true` runs the normal import credit check (1 credit, `recipe_import`), then queues enrichment and a dish photo. |

Set `MCP_READ_ONLY=true` to hide the three write tools.

### Safety

- **Who the user is.** The token's Clerk user id is mapped to the Grammie user with `upsertUserFromClerk` (`server/clerkAuth.ts`). This is the same mapping as normal sign-in: by `clerk_id`, then by verified email, otherwise a new user.
- **Isolation.** Each data method takes the Grammie user id and returns only their own data, data shared with them, and public recipes. `getRecipe` deliberately skips the admin override that `storage.getRecipe` has. Tests cover isolation for every tool.
- **Rate limits.** These are in-memory, per process (`mcpLimiters()` in `server/routes/mcp.ts`):
  - 90 requests/min per token
  - 180 requests/min per user
  - 60 requests/min per IP for unauthenticated or bad-token calls
  - writes: 20/min and 300/day per user
  - `create_recipe`: 50/day per user
- **Size caps.** Text fields are clipped to 1,500 chars, short fields to 300. Lists are capped at 100 ingredients, 60 steps and 300 items. A whole result is capped at about 60 KB; lists are trimmed first, and the result is marked `truncated`.
- **Prompt-injection hygiene.** Recipe text goes out as labelled JSON fields. Each result that includes recipe text carries a `note` telling the assistant to treat the text as data. The server `instructions` say the same.
- **Audit.** Every write tool logs one `[MCP audit] {…}` line with tool, userId, token hash prefix, client id, outcome and ids. The token itself is never logged.
- **Token checks.** `clerk.idPOAuthAccessToken.verify(token)` (`@clerk/backend`). Revoked or expired tokens are refused. Good results are cached for 60 s under a hash of the token.

### Scopes

Clerk's OAuth applications offer identity scopes (`openid`, `profile`, `email`, `public_metadata`, `private_metadata`). As far as we know, they do **not** offer custom API scopes such as `recipes:read` or `recipes:write`, so read and write can't be split by scope. What we do instead:

- The metadata advertises `openid profile email`. Override this with `MCP_SCOPES`.
- Write access is all or nothing per deployment (`MCP_READ_ONLY=true`). Every write is additive and audited, and there are no deletes.
- If Clerk adds custom scopes later, check `verified.scopes` in `server/routes/mcp.ts` before registering the write tools.

## Owner setup

### 1. Clerk dashboard (production instance)

Don't paste keys anywhere except Railway variables.

1. **Configure → OAuth applications → Settings → Client onboarding**:
   - Turn on **Publish CIMD support** (Client ID Metadata Documents). Current Claude and ChatGPT clients identify themselves this way. CIMD clients always use PKCE S256.
   - Turn on **Publish DCR support** (Dynamic Client Registration) too, because some clients (older ones, some Grok and Gemini setups, MCP Inspector) still need it.
   - Set **Default scopes for dynamic clients** to `openid profile email`. Some clients send no `scope`.
   - Optional: if you only want known clients, turn on "only allow pre-registered clients" and add Claude and ChatGPT under **Applications**.
2. If a client is ever registered by hand, give it these **redirect URIs**:
   - Claude: `https://claude.ai/api/mcp/auth_callback` (also allow `https://claude.com/api/mcp/auth_callback`)
   - ChatGPT: `https://chatgpt.com/connector_platform_oauth_redirect` (check this against OpenAI's current docs when registering)
   - Claude Code / MCP Inspector use localhost callbacks; DCR/CIMD handles those.
3. Check the consent screen: the app name "Grammie", the logo, and links to the privacy policy and terms.
4. CLI check (read-only): `npx clerk@latest api instance/oauth_application_settings`.

### 2. Railway variables

| Variable | Value |
|---|---|
| `MCP_ENABLED` | `true` turns the connector on. Leave it unset to keep it off. |
| `CLERK_SECRET_KEY` | Already set. |
| `CLERK_PUBLISHABLE_KEY` or `VITE_CLERK_PUBLISHABLE_KEY` | Already set. The Clerk issuer (`https://clerk.grammie.ai`) is read from it. |
| `MCP_AUTH_SERVER_URL` | Optional. Overrides the issuer URL if the key-derived one is wrong. |
| `PUBLIC_URL` | `https://grammie.ai`. Already set. It is the `resource` in the metadata, so it must match the URL people paste. |
| `MCP_SCOPES` | Optional. Space- or comma-separated list for `scopes_supported`. |
| `MCP_READ_ONLY` | Optional. `true` hides the write tools. |

### 3. Smoke test after deploy

1. `curl -i https://grammie.ai/mcp -X POST` should return 401 with a `WWW-Authenticate … resource_metadata=` header.
2. `curl https://grammie.ai/.well-known/oauth-protected-resource/mcp` should list Clerk under `authorization_servers`.
3. `npx @modelcontextprotocol/inspector`: connect to `https://grammie.ai/mcp`, sign in, list tools, call `search_recipes`.
4. In Claude: add a custom connector, then ask "What can I make tonight?"

## How users add it

- **Claude** (claude.ai, Desktop, mobile; Pro/Max/Team/Enterprise): Settings → Connectors → **Add custom connector**. Name `Grammie`, URL `https://grammie.ai/mcp`. Then **Connect** and sign in to Grammie. **Claude Code**: `claude mcp add --transport http grammie https://grammie.ai/mcp`, then `/mcp` to sign in.
- **ChatGPT** (developer mode, Plus/Pro/Business): Settings → Apps & Connectors → Advanced → turn on **Developer mode**. Then **Create**: name `Grammie`, MCP server URL `https://grammie.ai/mcp`, authentication **OAuth**. Sign in. Write tools ask for confirmation in chat.
- **Grok**: where the Grok app or API offers remote MCP servers / connectors, add `https://grammie.ai/mcp` and sign in. With the xAI API, pass it as a remote MCP tool with the user's OAuth token.
- **Gemini**: Gemini CLI, `~/.gemini/settings.json` → `"mcpServers": { "grammie": { "httpUrl": "https://grammie.ai/mcp" } }`, then `/mcp auth grammie`. Other Gemini surfaces work wherever they accept a remote MCP server.

## Directory submission checklists

### Claude Connectors Directory

- [ ] Server reachable over HTTPS at a stable URL (`https://grammie.ai/mcp`), Streamable HTTP
- [ ] OAuth via Clerk works from `https://claude.ai/api/mcp/auth_callback`. CIMD or DCR is on.
- [ ] Every tool has a `title` plus `readOnlyHint` / `destructiveHint` annotations (covered by a test)
- [ ] Tool names and descriptions are accurate and don't steer the model toward other tools or services
- [ ] Privacy policy URL that covers the connector, i.e. what assistants can read and write (e.g. `https://grammie.ai/privacy`)
- [ ] Terms of service URL
- [ ] Support contact (email or URL) and documentation link (the help text below)
- [ ] Icon/logo (square PNG/SVG) and short and long descriptions
- [ ] A **test account with sample data** (recipes, a cookbook, pantry items, a grocery list, a meal plan) and its login for reviewers. Keep it on a non-admin account.
- [ ] Example prompts, e.g. "What can I make with what's in my pantry?", "Add Grandma's lasagna to Sunday dinner", "Put the ingredients for the soup on my grocery list"
- [ ] Rate limits and error messages are user-readable (done)

### ChatGPT app directory (Apps SDK / MCP)

- [ ] Same server URL, with OAuth through Clerk (CIMD/DCR), and redirect URI allowed
- [ ] Annotations on every tool: `readOnlyHint`, `destructiveHint`, **`openWorldHint`** (all set; `openWorldHint: false`, since tools only touch Grammie)
- [ ] Privacy policy, terms, support contact, app name and icon, and a description that doesn't overclaim
- [ ] Demo/test account with data, and test prompts plus expected results for reviewers
- [ ] Data use: we don't ask for or store chat context; tools return only what was requested; write actions are additive and say how to undo them
- [ ] Verified organization / publisher details in the OpenAI platform dashboard

## "Connect your AI" help text (for the site or help center)

> **Connect your AI assistant to Grammie**
>
> You can connect your own AI assistant to your recipe box. Claude, ChatGPT, Grok and Gemini all work. Then you can ask things like "What can I make tonight?" or "Add Grandma's pot roast to Sunday dinner and put what I need on my grocery list."
>
> 1. In Grammie, open **Me → Connect your AI assistant** and copy the connector address (`https://grammie.ai/mcp`).
> 2. In your assistant, add a custom connector (Claude: Settings → Connectors. ChatGPT: Settings → Apps & Connectors, with Developer mode on). Paste the address.
> 3. Sign in to Grammie when asked and approve access.
>
> Your assistant can read your recipes, cookbooks, pantry, grocery list and meal plans. It can add to your grocery list and meal plan, and save new recipes, which are private. It can't delete anything or see other people's private recipes. Saving a recipe is free. If you ask Grammie to add nutrition and a photo to it, that uses 1 credit. To disconnect, remove Grammie in your assistant's connector settings.

## Known gaps and risks

- **Audience binding.** Clerk access tokens are issued for this Clerk instance, and `idPOAuthAccessToken.verify` doesn't report an RFC 8707 audience. So we can't strictly check that a token was minted *for* `https://grammie.ai/mcp`. In practice, the only resource behind this Clerk instance's OAuth is Grammie. Revisit this if Clerk exposes `aud`/`resource` on OAuth tokens. If it does, compare it to `${PUBLIC_URL}/mcp` in `verifyToken`.
- **Open client registration.** With DCR or CIMD on, any client can ask a user for consent. The consent screen is the control. Restrict to pre-registered clients if abuse shows up.
- **In-memory rate limits** apply per server process, like the meal-prep limits.
- **Clerk API call per new token.** Verification goes to Clerk's Backend API, cached for 60 s per token. Watch Clerk rate limits if usage grows; local JWT verification is an option if Clerk issues JWT-format OAuth tokens.
- **We didn't use `@clerk/mcp-tools`.** Its Express helpers declare Express 5 and `@clerk/express` as peers, and the app runs Express 4 with `@clerk/backend`. We implement the same three pieces directly: the metadata routes, the bearer check, and the Streamable HTTP handler.
- **"Today"** in `get_meal_plan` means UTC. The tool description asks assistants to pass the user's local date.

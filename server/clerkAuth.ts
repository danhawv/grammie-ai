import type { Express, RequestHandler } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";
import { verifyToken, generateToken, shouldRefreshToken, type JWTPayload } from "./jwt";

export { generateToken, verifyToken, shouldRefreshToken };

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });

  const isProduction = process.env.NODE_ENV === "production";

  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: sessionTtl,
    },
  });
}

/**
 * Fetch full user details from Clerk API.
 * Session JWTs don't contain email — we must fetch from Clerk's users endpoint.
 */
async function fetchClerkUserDetails(clerkUserId: string): Promise<{
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
  emailVerified: boolean;
} | null> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;

  try {
    const { createClerkClient } = await import("@clerk/backend");
    const clerkClient = createClerkClient({ secretKey });
    const clerkUser = await clerkClient.users.getUser(clerkUserId);

    const primaryEmail = clerkUser.emailAddresses?.find(
      (e: any) => e.id === clerkUser.primaryEmailAddressId
    );

    return {
      email: primaryEmail?.emailAddress ?? null,
      firstName: clerkUser.firstName ?? null,
      lastName: clerkUser.lastName ?? null,
      imageUrl: clerkUser.imageUrl ?? null,
      emailVerified: primaryEmail?.verification?.status === "verified",
    };
  } catch (err) {
    console.error("[ClerkAuth] Failed to fetch user details:", err);
    return null;
  }
}

/**
 * Upsert user from Clerk.
 * 1. Look up by clerk_id (returning user, fastest path)
 * 2. Fetch full details from Clerk API (email, name, image)
 * 3. Look up by verified email (link existing account)
 * 4. Create new user record
 */
async function upsertUserFromClerk(clerkUserId: string) {
  // Fast path: already linked
  const existingByClerkId = await storage.getUserByClerkId(clerkUserId);
  if (existingByClerkId) {
    return existingByClerkId;
  }

  // Fetch full user details from Clerk API
  const clerkDetails = await fetchClerkUserDetails(clerkUserId);

  // Only link by email if the email is verified (security: prevent account takeover)
  if (clerkDetails?.email && clerkDetails.emailVerified) {
    const existingByEmail = await storage.getUserByEmail(clerkDetails.email);
    if (existingByEmail) {
      await storage.updateUser(existingByEmail.id, {
        clerkId: clerkUserId,
        profileImageUrl: clerkDetails.imageUrl ?? existingByEmail.profileImageUrl,
        firstName: clerkDetails.firstName ?? existingByEmail.firstName,
        lastName: clerkDetails.lastName ?? existingByEmail.lastName,
      } as any);
      return { ...existingByEmail, clerkId: clerkUserId };
    }
  }

  // Create new user with UUID
  const newUser = await storage.upsertUser({
    id: undefined as any,
    clerkId: clerkUserId,
    email: clerkDetails?.email ?? undefined,
    firstName: clerkDetails?.firstName ?? undefined,
    lastName: clerkDetails?.lastName ?? undefined,
    profileImageUrl: clerkDetails?.imageUrl ?? undefined,
  } as any);

  return newUser;
}

/**
 * Verify a Clerk session token.
 * Returns the Clerk user ID (sub) or null if invalid.
 */
async function verifyClerkToken(token: string): Promise<string | null> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;

  try {
    const { verifyToken: clerkVerifyToken } = await import("@clerk/backend");
    const payload = await clerkVerifyToken(token, { secretKey });
    return payload?.sub ?? null;
  } catch {
    return null;
  }
}

function extractBearerToken(req: any): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }
  return null;
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());

  try {
    const cookieParser = (await import("cookie-parser")).default;
    app.use(cookieParser());
  } catch {
    // cookie-parser not installed; Clerk cookie auth won't work but local auth still will
  }

  const passport = (await import("passport")).default;
  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user: any, cb) => cb(null, user));
  passport.deserializeUser((user: any, cb) => cb(null, user));

  app.get("/api/login", (req, res) => {
    res.redirect("/login");
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect("/");
    });
  });

  // Current user endpoint — upserts on first Clerk sign-in
  app.get("/api/user", async (req: any, res) => {
    try {
      // 1. Bearer token (mobile JWT then Clerk)
      const bearerToken = extractBearerToken(req);
      if (bearerToken) {
        const mobilePayload = verifyToken(bearerToken);
        if (mobilePayload) {
          const dbUser = await storage.getUser(mobilePayload.sub);
          return res.json(dbUser ?? null);
        }

        if (process.env.CLERK_SECRET_KEY) {
          const clerkUserId = await verifyClerkToken(bearerToken);
          if (clerkUserId) {
            const dbUser = await upsertUserFromClerk(clerkUserId);
            return res.json(dbUser ?? null);
          }
        }
      }

      // 2. Clerk session cookie
      if (process.env.CLERK_SECRET_KEY && req.cookies?.["__session"]) {
        const clerkUserId = await verifyClerkToken(req.cookies["__session"]);
        if (clerkUserId) {
          const dbUser = await upsertUserFromClerk(clerkUserId);
          return res.json(dbUser ?? null);
        }
      }

      // 3. Local session (passport)
      if (req.isAuthenticated && req.isAuthenticated()) {
        const sessionUser = req.user as any;
        if (sessionUser?.claims?.sub) {
          const dbUser = await storage.getUser(sessionUser.claims.sub);
          return res.json(dbUser ?? null);
        }
      }

      // 4. Dev bypass
      if (process.env.NODE_ENV === "development" && !process.env.CLERK_SECRET_KEY) {
        const dbUser = await storage.getUser("37290791");
        return res.json(dbUser ?? null);
      }

      return res.json(null);
    } catch (error) {
      console.error("Error in /api/user:", error);
      return res.json(null);
    }
  });
}

/**
 * Multi-layered isAuthenticated middleware:
 * 1. Mobile JWT Bearer token
 * 2. Clerk Bearer token (with upsert)
 * 3. Clerk session cookie (with upsert)
 * 4. Local passport session
 * 5. Dev bypass (only when Clerk not configured)
 */
export const isAuthenticated: RequestHandler = async (req: any, res, next) => {
  const isDevelopment = process.env.NODE_ENV === "development";
  const hasClerk = !!process.env.CLERK_SECRET_KEY;

  // ── 1. Bearer token ────────────────────────────────────────────────────────
  const bearerToken = extractBearerToken(req);
  if (bearerToken) {
    // Try mobile JWT first (our own signing key, fast check)
    const mobilePayload = verifyToken(bearerToken);
    if (mobilePayload) {
      req.user = {
        claims: { sub: mobilePayload.sub, email: mobilePayload.email },
        expires_at: mobilePayload.exp,
        isJwtAuth: true,
      };
      if (shouldRefreshToken(mobilePayload)) {
        res.setHeader("X-Token-Refresh-Suggested", "true");
      }
      return next();
    }

    // Try Clerk token (different signing key)
    if (hasClerk) {
      const clerkUserId = await verifyClerkToken(bearerToken);
      if (clerkUserId) {
        try {
          const dbUser = await upsertUserFromClerk(clerkUserId);
          req.user = {
            claims: { sub: dbUser.id, email: dbUser.email },
            expires_at: Math.floor(Date.now() / 1000) + 86400,
            isClerkAuth: true,
          };
          return next();
        } catch (err) {
          console.error("[ClerkAuth] Failed to upsert user:", err);
        }
      }
      return res.status(401).json({ message: "Unauthorized - invalid token", code: "TOKEN_INVALID" });
    }
  }

  // ── 2. Clerk session cookie ────────────────────────────────────────────────
  if (hasClerk && req.cookies?.["__session"]) {
    const clerkUserId = await verifyClerkToken(req.cookies["__session"]);
    if (clerkUserId) {
      try {
        const dbUser = await upsertUserFromClerk(clerkUserId);
        req.user = {
          claims: { sub: dbUser.id, email: dbUser.email },
          expires_at: Math.floor(Date.now() / 1000) + 86400,
          isClerkAuth: true,
        };
        return next();
      } catch (err) {
        console.error("[ClerkAuth] Failed to upsert user from cookie:", err);
      }
    }
  }

  // ── 3. Local passport session ──────────────────────────────────────────────
  if (req.isAuthenticated && req.isAuthenticated()) {
    const user = req.user as any;
    if (user?.claims?.sub) {
      const now = Math.floor(Date.now() / 1000);
      if (user.expires_at && now > user.expires_at) {
        return res.status(401).json({ message: "Unauthorized - session expired", code: "SESSION_EXPIRED" });
      }
      return next();
    }
  }

  // ── 4. Dev bypass ──────────────────────────────────────────────────────────
  if (isDevelopment && !hasClerk) {
    req.user = {
      claims: { sub: "37290791", email: "danhawv@gmail.com", first_name: "Admin", last_name: "User" },
      expires_at: Math.floor(Date.now() / 1000) + 86400,
    };
    return next();
  }

  return res.status(401).json({ message: "Unauthorized - not authenticated", code: "NOT_AUTHENTICATED" });
};

/**
 * Optional auth middleware: populates req.user if credentials exist, but allows
 * unauthenticated requests to proceed. Use on public endpoints that behave
 * differently for logged-in vs anonymous users (e.g. recipe detail visibility).
 */
export const optionalAuth: RequestHandler = async (req: any, _res, next) => {
  const isDevelopment = process.env.NODE_ENV === "development";
  const hasClerk = !!process.env.CLERK_SECRET_KEY;

  const bearerToken = extractBearerToken(req);
  if (bearerToken) {
    const mobilePayload = verifyToken(bearerToken);
    if (mobilePayload) {
      req.user = {
        claims: { sub: mobilePayload.sub, email: mobilePayload.email },
        expires_at: mobilePayload.exp,
        isJwtAuth: true,
      };
      return next();
    }

    if (hasClerk) {
      const clerkUserId = await verifyClerkToken(bearerToken);
      if (clerkUserId) {
        try {
          const dbUser = await upsertUserFromClerk(clerkUserId);
          req.user = {
            claims: { sub: dbUser.id, email: dbUser.email },
            expires_at: Math.floor(Date.now() / 1000) + 86400,
            isClerkAuth: true,
          };
        } catch {}
      }
      return next();
    }
  }

  if (hasClerk && req.cookies?.["__session"]) {
    const clerkUserId = await verifyClerkToken(req.cookies["__session"]);
    if (clerkUserId) {
      try {
        const dbUser = await upsertUserFromClerk(clerkUserId);
        req.user = {
          claims: { sub: dbUser.id, email: dbUser.email },
          expires_at: Math.floor(Date.now() / 1000) + 86400,
          isClerkAuth: true,
        };
      } catch {}
    }
  }

  if (!req.user && req.isAuthenticated && req.isAuthenticated()) {
    const user = req.user as any;
    if (user?.claims?.sub) {
      return next();
    }
  }

  if (!req.user && isDevelopment && !hasClerk) {
    req.user = {
      claims: { sub: "37290791", email: "danhawv@gmail.com", first_name: "Admin", last_name: "User" },
      expires_at: Math.floor(Date.now() / 1000) + 86400,
    };
  }

  return next();
};

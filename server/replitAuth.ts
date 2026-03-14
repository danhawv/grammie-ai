import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";
import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";
import { verifyToken, generateToken, shouldRefreshToken, refreshToken, type JWTPayload } from "./jwt";

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!,
    );
  },
  { maxAge: 3600 * 1000 },
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });

  // In production, we're always on HTTPS. In dev, Replit handles SSL termination
  const isProduction = process.env.NODE_ENV === "production";

  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction, // Only require HTTPS in production
      sameSite: "lax", // Allow cookies to be sent with cross-site requests
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(claims: any) {
  await storage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback,
  ) => {
    const user = {};
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user);
  };

  // Keep track of registered strategies
  const registeredStrategies = new Set<string>();

  // Helper function to ensure strategy exists for a domain
  const ensureStrategy = (domain: string) => {
    const strategyName = `replitauth:${domain}`;
    if (!registeredStrategies.has(strategyName)) {
      const strategy = new Strategy(
        {
          name: strategyName,
          config,
          scope: "openid email profile offline_access",
          callbackURL: `https://${domain}/api/callback`,
        },
        verify,
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
  };

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req: any, res, next) => {
    ensureStrategy(req.hostname);
    
    console.log('[OAuth Callback] Session ID:', req.sessionID);
    console.log('[OAuth Callback] Session data:', { 
      mobileAuth: req.session?.mobileAuth, 
      mobileRedirectScheme: req.session?.mobileRedirectScheme 
    });
    
    passport.authenticate(`replitauth:${req.hostname}`, (err: any, user: any, info: any) => {
      if (err) {
        console.error('OAuth callback error:', err);
        if (req.session?.mobileAuth) {
          const scheme = req.session?.mobileRedirectScheme || 'grammix';
          return res.redirect(`${scheme}://auth/callback?error=oauth_error`);
        }
        return res.redirect('/api/login');
      }
      
      if (!user) {
        console.log('[OAuth Callback] No user returned from OAuth');
        if (req.session?.mobileAuth) {
          const scheme = req.session?.mobileRedirectScheme || 'grammix';
          return res.redirect(`${scheme}://auth/callback?error=authentication_failed`);
        }
        return res.redirect('/api/login');
      }
      
      req.logIn(user, (loginErr: any) => {
        if (loginErr) {
          console.error('Login error:', loginErr);
          if (req.session?.mobileAuth) {
            const scheme = req.session?.mobileRedirectScheme || 'grammix';
            return res.redirect(`${scheme}://auth/callback?error=login_error`);
          }
          return res.redirect('/api/login');
        }
        
        console.log('[OAuth Callback] Login successful. mobileAuth:', req.session?.mobileAuth);
        
        // Check if this is a mobile auth flow
        if (req.session?.mobileAuth) {
          console.log('[OAuth Callback] Mobile auth detected, redirecting to /api/auth/mobile/callback');
          return res.redirect('/api/auth/mobile/callback');
        }
        
        // Standard web redirect
        console.log('[OAuth Callback] Standard web flow, redirecting to /');
        return res.redirect('/');
      });
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href,
      );
    });
  });

  app.get("/api/user", async (req, res) => {
    const user = req.user as any;
    if (!req.isAuthenticated() || !user.claims) {
      return res.json(null);
    }

    try {
      const dbUser = await storage.getUser(user.claims.sub);
      return res.json(dbUser);
    } catch (error) {
      console.error("Error fetching user:", error);
      return res.json(null);
    }
  });
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(req: any): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}

/**
 * Dual-auth middleware: Accepts both JWT Bearer tokens (mobile) and cookie sessions (web)
 * This replaces the original isAuthenticated for routes that need to support both platforms
 */
export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const isDevelopment = process.env.NODE_ENV === "development";

  // Check for JWT Bearer token first (mobile app)
  const bearerToken = extractBearerToken(req);
  if (bearerToken) {
    const payload = verifyToken(bearerToken);
    if (payload) {
      // Valid JWT - attach user to request in same format as session auth
      (req as any).user = {
        claims: {
          sub: payload.sub,
          email: payload.email,
          first_name: null,
          last_name: null,
        },
        expires_at: payload.exp,
        isJwtAuth: true, // Flag to identify JWT-based auth
      };
      
      // If token is close to expiring, add refresh hint in response header
      if (shouldRefreshToken(payload)) {
        res.setHeader('X-Token-Refresh-Suggested', 'true');
      }
      
      return next();
    } else {
      // Invalid or expired JWT
      return res.status(401).json({ 
        message: "Unauthorized - invalid or expired token",
        code: "TOKEN_INVALID"
      });
    }
  }

  // Fall back to cookie session auth (web)
  const user = req.user as any;

  // DEVELOPMENT MODE: Bypass authentication and use admin user
  if (isDevelopment && !req.isAuthenticated()) {
    console.log("🔧 DEV MODE: Bypassing auth, using admin user (37290791)");
    (req as any).user = {
      claims: {
        sub: "37290791",
        email: "danhawv@gmail.com",
        first_name: "Admin",
        last_name: "User",
      },
      expires_at: Math.floor(Date.now() / 1000) + 86400,
    };
    return next();
  }

  if (!req.isAuthenticated()) {
    console.error(
      "Authentication check failed: req.isAuthenticated() returned false",
    );
    return res
      .status(401)
      .json({ message: "Unauthorized - not authenticated", code: "NOT_AUTHENTICATED" });
  }

  if (!user || !user.expires_at) {
    console.error("Authentication check failed: user or expires_at missing", {
      hasUser: !!user,
      hasExpiresAt: user?.expires_at,
    });
    return res.status(401).json({ message: "Unauthorized - invalid session", code: "INVALID_SESSION" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  // Token expired, try to refresh
  const sessionRefreshToken = user.refresh_token;
  if (!sessionRefreshToken) {
    console.error(
      "Authentication check failed: token expired and no refresh token available",
    );
    res.status(401).json({ message: "Unauthorized - session expired", code: "SESSION_EXPIRED" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, sessionRefreshToken);
    updateUserSession(user, tokenResponse);
    console.log("Successfully refreshed token");
    return next();
  } catch (error) {
    console.error("Token refresh failed:", error);

    if (process.env.NODE_ENV === "development") {
      console.log(
        "🔧 DEV MODE: Allowing request to continue despite refresh failure",
      );
      return next();
    }

    res.status(401).json({ message: "Unauthorized - refresh failed", code: "REFRESH_FAILED" });
    return;
  }
};

/**
 * Generate JWT token for a user (used by mobile auth endpoints)
 */
export { generateToken, verifyToken, shouldRefreshToken, refreshToken as refreshJwtToken };

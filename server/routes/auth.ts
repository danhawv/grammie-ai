import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import passport from "passport";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { hashPassword } from "../password-utils";
import { getUserId } from "./route-utils";

const router = Router();

// Check auth status (public endpoint - no auth required, but respects dev bypass)
router.get("/auth/status", async (req: any, res) => {
  const isDevelopment = process.env.NODE_ENV === 'development';

  // In development, inject admin user if not authenticated (same as isAuthenticated middleware)
  if (isDevelopment && !req.isAuthenticated()) {
    (req as any).user = {
      claims: {
        sub: '37290791',
        email: 'danhawv@gmail.com',
        first_name: 'Admin',
        last_name: 'User',
      },
      expires_at: Math.floor(Date.now() / 1000) + 86400,
    };
  }

  const userId = getUserId(req);

  // Fetch full user data including preferences if authenticated
  let userData = null;
  if (userId) {
    try {
      const user = await storage.getUser(userId);
      if (user) {
        userData = {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username,
          preferences: user.preferences || {},
        };
      }
    } catch (error) {
      console.error("Error fetching user for auth status:", error);
    }
  }

  res.json({
    isAuthenticated: !!userId,
    userId: userId || null,
    user: userData,
  });
});

router.get("/auth/user", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const user = await storage.getUser(userId);
    res.json(user);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ message: "Failed to fetch user" });
  }
});

// Update user profile
router.patch("/auth/user", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { username, bio, defaultRecipeVisibility, defaultCookbookVisibility, autoEnrichRecipes, notifyOnEnrichmentComplete, notifyOnCookbookFollows } = req.body;

    const user = await storage.upsertUser({
      id: userId,
      email: req.user.claims.email,
      username,
      bio,
      defaultRecipeVisibility,
      defaultCookbookVisibility,
      autoEnrichRecipes,
      notifyOnEnrichmentComplete,
      notifyOnCookbookFollows,
    });

    res.json(user);
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ message: "Failed to update user" });
  }
});

// ============================================================================
// MOBILE APP AUTHENTICATION (JWT-based)
// ============================================================================

// Mobile OAuth login - initiates OAuth and redirects to deep link on success
router.get("/auth/mobile/login", async (req: any, res, next) => {
  const { validateScheme } = await import('../jwt');

  // Validate and sanitize the scheme parameter
  const scheme = validateScheme(req.query.scheme as string);
  if (!scheme) {
    return res.status(400).json({
      error: 'Invalid or unsupported URL scheme',
      code: 'INVALID_SCHEME'
    });
  }

  // Store the mobile callback URL in session
  req.session.mobileAuth = true;
  req.session.mobileRedirectScheme = scheme;

  console.log('[Mobile Auth] Starting OAuth flow with scheme:', scheme);
  console.log('[Mobile Auth] Session ID:', req.sessionID);
  console.log('[Mobile Auth] Session data set:', { mobileAuth: req.session.mobileAuth, mobileRedirectScheme: req.session.mobileRedirectScheme });

  // Save session before redirecting to ensure data persists
  req.session.save((err: any) => {
    if (err) {
      console.error('[Mobile Auth] Session save error:', err);
      return res.status(500).json({ error: 'Failed to initialize mobile auth session' });
    }
    console.log('[Mobile Auth] Session saved, redirecting to OAuth');
    res.redirect('/api/login');
  });
});

// Mobile token endpoint - simpler flow where user completes OAuth on web first
// Then mobile app opens this endpoint to get a JWT token via redirect
router.get("/auth/mobile/token", async (req: any, res) => {
  try {
    const { validateScheme, generateToken } = await import('../jwt');

    // Validate the scheme parameter
    const scheme = validateScheme(req.query.scheme as string);
    if (!scheme) {
      return res.status(400).json({
        error: 'Invalid or unsupported URL scheme',
        code: 'INVALID_SCHEME'
      });
    }

    // Check if user is logged in via session cookie
    if (!req.isAuthenticated() || !req.user) {
      // Return an HTML page with a login button instead of a raw 401
      return res.status(401).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Sign In Required</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
            .container { text-align: center; padding: 2rem; background: white; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; margin: 1rem; }
            h1 { color: #333; font-size: 1.5rem; margin-bottom: 0.5rem; }
            p { color: #666; margin-bottom: 1.5rem; }
            a { display: inline-block; background: #4f46e5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500; }
            a:hover { background: #4338ca; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Sign In Required</h1>
            <p>Please sign in to Grammie AI first, then return here.</p>
            <a href="/api/login">Sign In with Replit</a>
          </div>
        </body>
        </html>
      `);
    }

    const user = req.user as any;

    // Get user from database
    const dbUser = await storage.getUser(user.claims.sub);
    if (!dbUser) {
      return res.status(404).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Generate JWT token
    const token = generateToken({
      id: dbUser.id,
      email: dbUser.email,
      username: dbUser.username,
    });

    console.log('[Mobile Token] Generated token for user:', dbUser.username);

    // Redirect to mobile app with token
    const redirectUrl = `${scheme}://auth/callback?token=${encodeURIComponent(token)}`;
    console.log('[Mobile Token] Redirecting to:', scheme + '://auth/callback?token=<jwt>');
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('[Mobile Token] Error:', error);
    res.status(500).json({
      error: 'Failed to generate token',
      code: 'SERVER_ERROR'
    });
  }
});

// Mobile OAuth callback - generates JWT and redirects to app
router.get("/auth/mobile/callback", async (req: any, res) => {
  try {
    console.log('[Mobile Callback] Session ID:', req.sessionID);
    console.log('[Mobile Callback] Session data:', {
      mobileAuth: req.session?.mobileAuth,
      mobileRedirectScheme: req.session?.mobileRedirectScheme
    });
    console.log('[Mobile Callback] Is authenticated:', req.isAuthenticated());

    const user = req.user as any;

    if (!req.isAuthenticated() || !user?.claims) {
      console.log('[Mobile Callback] Authentication check failed');
      const scheme = req.session?.mobileRedirectScheme || 'grammix';
      const redirectUrl = `${scheme}://auth/callback?error=authentication_failed`;
      console.log('[Mobile Callback] Redirecting to:', redirectUrl);
      return res.redirect(redirectUrl);
    }

    // Get user from database
    const dbUser = await storage.getUser(user.claims.sub);
    if (!dbUser) {
      console.log('[Mobile Callback] User not found in database:', user.claims.sub);
      const scheme = req.session?.mobileRedirectScheme || 'grammix';
      return res.redirect(`${scheme}://auth/callback?error=user_not_found`);
    }

    // Generate JWT token
    const { generateToken } = await import('../jwt');
    const token = generateToken({
      id: dbUser.id,
      email: dbUser.email,
      username: dbUser.username,
    });

    const scheme = req.session?.mobileRedirectScheme || 'grammix';

    // Clear mobile auth session flags
    delete req.session.mobileAuth;
    delete req.session.mobileRedirectScheme;

    // Redirect to app with token
    const redirectUrl = `${scheme}://auth/callback?token=${encodeURIComponent(token)}`;
    console.log('[Mobile Callback] Success! Redirecting to:', redirectUrl.substring(0, 50) + '...');
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('Mobile auth callback error:', error);
    const scheme = req.session?.mobileRedirectScheme || 'grammix';
    res.redirect(`${scheme}://auth/callback?error=server_error`);
  }
});

// Mobile token refresh - get a new token before the current one expires
router.post("/auth/mobile/refresh", async (req: any, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Missing or invalid Authorization header',
        code: 'MISSING_TOKEN'
      });
    }

    const token = authHeader.substring(7);
    const { verifyTokenIgnoreExpiration, isWithinRefreshGracePeriod, refreshToken: refreshJwt } = await import('../jwt');

    // SECURITY: Always verify signature, even for expired tokens
    const { payload, isExpired } = verifyTokenIgnoreExpiration(token);

    if (!payload) {
      return res.status(401).json({
        error: 'Invalid token - signature verification failed',
        code: 'INVALID_TOKEN'
      });
    }

    // If token is expired, check if it's within the grace period
    if (isExpired && !isWithinRefreshGracePeriod(payload)) {
      return res.status(401).json({
        error: 'Token expired beyond refresh window (7 days)',
        code: 'TOKEN_EXPIRED'
      });
    }

    // Verify user still exists in database
    const user = await storage.getUser(payload.sub);
    if (!user) {
      return res.status(401).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Generate new token
    const newToken = refreshJwt(payload);

    res.json({
      token: newToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
      }
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      error: 'Failed to refresh token',
      code: 'SERVER_ERROR'
    });
  }
});

// Mobile token status - validate token and return user info
router.get("/auth/mobile/status", async (req: any, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        isAuthenticated: false,
        error: 'Missing or invalid Authorization header',
        code: 'MISSING_TOKEN'
      });
    }

    const token = authHeader.substring(7);
    const { verifyToken, shouldRefreshToken } = await import('../jwt');

    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({
        isAuthenticated: false,
        error: 'Invalid or expired token',
        code: 'TOKEN_INVALID'
      });
    }

    // Get user from database
    const user = await storage.getUser(payload.sub);
    if (!user) {
      return res.status(401).json({
        isAuthenticated: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    res.json({
      isAuthenticated: true,
      shouldRefreshToken: shouldRefreshToken(payload),
      tokenExpiresAt: payload.exp,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
        preferences: user.preferences || {},
      }
    });
  } catch (error) {
    console.error('Token status error:', error);
    res.status(500).json({
      isAuthenticated: false,
      error: 'Failed to validate token',
      code: 'SERVER_ERROR'
    });
  }
});

// ============================================================================
// LOCAL AUTH ROUTES (username/password)
// ============================================================================

// Register new user with username/password
router.post("/auth/register", async (req: any, res) => {
  try {
    // Validate request body
    const registerSchema = z.object({
      username: z.string().min(3, "Username must be at least 3 characters"),
      email: z.string().email("Invalid email format"),
      password: z.string().min(8, "Password must be at least 8 characters"),
    });

    const { username, email, password } = registerSchema.parse(req.body);

    // Check if username already exists in auth_credentials
    const existingByUsername = await storage.getAuthCredentialByProvider('local', username);
    if (existingByUsername) {
      return res.status(400).json({ message: "Username already exists" });
    }

    // Check if email already exists in users table
    const existingByEmail = await storage.getUserByEmail(email);
    if (existingByEmail) {
      return res.status(400).json({ message: "Email already registered" });
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user record
    const user = await storage.upsertUser({
      id: crypto.randomUUID(),
      email,
      username,
    });

    // Create auth credential record
    await storage.createAuthCredential({
      userId: user.id,
      provider: 'local',
      providerUserId: username,
      passwordHash,
    });

    // Auto-login the user
    const sessionUser = {
      claims: {
        sub: user.id,
        email: user.email,
        first_name: user.firstName,
        last_name: user.lastName,
        profile_image_url: user.profileImageUrl,
      },
      expires_at: Math.floor(Date.now() / 1000) + 86400, // 24 hours
    };

    req.login(sessionUser, (err: any) => {
      if (err) {
        console.error("Auto-login failed:", err);
        return res.status(500).json({ message: "Registration successful but login failed" });
      }
      res.json(user);
    });
  } catch (error: any) {
    console.error("Registration error:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.errors[0].message });
    }
    res.status(500).json({ message: "Registration failed" });
  }
});

// Login with username/password
router.post("/auth/login", (req: any, res, next) => {
  passport.authenticate('local', (err: any, user: any, info: any) => {
    if (err) {
      console.error("Login error:", err);
      return res.status(500).json({ message: "Login failed" });
    }
    if (!user) {
      return res.status(401).json({ message: info?.message || "Invalid credentials" });
    }
    req.login(user, async (loginErr: any) => {
      if (loginErr) {
        console.error("Session creation failed:", loginErr);
        return res.status(500).json({ message: "Login failed" });
      }
      // Get full user object to return
      try {
        const fullUser = await storage.getUser(user.claims.sub);
        return res.json(fullUser);
      } catch (error) {
        console.error("Error fetching user after login:", error);
        return res.status(500).json({ message: "Login successful but failed to fetch user data" });
      }
    });
  })(req, res, next);
});

export default router;

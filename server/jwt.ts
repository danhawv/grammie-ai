import jwt from 'jsonwebtoken';

// SECURITY: Enforce SESSION_SECRET in production
const isDevelopment = process.env.NODE_ENV === 'development';
const JWT_SECRET = process.env.SESSION_SECRET;

if (!JWT_SECRET && !isDevelopment) {
  throw new Error('CRITICAL: SESSION_SECRET environment variable is required in production for JWT signing');
}

// Use development fallback only in development mode
const SIGNING_SECRET = JWT_SECRET || (isDevelopment ? 'development-jwt-secret-do-not-use-in-prod' : '');

const TOKEN_EXPIRY = '30d'; // 30 days sliding expiration
const REFRESH_GRACE_PERIOD = 7 * 24 * 60 * 60; // 7 days in seconds

// Allowed deep link schemes (whitelist for security)
const ALLOWED_SCHEMES = ['grammix', 'grammix-dev', 'grammix-staging'];

export interface JWTPayload {
  sub: string; // user ID
  email: string | null;
  username: string | null;
  iat: number;
  exp: number;
}

export interface UserTokenData {
  id: string;
  email: string | null;
  username: string | null;
}

/**
 * Validate and sanitize deep link scheme
 * Returns the scheme if valid, null if invalid
 */
export function validateScheme(scheme: string | undefined): string | null {
  if (!scheme) return 'grammix'; // default scheme
  
  // Sanitize: only allow alphanumeric and hyphens
  const sanitized = scheme.toLowerCase().replace(/[^a-z0-9-]/g, '');
  
  // Check against whitelist
  if (ALLOWED_SCHEMES.includes(sanitized)) {
    return sanitized;
  }
  
  // In development, allow any valid scheme format
  if (isDevelopment && /^[a-z][a-z0-9-]*$/.test(sanitized)) {
    console.warn(`[JWT] Development mode: allowing non-whitelisted scheme: ${sanitized}`);
    return sanitized;
  }
  
  console.warn(`[JWT] Rejected invalid scheme: ${scheme}`);
  return null;
}

/**
 * Generate a JWT token for a user
 */
export function generateToken(user: UserTokenData): string {
  const payload = {
    sub: user.id,
    email: user.email,
    username: user.username,
  };
  
  return jwt.sign(payload, SIGNING_SECRET, {
    expiresIn: TOKEN_EXPIRY,
  });
}

/**
 * Verify and decode a JWT token
 * Returns the payload if valid, null if invalid or expired
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, SIGNING_SECRET) as JWTPayload;
    return decoded;
  } catch (error) {
    return null;
  }
}

/**
 * Verify a token's signature, optionally ignoring expiration
 * This is used for token refresh to allow refreshing recently-expired tokens
 * SECURITY: Always verifies signature, only optionally ignores expiration
 */
export function verifyTokenIgnoreExpiration(token: string): { payload: JWTPayload | null; isExpired: boolean } {
  try {
    // First try normal verification
    const decoded = jwt.verify(token, SIGNING_SECRET) as JWTPayload;
    return { payload: decoded, isExpired: false };
  } catch (error: any) {
    // If token is expired but signature is valid, we can still use it for refresh
    if (error.name === 'TokenExpiredError') {
      try {
        // Verify with ignoreExpiration - STILL VERIFIES SIGNATURE
        const decoded = jwt.verify(token, SIGNING_SECRET, { ignoreExpiration: true }) as JWTPayload;
        return { payload: decoded, isExpired: true };
      } catch (innerError) {
        // Signature verification failed
        return { payload: null, isExpired: false };
      }
    }
    // Other errors (invalid signature, malformed token, etc.)
    return { payload: null, isExpired: false };
  }
}

/**
 * Check if an expired token is within the refresh grace period
 */
export function isWithinRefreshGracePeriod(payload: JWTPayload): boolean {
  const now = Math.floor(Date.now() / 1000);
  const expiredDuration = now - payload.exp;
  return expiredDuration <= REFRESH_GRACE_PERIOD;
}

/**
 * Decode a token without verification (for debugging only)
 * SECURITY WARNING: Never use this for authentication decisions
 */
export function decodeToken(token: string): JWTPayload | null {
  try {
    return jwt.decode(token) as JWTPayload;
  } catch (error) {
    return null;
  }
}

/**
 * Check if a token is close to expiring (within 7 days)
 * Used to proactively suggest token refresh
 */
export function shouldRefreshToken(payload: JWTPayload): boolean {
  const sevenDaysInSeconds = 7 * 24 * 60 * 60;
  const now = Math.floor(Date.now() / 1000);
  return (payload.exp - now) < sevenDaysInSeconds;
}

/**
 * Refresh a token - generates a new token with the same user data
 */
export function refreshToken(payload: JWTPayload): string {
  return generateToken({
    id: payload.sub,
    email: payload.email,
    username: payload.username,
  });
}

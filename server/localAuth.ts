import type { Express } from "express";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { storage } from "./storage";
import { comparePassword } from "./password-utils";

/**
 * Setup passport-local authentication strategy
 * This enables username/password authentication alongside Replit Auth
 */
export function setupLocalAuth(app: Express) {
  // Configure local strategy
  passport.use(
    new LocalStrategy(
      {
        usernameField: 'username',
        passwordField: 'password',
      },
      async (username, password, done) => {
        try {
          // Look up auth credential by username (providerUserId)
          const authCred = await storage.getAuthCredentialByProvider('local', username);
          
          if (!authCred) {
            return done(null, false, { message: 'Invalid username or password' });
          }
          
          // Verify password
          if (!authCred.passwordHash) {
            return done(null, false, { message: 'Invalid authentication method' });
          }
          
          const passwordMatch = await comparePassword(password, authCred.passwordHash);
          
          if (!passwordMatch) {
            return done(null, false, { message: 'Invalid username or password' });
          }
          
          // Load the full user record
          const user = await storage.getUser(authCred.userId);
          
          if (!user) {
            return done(null, false, { message: 'User not found' });
          }
          
          // Success! Create a session object similar to Replit Auth
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
          
          return done(null, sessionUser);
        } catch (error) {
          console.error('Local auth error:', error);
          return done(error);
        }
      }
    )
  );
  
  console.log('✅ Local authentication strategy configured');
}

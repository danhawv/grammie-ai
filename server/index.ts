import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { jobQueue } from "./job-queue";
import { storage } from "./storage";
import { groceryListWsManager } from "./websocket";
import { runMigrations } from "./migrations";

// ============================================================================
// Environment validation
// ============================================================================
const REQUIRED_ENV: Record<string, string[]> = {
  always: ['DATABASE_URL'],
  production: ['SESSION_SECRET'],
};

function validateEnv() {
  const missing: string[] = [];
  const env = process.env.NODE_ENV || 'development';

  for (const key of REQUIRED_ENV.always) {
    if (!process.env[key]) missing.push(key);
  }
  if (env === 'production') {
    for (const key of REQUIRED_ENV.production) {
      if (!process.env[key]) missing.push(key);
    }
  }
  if (missing.length > 0) {
    console.error(`[Startup] Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  // Warnings for optional but recommended vars
  if (!process.env.GEMINI_API_KEY && !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    log('Warning: No AI provider configured (GEMINI_API_KEY or AI_INTEGRATIONS_OPENAI_API_KEY). AI features will use mock data.');
  }
  if (!process.env.CLERK_SECRET_KEY) {
    log('Warning: CLERK_SECRET_KEY not set. Clerk authentication disabled.');
  }
}

validateEnv();

// ============================================================================
// Express app setup
// ============================================================================
const app = express();

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}

// JSON body with 10MB limit and raw body capture
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));
app.use(compression());

// CORS for production
if (process.env.NODE_ENV === 'production' && process.env.PUBLIC_URL) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowed = process.env.PUBLIC_URL!;
    if (origin && (origin === allowed || origin.endsWith('.railway.app'))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
}

// Health check endpoint (before auth middleware)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Run startup migrations (GIN indexes, etc.) before registering routes
  await runMigrations();

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error(`[Error] ${status}: ${message}`, err.stack || '');
    if (!res.headersSent) {
      res.status(status).json({ message });
    }
  });

  // Initialize WebSocket server for real-time grocery list updates BEFORE Vite
  // This prevents conflicts with Vite's HMR WebSocket upgrade handlers
  groceryListWsManager.initialize(server);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);

    // Start periodic watchdog for stuck jobs (every 5 minutes)
    jobQueue.startStuckJobWatchdog();

    // Defer job recovery with retries to handle intermittent neon driver issues
    const attemptRecovery = async (attempt: number, maxAttempts: number) => {
      try {
        const response = await fetch(`http://localhost:${port}/api/admin/recover-jobs`, {
          method: 'POST',
          headers: { 'x-internal-recovery': 'true' }
        });
        const result = await response.json() as any;
        const hasErrors = result.extractionError || result.enrichmentError || result.imageError;
        if (hasErrors && attempt < maxAttempts) {
          log(`Job recovery attempt ${attempt}/${maxAttempts} had errors, retrying in ${attempt * 3}s...`);
          setTimeout(() => attemptRecovery(attempt + 1, maxAttempts), attempt * 3000);
        } else {
          log(`Job recovery completed (attempt ${attempt}): ${JSON.stringify(result)}`);
        }
      } catch (error) {
        if (attempt < maxAttempts) {
          log(`Job recovery attempt ${attempt} failed, retrying in ${attempt * 3}s...`);
          setTimeout(() => attemptRecovery(attempt + 1, maxAttempts), attempt * 3000);
        } else {
          log(`Error triggering job recovery after ${maxAttempts} attempts: ${error}`);
        }
      }
    };
    setTimeout(() => attemptRecovery(1, 5), 8000);
  });

  // ============================================================================
  // Graceful shutdown for Railway / production
  // ============================================================================
  const shutdown = (signal: string) => {
    log(`${signal} received. Shutting down gracefully...`);
    server.close(() => {
      log('HTTP server closed.');
      process.exit(0);
    });
    // Force exit after 10s if connections don't close
    setTimeout(() => {
      console.error('Forced shutdown after timeout.');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
})();

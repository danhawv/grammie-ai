import multer from "multer";
import crypto from "node:crypto";

// Shared multer upload instance with file size limits
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB max file size
    files: 10, // max 10 files per request
  },
});

// Temporary PDF storage for Lulu print orders (in-memory with expiration)
export interface StoredPdf {
  buffer: Buffer;
  filename: string;
  createdAt: number;
  expiresAt: number;
}

export const pdfCache = new Map<string, StoredPdf>();
const PDF_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// Cleanup expired PDFs every hour
setInterval(() => {
  const now = Date.now();
  for (const [key, pdf] of Array.from(pdfCache.entries())) {
    if (now > pdf.expiresAt) {
      pdfCache.delete(key);
      console.log(`[PDF Cache] Expired and removed: ${key}`);
    }
  }
}, 60 * 60 * 1000);

export function storePdf(buffer: Buffer, filename: string): string {
  const id = crypto.randomUUID();
  const now = Date.now();
  pdfCache.set(id, {
    buffer,
    filename,
    createdAt: now,
    expiresAt: now + PDF_EXPIRY_MS,
  });
  console.log(`[PDF Cache] Stored PDF: ${id} (${filename})`);
  return id;
}

export function getPdf(id: string): StoredPdf | undefined {
  const pdf = pdfCache.get(id);
  if (pdf && Date.now() > pdf.expiresAt) {
    pdfCache.delete(id);
    return undefined;
  }
  return pdf;
}

// Helper to get user ID from request
export function getUserId(req: any): string | undefined {
  return req.user?.claims?.sub;
}

// Import Gemini pantry scan for unified AI provider support
import { scanPantryWithGemini } from "../gemini";
import { storage } from "../storage";

// Process pantry scan with AI Vision (runs asynchronously) - Uses Gemini
export async function processPantryScan(sessionId: string, imageBase64: string) {
  try {
    console.log(`[Pantry Scan] Starting scan for session ${sessionId} using GEMINI`);

    const items = await scanPantryWithGemini(imageBase64);

    console.log(`[Pantry Scan] Found ${items.length} items in session ${sessionId}`);

    // Update session with extracted items
    await storage.updatePantryScanSession(sessionId, {
      status: 'ready',
      extractedItems: items,
      completedAt: new Date(),
    });
  } catch (error) {
    console.error(`[Pantry Scan] Error in session ${sessionId}:`, error);

    await storage.updatePantryScanSession(sessionId, {
      status: 'failed',
      errorMessage: (error as Error).message || 'Unknown error',
      completedAt: new Date(),
    });
  }
}

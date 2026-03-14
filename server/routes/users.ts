import { Router } from "express";
import { z } from "zod";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getUserId } from "./route-utils";

const router = Router();

// Get public user profile by ID (no auth required)
router.get("/users/:userId/profile", async (req: any, res) => {
  try {
    const { userId } = req.params;
    const user = await storage.getUser(userId);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Return only public profile information
    res.json({
      id: user.id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      bio: user.bio,
      avatar: user.profileImageUrl,
      createdAt: user.createdAt,
    });
  } catch (error) {
    console.error("Error fetching public profile:", error);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// ============================================================================
// USER PREFERENCES ROUTES
// ============================================================================

// Get user preferences
router.get("/user/preferences", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Return preferences with defaults if not set
    const preferences = user.preferences || {
      quickFilters: {
        enabled: ['all', 'yours', 'public', 'shared', 'under-30-mins', 'high-protein'],
        order: ['all', 'yours', 'public', 'shared', 'under-30-mins', 'high-protein'],
      },
    };

    res.json(preferences);
  } catch (error) {
    console.error("Error fetching preferences:", error);
    res.status(500).json({ message: "Failed to fetch preferences" });
  }
});

// Update user preferences
router.put("/user/preferences", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Validate preferences structure
    const preferencesSchema = z.object({
      quickFilters: z.object({
        enabled: z.array(z.string()).optional(),
        order: z.array(z.string()).optional(),
        showQuickFilters: z.boolean().optional(),
      }).optional(),
    });

    const validated = preferencesSchema.parse(req.body);

    // Update user preferences in database
    const [updatedUser] = await db
      .update(users)
      .set({ preferences: validated, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(updatedUser.preferences);
  } catch (error) {
    console.error("Error updating preferences:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid preferences format", errors: error.errors });
    }
    res.status(500).json({ message: "Failed to update preferences" });
  }
});

// Update user's unit system preference
router.patch("/user/preferences/unit-system", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const schema = z.object({
      unitSystem: z.enum(['metric', 'us']),
    });

    const { unitSystem } = schema.parse(req.body);

    await storage.updateUserUnitSystemPreference(userId, unitSystem);
    res.json({ message: "Unit system preference updated", unitSystem });
  } catch (error) {
    console.error("Error updating unit system preference:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request data", details: error.errors });
    }
    res.status(500).json({ error: "Failed to update preference" });
  }
});

// Search for users to invite
router.get("/users/search", isAuthenticated, async (req: any, res) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: "Search query required" });
    }

    const user = await storage.findUserByEmailOrUsername(q);

    if (user) {
      // Return limited info for privacy
      res.json({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
      });
    } else {
      res.json(null);
    }
  } catch (error) {
    console.error("Error searching users:", error);
    res.status(500).json({ error: "Failed to search users" });
  }
});

// Get user's pending invitations
router.get("/user/invitations", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const invitations = await storage.getUserPendingInvitations(userId);
    res.json(invitations);
  } catch (error) {
    console.error("Error fetching user invitations:", error);
    res.status(500).json({ error: "Failed to fetch invitations" });
  }
});

// Accept or reject an invitation
router.post("/invitations/:invitationId/respond", isAuthenticated, async (req: any, res) => {
  try {
    const { invitationId } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { accept } = req.body;

    if (typeof accept !== 'boolean') {
      return res.status(400).json({ error: "accept must be a boolean" });
    }

    const success = await storage.respondToInvitation(Number(invitationId), userId, accept);

    if (!success) {
      return res.status(400).json({ error: "Unable to respond to invitation. It may have expired or already been responded to." });
    }

    res.json({ message: accept ? "Invitation accepted" : "Invitation declined" });
  } catch (error) {
    console.error("Error responding to invitation:", error);
    res.status(500).json({ error: "Failed to respond to invitation" });
  }
});

// Get invitation by token (for shareable links)
router.get("/invitations/token/:token", async (req: any, res) => {
  try {
    const { token } = req.params;

    const invitation = await storage.getCookbookInvitationByToken(token);

    if (!invitation) {
      return res.status(404).json({ error: "Invitation not found" });
    }

    // Don't expose sensitive data to unauthenticated users
    res.json({
      id: invitation.id,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      cookbook: invitation.cookbook,
      inviter: invitation.inviter,
    });
  } catch (error) {
    console.error("Error fetching invitation by token:", error);
    res.status(500).json({ error: "Failed to fetch invitation" });
  }
});

// Accept invitation by token (for shareable links)
router.post("/invitations/token/:token/accept", isAuthenticated, async (req: any, res) => {
  try {
    const { token } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const invitation = await storage.getCookbookInvitationByToken(token);

    if (!invitation) {
      return res.status(404).json({ error: "Invitation not found" });
    }

    if (invitation.status !== 'pending') {
      return res.status(400).json({ error: "This invitation has already been used or expired" });
    }

    if (new Date() > invitation.expiresAt) {
      return res.status(400).json({ error: "This invitation has expired" });
    }

    const success = await storage.respondToInvitation(invitation.id, userId, true);

    if (!success) {
      return res.status(400).json({ error: "Unable to accept invitation" });
    }

    res.json({
      message: "Invitation accepted",
      cookbookId: invitation.cookbookId,
      cookbookName: invitation.cookbook.name,
    });
  } catch (error) {
    console.error("Error accepting invitation by token:", error);
    res.status(500).json({ error: "Failed to accept invitation" });
  }
});

export default router;

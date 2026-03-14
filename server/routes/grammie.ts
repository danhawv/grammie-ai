import { Router } from "express";
import { getUserId } from "./route-utils";

const router = Router();

// Dynamically import grammie module
const grammieImport = import("../grammie");

// Chat with Grammie - returns structured response with recipe links
router.post("/grammie/chat", async (req: any, res) => {
  try {
    const { chatWithGrammie } = await grammieImport;
    const { message, contextRecipeIds } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: "Message is required" });
    }

    const userId = getUserId(req);
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const response = await chatWithGrammie(message, userId, baseUrl, contextRecipeIds);
    res.json(response);
  } catch (error) {
    console.error("Grammie chat error:", error);
    res.status(500).json({ error: "Failed to process request" });
  }
});

// Simple text response for SMS/Twilio integration
router.post("/grammie/sms", async (req: any, res) => {
  try {
    const { chatWithGrammieSimple } = await grammieImport;
    const { message, userId } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: "Message is required" });
    }

    // For external API, use a configurable base URL
    const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

    const textResponse = await chatWithGrammieSimple(message, userId, baseUrl);

    // Return plain text for easy SMS integration
    res.type('text/plain').send(textResponse);
  } catch (error) {
    console.error("Grammie SMS error:", error);
    res.status(500).send("Sorry dear, I'm having trouble right now. Try again in a moment!");
  }
});

export default router;

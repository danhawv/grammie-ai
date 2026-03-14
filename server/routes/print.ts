import { Router } from "express";
import { isAuthenticated } from "../clerkAuth";
import { getPdf } from "./route-utils";
import {
  luluApi,
  LULU_POD_PACKAGES,
  SHIPPING_OPTIONS,
  type LuluPriceRequest,
  type PageSizeKey,
  type ColorOption,
} from "../lulu-api";

const router = Router();

// Serve generated PDFs (public - no auth required)
router.get("/lulu/pdfs/:id", async (req: any, res) => {
  try {
    const { id } = req.params;
    const pdf = getPdf(id);

    if (!pdf) {
      return res.status(404).json({ error: "PDF not found or expired" });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${pdf.filename}"`);
    res.setHeader('Content-Length', pdf.buffer.length);
    res.send(pdf.buffer);
  } catch (error) {
    console.error("Error serving PDF:", error);
    res.status(500).json({ error: "Failed to serve PDF" });
  }
});

// Check if Lulu API is configured
router.get("/api/print/lulu/status", isAuthenticated, async (req: any, res) => {
  res.json({
    configured: luluApi.isConfigured,
    shippingOptions: SHIPPING_OPTIONS,
    pageSizes: Object.keys(LULU_POD_PACKAGES),
  });
});

// Calculate print job pricing
router.post("/api/print/lulu/calculate-price", isAuthenticated, async (req: any, res) => {
  try {
    if (!luluApi.isConfigured) {
      return res.status(503).json({
        error: "Lulu Print API not configured",
        message: "Please set LULU_API_KEY and LULU_API_SECRET environment variables."
      });
    }

    const { pageCount, pageSize, colorOption, quantity, shippingAddress, shippingLevel } = req.body;

    if (!pageCount || pageCount < 24 || pageCount > 800) {
      return res.status(400).json({ error: "Page count must be between 24 and 800" });
    }
    if (!pageSize || !LULU_POD_PACKAGES[pageSize as PageSizeKey]) {
      return res.status(400).json({ error: "Invalid page size" });
    }
    if (!colorOption || !["color", "bw"].includes(colorOption)) {
      return res.status(400).json({ error: "Invalid color option" });
    }
    if (!quantity || quantity < 1) {
      return res.status(400).json({ error: "Quantity must be at least 1" });
    }
    if (!shippingAddress || !shippingAddress.country_code) {
      return res.status(400).json({ error: "Valid shipping address required" });
    }

    const priceRequest: LuluPriceRequest = {
      pageCount,
      pageSize: pageSize as PageSizeKey,
      colorOption: colorOption as ColorOption,
      quantity,
      shippingAddress,
      shippingLevel: shippingLevel || "GROUND",
    };

    const pricing = await luluApi.calculatePrice(priceRequest);
    res.json(pricing);
  } catch (error: any) {
    console.error("Error calculating price:", error);
    res.status(500).json({ error: error.message || "Failed to calculate price" });
  }
});

// Get print order status
router.get("/api/print/orders/:orderId/status", isAuthenticated, async (req: any, res) => {
  try {
    const { orderId } = req.params;

    if (!luluApi.isConfigured) {
      return res.status(503).json({ error: "Lulu Print API not configured" });
    }

    const status = await luluApi.getOrderStatus(orderId);
    res.json(status);
  } catch (error: any) {
    console.error("Error getting order status:", error);
    res.status(500).json({ error: error.message || "Failed to get order status" });
  }
});

// Cancel a print order
router.post("/api/print/orders/:orderId/cancel", isAuthenticated, async (req: any, res) => {
  try {
    const { orderId } = req.params;

    if (!luluApi.isConfigured) {
      return res.status(503).json({ error: "Lulu Print API not configured" });
    }

    const success = await luluApi.cancelOrder(orderId);
    if (success) {
      res.json({ success: true, message: "Order canceled successfully" });
    } else {
      res.status(400).json({ error: "Order cannot be canceled (may already be in production)" });
    }
  } catch (error: any) {
    console.error("Error canceling order:", error);
    res.status(500).json({ error: error.message || "Failed to cancel order" });
  }
});

export default router;

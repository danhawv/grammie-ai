import { Router } from "express";
import { isAuthenticated } from "../clerkAuth";
import { getPdf } from "./route-utils";
import { calculateCost, getPrintJob } from "../lib/lulu/client";
import { buildPodPackageId, BINDING_PAGE_LIMITS, BINDING_PAPER_COMPATIBILITY } from "../lib/lulu/pod-package";
import { BOOK_SIZES, BINDING_TYPE_INFO, PAPER_TYPE_INFO, COLOR_TYPE_INFO } from "../lib/lulu/book-sizes";
import type { BookConfig, CostCalculationRequest, LuluAddress, ShippingLevel } from "../lib/lulu/types";

const SHIPPING_OPTIONS = [
  { id: "MAIL", name: "Mail", description: "7-21 business days" },
  { id: "GROUND", name: "Ground", description: "5-10 business days" },
  { id: "EXPEDITED", name: "Expedited", description: "3-5 business days" },
  { id: "EXPRESS", name: "Express", description: "1-3 business days" },
] as const;

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

// Check if Lulu API is configured + return available options
router.get("/api/print/lulu/status", isAuthenticated, async (req: any, res) => {
  const configured = Boolean(process.env.LULU_CLIENT_ID && process.env.LULU_CLIENT_SECRET);
  res.json({
    configured,
    shippingOptions: SHIPPING_OPTIONS,
    bookSizes: BOOK_SIZES,
    bindingTypes: BINDING_TYPE_INFO,
    paperTypes: PAPER_TYPE_INFO,
    colorTypes: COLOR_TYPE_INFO,
    compatibility: BINDING_PAPER_COMPATIBILITY,
    pageLimits: BINDING_PAGE_LIMITS,
  });
});

// Calculate print job pricing with dynamic POD package
router.post("/api/print/lulu/calculate-price", isAuthenticated, async (req: any, res) => {
  try {
    if (!process.env.LULU_CLIENT_ID || !process.env.LULU_CLIENT_SECRET) {
      return res.status(503).json({
        error: "Lulu Print API not configured",
        message: "Please set LULU_CLIENT_ID and LULU_CLIENT_SECRET environment variables."
      });
    }

    const {
      pageCount,
      quantity,
      shippingAddress,
      shippingLevel,
      // Full book config for dynamic POD package
      trimSize,
      bindingType,
      colorType,
      paperType,
      coverFinish,
      // Legacy simple fields (backward compat)
      pageSize,
      colorOption,
    } = req.body;

    if (!pageCount || pageCount < 4 || pageCount > 800) {
      return res.status(400).json({ error: "Page count must be between 4 and 800" });
    }
    if (!quantity || quantity < 1) {
      return res.status(400).json({ error: "Quantity must be at least 1" });
    }
    if (!shippingAddress || !shippingAddress.country_code) {
      return res.status(400).json({ error: "Valid shipping address required" });
    }

    // Build POD package ID from full config or legacy fields
    let podPackageId: string;

    if (trimSize && bindingType) {
      const bookConfig: BookConfig = {
        trimSize: trimSize || '0600X0900',
        colorType: colorType || 'FC',
        printQuality: 'STD',
        bindingType: bindingType || 'PB',
        paperType: paperType || '080CW444',
        coverFinish: coverFinish || 'M',
        linenColor: 'X',
        foilType: 'X',
      };

      // Validate page limits for binding type
      const limits = BINDING_PAGE_LIMITS[bookConfig.bindingType];
      if (limits && (pageCount < limits.min || pageCount > limits.max)) {
        return res.status(400).json({
          error: `Page count must be between ${limits.min} and ${limits.max} for ${BINDING_TYPE_INFO[bookConfig.bindingType as keyof typeof BINDING_TYPE_INFO]?.name || bookConfig.bindingType} binding`
        });
      }

      podPackageId = buildPodPackageId(bookConfig);
    } else {
      // Legacy: simple pageSize + colorOption
      const sizeMap: Record<string, string> = {
        '6x9': '0600X0900',
        '8.5x11': '0850X1100',
        'a4': '0827X1169',
      };
      const ts = sizeMap[pageSize || '6x9'] || '0600X0900';
      const ct = colorOption === 'bw' ? 'BW' : 'FC';
      podPackageId = `${ts}${ct}STDPB060UW444MXX`;
    }

    const costRequest: CostCalculationRequest = {
      line_items: [{ pod_package_id: podPackageId, page_count: pageCount, quantity }],
      shipping_address: shippingAddress as LuluAddress,
      shipping_level: (shippingLevel || 'GROUND') as ShippingLevel,
    };

    const result = await calculateCost(costRequest);

    res.json({
      podPackageId,
      totalCost: parseFloat(result.total_cost_incl_tax),
      printCost: parseFloat(result.total_cost_incl_tax) - parseFloat(result.shipping_cost.total_cost_incl_tax),
      shippingCost: parseFloat(result.shipping_cost.total_cost_incl_tax),
      currency: result.currency,
      details: result,
    });
  } catch (error: any) {
    console.error("Error calculating price:", error);
    res.status(500).json({ error: error.message || "Failed to calculate price" });
  }
});

// Get print order status
router.get("/api/print/orders/:orderId/status", isAuthenticated, async (req: any, res) => {
  try {
    const { orderId } = req.params;

    if (!process.env.LULU_CLIENT_ID || !process.env.LULU_CLIENT_SECRET) {
      return res.status(503).json({ error: "Lulu Print API not configured" });
    }

    const job = await getPrintJob(parseInt(orderId));
    res.json({
      orderId: job.id,
      status: job.status.name,
      statusMessages: job.status.messages,
      lineItems: job.line_items,
      costs: job.costs,
      estimatedShipping: job.estimated_shipping_dates,
    });
  } catch (error: any) {
    console.error("Error getting order status:", error);
    res.status(500).json({ error: error.message || "Failed to get order status" });
  }
});

export default router;

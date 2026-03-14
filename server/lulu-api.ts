/**
 * Lulu Print API Client
 * Handles authentication, pricing, order creation, and status tracking
 */

const LULU_API_BASE = "https://api.lulu.com";
const LULU_SANDBOX_BASE = "https://api.sandbox.lulu.com";
const LULU_AUTH_URL = "https://api.lulu.com/auth/realms/glasstree/protocol/openid-connect/token";
const LULU_SANDBOX_AUTH_URL = "https://api.sandbox.lulu.com/auth/realms/glasstree/protocol/openid-connect/token";

// POD Package IDs map page size to Lulu product codes
// Format: TRIMxTRIM + BINDING + PAPER + COVER
// e.g., 0600X0900BWSTDPB060UW444MXX = 6x9 B&W Standard Paperback 60# White
export const LULU_POD_PACKAGES = {
  // 6x9 Standard Paperback (common for cookbooks)
  "6x9": {
    color: "0600X0900FCSTDPB060UW444MXX", // Full color, standard paperback
    bw: "0600X0900BWSTDPB060UW444MXX",    // B&W, standard paperback
  },
  // 8.5x11 Letter Size
  "8.5x11": {
    color: "0850X1100FCSTDPB060UW444MXX", // Full color, standard paperback
    bw: "0850X1100BWSTDPB060UW444MXX",    // B&W, standard paperback
  },
  // A4 International
  "a4": {
    color: "0827X1169FCSTDPB060UW444MXX", // Full color, standard paperback (A4 = 8.27x11.69)
    bw: "0827X1169BWSTDPB060UW444MXX",    // B&W, standard paperback
  },
} as const;

export type PageSizeKey = keyof typeof LULU_POD_PACKAGES;
export type ColorOption = "color" | "bw";

// Shipping levels
export const SHIPPING_OPTIONS = [
  { id: "MAIL", name: "Mail", description: "7-21 business days" },
  { id: "GROUND", name: "Ground", description: "5-10 business days" },
  { id: "EXPEDITED", name: "Expedited", description: "3-5 business days" },
  { id: "EXPRESS", name: "Express", description: "1-3 business days" },
] as const;

export type ShippingLevel = typeof SHIPPING_OPTIONS[number]["id"];

// Order status mapping
export const ORDER_STATUSES = {
  CREATED: { label: "Created", color: "gray" },
  UNPAID: { label: "Unpaid", color: "yellow" },
  PAYMENT_IN_PROGRESS: { label: "Processing Payment", color: "yellow" },
  PRODUCTION_DELAYED: { label: "Production Delayed", color: "orange" },
  PRODUCTION_READY: { label: "Production Ready", color: "blue" },
  IN_PRODUCTION: { label: "In Production", color: "blue" },
  SHIPPED: { label: "Shipped", color: "green" },
  REJECTED: { label: "Rejected", color: "red" },
  CANCELED: { label: "Canceled", color: "gray" },
} as const;

export interface ShippingAddress {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state_code?: string;
  country_code: string;
  postcode: string;
  phone_number: string;
  email?: string;
}

export interface LuluPriceRequest {
  pageCount: number;
  pageSize: PageSizeKey;
  colorOption: ColorOption;
  quantity: number;
  shippingAddress: ShippingAddress;
  shippingLevel: ShippingLevel;
}

export interface LuluPriceResponse {
  totalCost: number;
  printCost: number;
  shippingCost: number;
  currency: string;
  estimatedDeliveryDays: { min: number; max: number };
}

export interface LuluOrderRequest {
  externalId: string;
  title: string;
  coverUrl: string;
  interiorUrl: string;
  pageCount: number;
  pageSize: PageSizeKey;
  colorOption: ColorOption;
  quantity: number;
  shippingAddress: ShippingAddress;
  shippingLevel: ShippingLevel;
}

export interface LuluOrderResponse {
  orderId: string;
  status: string;
  createdAt: string;
  lineItems: Array<{
    id: string;
    title: string;
    quantity: number;
  }>;
}

export interface LuluOrderStatus {
  orderId: string;
  status: keyof typeof ORDER_STATUSES;
  statusMessage?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  estimatedShipDate?: string;
}

class LuluApiClient {
  private clientKey: string | undefined;
  private clientSecret: string | undefined;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private useSandbox: boolean;

  constructor() {
    this.clientKey = process.env.LULU_API_KEY;
    this.clientSecret = process.env.LULU_API_SECRET;
    this.useSandbox = process.env.LULU_SANDBOX === "true";
  }

  get isConfigured(): boolean {
    return Boolean(this.clientKey && this.clientSecret);
  }

  private get baseUrl(): string {
    return this.useSandbox ? LULU_SANDBOX_BASE : LULU_API_BASE;
  }

  private get authUrl(): string {
    return this.useSandbox ? LULU_SANDBOX_AUTH_URL : LULU_AUTH_URL;
  }

  private async getAccessToken(): Promise<string> {
    if (!this.isConfigured) {
      throw new Error("Lulu API not configured. Please set LULU_API_KEY and LULU_API_SECRET environment variables.");
    }

    // Return cached token if still valid
    if (this.accessToken && Date.now() < this.tokenExpiry - 60000) {
      return this.accessToken;
    }

    // Request new token via OAuth2 client credentials
    const credentials = Buffer.from(`${this.clientKey}:${this.clientSecret}`).toString("base64");
    
    const response = await fetch(this.authUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${credentials}`,
      },
      body: "grant_type=client_credentials",
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Lulu authentication failed: ${error}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000);
    
    return this.accessToken!;
  }

  private async apiRequest<T>(
    endpoint: string,
    method: "GET" | "POST" | "PATCH" = "GET",
    body?: object
  ): Promise<T> {
    const token = await this.getAccessToken();
    
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Lulu API error (${response.status}): ${error}`);
    }

    return response.json();
  }

  /**
   * Calculate print job costs
   */
  async calculatePrice(request: LuluPriceRequest): Promise<LuluPriceResponse> {
    const podPackageId = LULU_POD_PACKAGES[request.pageSize][request.colorOption];
    
    const payload = {
      line_items: [
        {
          page_count: request.pageCount,
          pod_package_id: podPackageId,
          quantity: request.quantity,
        },
      ],
      shipping_address: {
        name: request.shippingAddress.name,
        street1: request.shippingAddress.street1,
        street2: request.shippingAddress.street2,
        city: request.shippingAddress.city,
        state_code: request.shippingAddress.state_code,
        country_code: request.shippingAddress.country_code,
        postcode: request.shippingAddress.postcode,
        phone_number: request.shippingAddress.phone_number,
      },
      shipping_option: request.shippingLevel,
    };

    const result = await this.apiRequest<any>("/print-job-cost-calculations/", "POST", payload);
    
    // Parse the response
    const totalCost = parseFloat(result.total_cost_incl_tax || result.total_cost || "0");
    const shippingCost = parseFloat(result.shipping_cost?.total_cost_incl_tax || result.shipping_cost || "0");
    const printCost = totalCost - shippingCost;
    
    return {
      totalCost,
      printCost,
      shippingCost,
      currency: result.currency || "USD",
      estimatedDeliveryDays: this.getDeliveryEstimate(request.shippingLevel),
    };
  }

  /**
   * Create a print job order
   */
  async createOrder(request: LuluOrderRequest): Promise<LuluOrderResponse> {
    const podPackageId = LULU_POD_PACKAGES[request.pageSize][request.colorOption];
    
    const payload = {
      external_id: request.externalId,
      line_items: [
        {
          external_id: `${request.externalId}-item-1`,
          title: request.title,
          cover: {
            source_url: request.coverUrl,
          },
          interior: {
            source_url: request.interiorUrl,
          },
          pod_package_id: podPackageId,
          quantity: request.quantity,
        },
      ],
      shipping_address: {
        name: request.shippingAddress.name,
        street1: request.shippingAddress.street1,
        street2: request.shippingAddress.street2,
        city: request.shippingAddress.city,
        state_code: request.shippingAddress.state_code,
        country_code: request.shippingAddress.country_code,
        postcode: request.shippingAddress.postcode,
        phone_number: request.shippingAddress.phone_number,
        email: request.shippingAddress.email,
      },
      shipping_level: request.shippingLevel,
    };

    const result = await this.apiRequest<any>("/print-jobs/", "POST", payload);
    
    return {
      orderId: result.id,
      status: result.status?.name || "CREATED",
      createdAt: result.created,
      lineItems: result.line_items?.map((item: any) => ({
        id: item.id,
        title: item.title,
        quantity: item.quantity,
      })) || [],
    };
  }

  /**
   * Get order status
   */
  async getOrderStatus(orderId: string): Promise<LuluOrderStatus> {
    const result = await this.apiRequest<any>(`/print-jobs/${orderId}/`);
    
    // Extract tracking info if shipped
    let trackingNumber: string | undefined;
    let trackingUrl: string | undefined;
    
    if (result.line_items?.[0]?.tracking_id) {
      trackingNumber = result.line_items[0].tracking_id;
      trackingUrl = result.line_items[0].tracking_urls?.[0];
    }
    
    return {
      orderId: result.id,
      status: result.status?.name || "CREATED",
      statusMessage: result.status?.message,
      trackingNumber,
      trackingUrl,
      estimatedShipDate: result.estimated_shipping_date,
    };
  }

  /**
   * Cancel an order (only if not yet in production)
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      await this.apiRequest(`/print-jobs/${orderId}/`, "PATCH", {
        status: { name: "CANCELED" },
      });
      return true;
    } catch (error) {
      console.error("Failed to cancel order:", error);
      return false;
    }
  }

  private getDeliveryEstimate(shippingLevel: ShippingLevel): { min: number; max: number } {
    switch (shippingLevel) {
      case "MAIL":
        return { min: 7, max: 21 };
      case "GROUND":
        return { min: 5, max: 10 };
      case "EXPEDITED":
        return { min: 3, max: 5 };
      case "EXPRESS":
        return { min: 1, max: 3 };
      default:
        return { min: 5, max: 10 };
    }
  }
}

// Singleton instance
export const luluApi = new LuluApiClient();

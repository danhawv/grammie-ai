import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  Truck,
  DollarSign,
  Package,
  Loader2,
  Printer,
  ExternalLink,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { PrintLayoutData } from "@shared/schema";

interface PrintOrderPanelProps {
  cookbookId: number;
  layoutData: PrintLayoutData;
  estimatedPageCount: number;
  pageSize: string;
}

interface ShippingAddress {
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

interface PriceResponse {
  totalCost: number;
  printCost: number;
  shippingCost: number;
  currency: string;
  estimatedDeliveryDays: { min: number; max: number };
}

interface LuluStatus {
  configured: boolean;
  shippingOptions: Array<{ id: string; name: string; description: string }>;
  pageSizes: string[];
}

const SHIPPING_OPTIONS = [
  { id: "MAIL", name: "Mail", description: "7-21 business days" },
  { id: "GROUND", name: "Ground", description: "5-10 business days" },
  { id: "EXPEDITED", name: "Expedited", description: "3-5 business days" },
  { id: "EXPRESS", name: "Express", description: "1-3 business days" },
];

const COUNTRY_CODES = [
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "GB", name: "United Kingdom" },
  { code: "AU", name: "Australia" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "IT", name: "Italy" },
  { code: "ES", name: "Spain" },
];

export function PrintOrderPanel({
  cookbookId,
  layoutData,
  estimatedPageCount,
  pageSize,
}: PrintOrderPanelProps) {
  const { toast } = useToast();
  const [showOrderDialog, setShowOrderDialog] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [colorOption, setColorOption] = useState<"color" | "bw">("color");
  const [shippingLevel, setShippingLevel] = useState("GROUND");
  const [address, setAddress] = useState<ShippingAddress>({
    name: "",
    street1: "",
    street2: "",
    city: "",
    state_code: "",
    country_code: "US",
    postcode: "",
    phone_number: "",
    email: "",
  });
  const [pricing, setPricing] = useState<PriceResponse | null>(null);

  const { data: luluStatus } = useQuery<LuluStatus>({
    queryKey: ["/api/print/lulu/status"],
    staleTime: 60000,
  });

  const priceMutation = useMutation({
    mutationFn: async () => {
      const pageCount = Math.max(24, estimatedPageCount);
      const response = await apiRequest("POST", "/api/print/lulu/calculate-price", {
        pageCount,
        pageSize,
        colorOption,
        quantity,
        shippingAddress: address,
        shippingLevel,
      });
      return response.json();
    },
    onSuccess: (data: PriceResponse) => {
      setPricing(data);
    },
    onError: (error: Error) => {
      toast({
        title: "Error calculating price",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const orderMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/cookbooks/${cookbookId}/print-order`, {
        layoutData,
        templateStyle: 'classic',
        pageSize,
        colorOption,
        quantity,
        shippingAddress: address,
        shippingLevel,
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Order submitted",
        description: `Your print order has been submitted. Order ID: ${data.orderId}`,
      });
      setShowOrderDialog(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Order failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const isAddressValid = address.name && address.street1 && address.city && 
    address.country_code && address.postcode && address.phone_number;

  const handleCalculatePrice = () => {
    if (!isAddressValid) {
      toast({
        title: "Address required",
        description: "Please fill in all required address fields.",
        variant: "destructive",
      });
      return;
    }
    priceMutation.mutate();
  };

  if (!luluStatus?.configured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Printer className="h-5 w-5" />
            Order Prints
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-md">
            <AlertCircle className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Print API Not Configured</p>
              <p className="text-xs text-muted-foreground">
                To order printed copies of your cookbook, configure your Lulu Print API credentials 
                (LULU_API_KEY and LULU_API_SECRET).
              </p>
              <a
                href="https://developers.lulu.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary flex items-center gap-1 mt-2 hover:underline"
              >
                Get API keys <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Printer className="h-5 w-5" />
          Order Prints
        </CardTitle>
        <CardDescription>
          Order professional printed copies of your cookbook
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Print Type</Label>
            <Select value={colorOption} onValueChange={(v) => setColorOption(v as "color" | "bw")}>
              <SelectTrigger data-testid="select-color-option">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="color">Full Color</SelectItem>
                <SelectItem value="bw">Black & White</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Quantity</Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
              data-testid="input-quantity"
            />
          </div>
        </div>

        <div className="text-sm text-muted-foreground p-3 bg-muted/50 rounded-md">
          <div className="flex justify-between">
            <span>Est. Pages:</span>
            <span className="font-medium">{Math.max(24, estimatedPageCount)}</span>
          </div>
          <div className="flex justify-between">
            <span>Page Size:</span>
            <span className="font-medium">{pageSize}</span>
          </div>
        </div>

        <Dialog open={showOrderDialog} onOpenChange={setShowOrderDialog}>
          <DialogTrigger asChild>
            <Button className="w-full" data-testid="button-order-prints">
              <Package className="h-4 w-4 mr-2" />
              Get Price Quote
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Order Printed Cookbook</DialogTitle>
              <DialogDescription>
                Enter your shipping details to get a price quote
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
              <div className="space-y-3">
                <h4 className="font-medium text-sm">Shipping Address</h4>
                
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-xs">Full Name *</Label>
                  <Input
                    id="name"
                    value={address.name}
                    onChange={(e) => setAddress({ ...address, name: e.target.value })}
                    placeholder="John Doe"
                    data-testid="input-shipping-name"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="street1" className="text-xs">Street Address *</Label>
                  <Input
                    id="street1"
                    value={address.street1}
                    onChange={(e) => setAddress({ ...address, street1: e.target.value })}
                    placeholder="123 Main Street"
                    data-testid="input-shipping-street1"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="street2" className="text-xs">Apt/Suite (optional)</Label>
                  <Input
                    id="street2"
                    value={address.street2}
                    onChange={(e) => setAddress({ ...address, street2: e.target.value })}
                    placeholder="Apt 4B"
                    data-testid="input-shipping-street2"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="city" className="text-xs">City *</Label>
                    <Input
                      id="city"
                      value={address.city}
                      onChange={(e) => setAddress({ ...address, city: e.target.value })}
                      placeholder="New York"
                      data-testid="input-shipping-city"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="state" className="text-xs">State/Province</Label>
                    <Input
                      id="state"
                      value={address.state_code}
                      onChange={(e) => setAddress({ ...address, state_code: e.target.value })}
                      placeholder="NY"
                      data-testid="input-shipping-state"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="postcode" className="text-xs">ZIP/Postal Code *</Label>
                    <Input
                      id="postcode"
                      value={address.postcode}
                      onChange={(e) => setAddress({ ...address, postcode: e.target.value })}
                      placeholder="10001"
                      data-testid="input-shipping-postcode"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="country" className="text-xs">Country *</Label>
                    <Select 
                      value={address.country_code}
                      onValueChange={(v) => setAddress({ ...address, country_code: v })}
                    >
                      <SelectTrigger data-testid="select-shipping-country">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COUNTRY_CODES.map((country) => (
                          <SelectItem key={country.code} value={country.code}>
                            {country.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="phone" className="text-xs">Phone Number *</Label>
                  <Input
                    id="phone"
                    value={address.phone_number}
                    onChange={(e) => setAddress({ ...address, phone_number: e.target.value })}
                    placeholder="+1 555 123 4567"
                    data-testid="input-shipping-phone"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs">Email (optional)</Label>
                  <Input
                    id="email"
                    type="email"
                    value={address.email}
                    onChange={(e) => setAddress({ ...address, email: e.target.value })}
                    placeholder="you@example.com"
                    data-testid="input-shipping-email"
                  />
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <h4 className="font-medium text-sm">Shipping Method</h4>
                <Select value={shippingLevel} onValueChange={setShippingLevel}>
                  <SelectTrigger data-testid="select-shipping-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SHIPPING_OPTIONS.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        <div className="flex flex-col">
                          <span>{option.name}</span>
                          <span className="text-xs text-muted-foreground">{option.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              <div className="space-y-3">
                <h4 className="font-medium text-sm">Order Summary</h4>
                <div className="space-y-2 text-sm p-3 bg-muted/50 rounded-md">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Print Type:</span>
                    <span>{colorOption === "color" ? "Full Color" : "Black & White"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Quantity:</span>
                    <span>{quantity} {quantity === 1 ? "copy" : "copies"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Page Size:</span>
                    <span>{pageSize}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Est. Pages:</span>
                    <span>{Math.max(24, estimatedPageCount)}</span>
                  </div>
                </div>

                {pricing && (
                  <div className="space-y-2 p-3 border-2 border-primary/20 rounded-md bg-primary/5">
                    <div className="flex justify-between text-sm">
                      <span>Print Cost:</span>
                      <span>${pricing.printCost.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Shipping:</span>
                      <span>${pricing.shippingCost.toFixed(2)}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between font-medium">
                      <span>Total:</span>
                      <span className="text-primary">${pricing.totalCost.toFixed(2)} {pricing.currency}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Estimated delivery: {pricing.estimatedDeliveryDays.min}-{pricing.estimatedDeliveryDays.max} business days
                    </div>
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={handleCalculatePrice}
                disabled={priceMutation.isPending || !isAddressValid}
                data-testid="button-calculate-price"
              >
                {priceMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <DollarSign className="h-4 w-4 mr-2" />
                )}
                Calculate Price
              </Button>
              <Button
                onClick={() => orderMutation.mutate()}
                disabled={!pricing || orderMutation.isPending}
                data-testid="button-submit-order"
              >
                {orderMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Truck className="h-4 w-4 mr-2" />
                )}
                Place Order
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <p className="text-xs text-muted-foreground text-center">
          Powered by Lulu Print-on-Demand
        </p>
      </CardContent>
    </Card>
  );
}

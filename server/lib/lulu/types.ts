// Lulu API Types

export type TrimSize =
  | '0425X0687' // Pocket: 4.25 x 6.875 in
  | '0500X0800' // Novella: 5 x 8 in
  | '0550X0850' // Digest: 5.5 x 8.5 in
  | '0600X0900' // US Trade: 6 x 9 in
  | '0614X0921' // Royal: 6.14 x 9.21 in
  | '0700X1000' // Executive: 7 x 10 in
  | '0744X0968' // Crown Quarto: 7.44 x 9.68 in
  | '0750X0750' // Square Small: 7.5 x 7.5 in
  | '0827X1169' // A4: 8.27 x 11.69 in
  | '0850X1100' // US Letter: 8.5 x 11 in
  | '0850X0850'; // Square Large: 8.5 x 8.5 in

export type BindingType = 'PB' | 'CW' | 'LW' | 'CO' | 'SS';
export type ColorType = 'BW' | 'FC';
export type PrintQuality = 'STD' | 'PRE';
export type PaperType = '060UW444' | '060UC444' | '080CW444';
export type CoverFinish = 'M' | 'G';
export type LinenColor = 'N' | 'G' | 'K' | 'R' | 'T' | 'E' | 'X';
export type FoilType = 'G' | 'B' | 'W' | 'S' | 'X';

export type ShippingLevel = 'MAIL' | 'PRIORITY_MAIL' | 'GROUND' | 'EXPEDITED' | 'EXPRESS';

export interface BookConfig {
  trimSize: TrimSize;
  colorType: ColorType;
  printQuality: PrintQuality;
  bindingType: BindingType;
  paperType: PaperType;
  coverFinish: CoverFinish;
  linenColor: LinenColor;
  foilType: FoilType;
}

export interface BookSizeConfig {
  trimSize: TrimSize;
  name: string;
  trimWidthIn: number;
  trimHeightIn: number;
  bleed: number; // 0.125 in
  safetyMargin: number; // 0.5 or 0.75 for hardcover
  gutterMargin: number; // 0.2 in minimum
  pageWidthWithBleed: number;
  pageHeightWithBleed: number;
  contentWidth: number;
  contentHeight: number;
}

export interface LuluAddress {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state_code?: string;
  postcode: string;
  country_code: string;
  phone_number: string;
  email: string;
}

export interface LuluLineItem {
  title: string;
  cover: string; // URL to cover PDF
  interior: string; // URL to interior PDF
  pod_package_id: string;
  quantity: number;
}

export interface LuluPrintJobRequest {
  contact_email: string;
  line_items: LuluLineItem[];
  shipping_address: LuluAddress;
  shipping_level: ShippingLevel;
  external_id?: string;
  production_delay?: number;
}

export type PrintJobStatus =
  | 'CREATED'
  | 'UNPAID'
  | 'PAYMENT_IN_PROGRESS'
  | 'PRODUCTION_DELAYED'
  | 'PRODUCTION_READY'
  | 'IN_PRODUCTION'
  | 'SHIPPED'
  | 'CANCELED'
  | 'REJECTED';

export interface LuluPrintJob {
  id: number;
  external_id?: string;
  order_id?: string;
  status: {
    name: PrintJobStatus;
    messages?: string[];
  };
  line_items: Array<{
    id: number;
    title: string;
    quantity: number;
    pod_package_id: string;
    printable_id: string;
    status: string;
    tracking_id?: string;
    tracking_urls?: string[];
    carrier_name?: string;
  }>;
  costs?: {
    line_item_costs: Array<{
      cost_excl_discounts: string;
      total_cost_excl_tax: string;
      total_cost_incl_tax: string;
      quantity: number;
    }>;
    shipping_cost: {
      total_cost_excl_tax: string;
      total_cost_incl_tax: string;
    };
    total_cost_excl_tax: string;
    total_cost_incl_tax: string;
    currency: string;
  };
  estimated_shipping_dates?: {
    arrival_min: string;
    arrival_max: string;
  };
}

export interface CostCalculationRequest {
  line_items: Array<{
    pod_package_id: string;
    page_count: number;
    quantity: number;
  }>;
  shipping_address: LuluAddress;
  shipping_level: ShippingLevel;
}

export interface CostCalculationResult {
  line_item_costs: Array<{
    cost_excl_discounts: string;
    total_cost_excl_tax: string;
    total_cost_incl_tax: string;
    quantity: number;
  }>;
  shipping_cost: {
    total_cost_excl_tax: string;
    total_cost_incl_tax: string;
  };
  total_cost_excl_tax: string;
  total_cost_incl_tax: string;
  currency: string;
}

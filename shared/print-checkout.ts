// Checkout helpers shared by the order panel and the print routes
// (docs/DESIGN_PRINCIPLES.md §5 and §8): plain-language shipping names,
// arrival date ranges, and field-by-field address checks.

import { normalizeUsState } from "./us-states";

export type ShippingLevelId = "MAIL" | "PRIORITY_MAIL" | "GROUND_HD" | "EXPEDITED" | "EXPRESS";

/**
 * Shipping levels we offer, cheapest first. transitDays is a fallback used
 * only when Lulu doesn't return delivery dates (its /shipping-options/
 * endpoint normally does).
 */
export const SHIPPING_LEVELS: { id: ShippingLevelId; name: string; transitDays: [number, number] }[] = [
  { id: "MAIL", name: "Standard mail", transitDays: [7, 21] },
  { id: "GROUND_HD", name: "Ground", transitDays: [5, 10] },
  { id: "PRIORITY_MAIL", name: "Priority mail", transitDays: [4, 8] },
  { id: "EXPEDITED", name: "2-day", transitDays: [2, 3] },
  { id: "EXPRESS", name: "Overnight", transitDays: [1, 2] },
];

/** Cheapest first: faster shipping is offered with the address */
export const DEFAULT_SHIPPING_LEVEL: ShippingLevelId = "MAIL";

/** Printing usually takes 3–5 business days before the book ships */
export const PRODUCTION_BUSINESS_DAYS: [number, number] = [3, 5];

export function shippingLevelName(id: string): string {
  return SHIPPING_LEVELS.find((l) => l.id === id)?.name ?? id;
}

/**
 * Address used for the "about $X" estimate shown before anyone types an
 * address. Central US, so shipping is close to typical; tax varies by state.
 */
export const ESTIMATE_ADDRESS = {
  name: "Estimate",
  street1: "1 E Main St",
  city: "Columbus",
  state_code: "OH",
  postcode: "43215",
  country_code: "US",
  phone_number: "0000000000",
  email: "",
};

/** ISO date (yyyy-mm-dd) for a Date, in UTC */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Adds business days (skipping Saturday and Sunday) to a date, in UTC */
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

/** Fallback arrival range: production business days, then the level's transit days */
export function estimateArrival(level: string, now: Date = new Date()): { min: string; max: string } {
  const transit = SHIPPING_LEVELS.find((l) => l.id === level)?.transitDays ?? [5, 10];
  return {
    min: toIsoDate(addBusinessDays(now, PRODUCTION_BUSINESS_DAYS[0] + transit[0])),
    max: toIsoDate(addBusinessDays(now, PRODUCTION_BUSINESS_DAYS[1] + transit[1])),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseIso(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

/** "Oct 14–20", "Oct 30 – Nov 3", or "Oct 14" */
export function formatDateRange(minIso: string, maxIso: string): string {
  const a = parseIso(minIso);
  const b = parseIso(maxIso);
  if (!a || !b) return "";
  const left = `${MONTHS[a.m]} ${a.d}`;
  if (a.y === b.y && a.m === b.m && a.d === b.d) return left;
  if (a.y === b.y && a.m === b.m) return `${left}–${b.d}`;
  return `${left} – ${MONTHS[b.m]} ${b.d}`;
}

export interface ShippingAddressInput {
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

export type AddressField = keyof ShippingAddressInput;

/**
 * Checks one address field. Returns a specific, fixable message, or null
 * when it's fine. Used on blur in the form and again before review.
 */
export function validateAddressField(field: AddressField, address: ShippingAddressInput): string | null {
  const v = String(address[field] ?? "").trim();
  const us = address.country_code === "US";
  switch (field) {
    case "name":
      if (!v) return "Enter the name of the person receiving the book.";
      if (v.length < 2) return "Enter a full name, like Jean Miller.";
      return null;
    case "street1":
      if (!v) return "Enter a street address, like 12 Oak Street.";
      if (!/\d/.test(v) && !/^p\.?\s*o\.?\s*box/i.test(v)) return "Add the house or building number, like 12 Oak Street.";
      return null;
    case "city":
      return v ? null : "Enter a city or town.";
    case "state_code":
      if (us) return normalizeUsState(v) ? null : "Choose a state.";
      return null;
    case "postcode":
      if (!v) return us ? "Enter a ZIP code." : "Enter a postal code.";
      if (us && !/^\d{5}(-?\d{4})?$/.test(v)) return "A ZIP code is 5 digits, like 43215.";
      return null;
    case "phone_number": {
      const digits = v.replace(/\D/g, "");
      if (!digits) return "Enter a phone number for the delivery driver.";
      if (us && !(digits.length === 10 || (digits.length === 11 && digits.startsWith("1")))) {
        return "A US phone number has 10 digits, like 614 555 0123.";
      }
      if (digits.length < 7) return "This phone number looks too short.";
      return null;
    }
    case "email":
      if (!v) return null;
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : "Check the email address, like jean@example.com.";
    default:
      return null;
  }
}

const REQUIRED_FIELDS: AddressField[] = ["name", "street1", "city", "state_code", "postcode", "country_code", "phone_number", "email"];

/** Every problem in the address, by field */
export function validateAddress(address: ShippingAddressInput): Partial<Record<AddressField, string>> {
  const errors: Partial<Record<AddressField, string>> = {};
  for (const f of REQUIRED_FIELDS) {
    const msg = validateAddressField(f, address);
    if (msg) errors[f] = msg;
  }
  return errors;
}

/** The order quote total in dollars, rounded up to the next whole dollar for "about $X" */
export function aboutDollars(total: number): number {
  return Math.ceil(total);
}

/** Lulu print job status in plain words */
export function orderStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "CREATED":
    case "UNPAID":
    case "PAYMENT_IN_PROGRESS":
      return "Order received";
    case "PRODUCTION_DELAYED":
    case "PRODUCTION_READY":
      return "Getting ready to print";
    case "IN_PRODUCTION":
      return "Printing";
    case "SHIPPED":
      return "Shipped";
    case "CANCELED":
      return "Canceled";
    case "REJECTED":
      return "Couldn't be printed";
    default:
      return status ? "Order placed" : "";
  }
}

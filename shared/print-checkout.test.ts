import { describe, expect, it } from "vitest";
import {
  addBusinessDays,
  estimateArrival,
  formatDateRange,
  validateAddress,
  validateAddressField,
  toIsoDate,
  ESTIMATE_ADDRESS,
} from "./print-checkout";

const base = {
  name: "Jean Miller",
  street1: "12 Oak Street",
  city: "Columbus",
  state_code: "OH",
  postcode: "43215",
  country_code: "US",
  phone_number: "614 555 0123",
  email: "",
};

describe("addBusinessDays", () => {
  it("skips weekends", () => {
    // Fri Oct 2 2026 + 1 business day = Mon Oct 5
    expect(toIsoDate(addBusinessDays(new Date("2026-10-02T15:00:00Z"), 1))).toBe("2026-10-05");
    // Mon + 5 = next Mon
    expect(toIsoDate(addBusinessDays(new Date("2026-10-05T15:00:00Z"), 5))).toBe("2026-10-12");
  });
});

describe("estimateArrival", () => {
  it("adds production and transit time", () => {
    const r = estimateArrival("GROUND_HD", new Date("2026-10-05T12:00:00Z"));
    // 3+5 = 8 business days, 5+10 = 15 business days
    expect(r).toEqual({ min: "2026-10-15", max: "2026-10-26" });
  });
  it("falls back for unknown levels", () => {
    expect(estimateArrival("NOPE", new Date("2026-10-05T12:00:00Z")).min).toBe("2026-10-15");
  });
});

describe("formatDateRange", () => {
  it("formats same month, cross month and single day", () => {
    expect(formatDateRange("2026-10-14", "2026-10-20")).toBe("Oct 14–20");
    expect(formatDateRange("2026-10-30", "2026-11-03")).toBe("Oct 30 – Nov 3");
    expect(formatDateRange("2026-10-14", "2026-10-14")).toBe("Oct 14");
    expect(formatDateRange("bad", "2026-10-14")).toBe("");
  });
});

describe("validateAddressField", () => {
  it("accepts a good US address", () => {
    expect(validateAddress(base)).toEqual({});
    expect(validateAddress(ESTIMATE_ADDRESS)).not.toHaveProperty("street1");
  });
  it("gives specific messages", () => {
    expect(validateAddressField("postcode", { ...base, postcode: "4321" })).toMatch(/5 digits/);
    expect(validateAddressField("street1", { ...base, street1: "Oak Street" })).toMatch(/house or building number/);
    expect(validateAddressField("phone_number", { ...base, phone_number: "555" })).toMatch(/10 digits/);
    expect(validateAddressField("state_code", { ...base, state_code: "" })).toMatch(/state/);
    expect(validateAddressField("email", { ...base, email: "jean@" })).toMatch(/email/);
    expect(validateAddressField("name", { ...base, name: "" })).toMatch(/name/);
  });
  it("allows PO boxes and ZIP+4, and relaxes rules outside the US", () => {
    expect(validateAddressField("street1", { ...base, street1: "PO Box" })).toBeNull();
    expect(validateAddressField("postcode", { ...base, postcode: "43215-1234" })).toBeNull();
    expect(validateAddressField("postcode", { ...base, country_code: "GB", postcode: "SW1A 1AA" })).toBeNull();
    expect(validateAddressField("state_code", { ...base, country_code: "GB", state_code: "" })).toBeNull();
    expect(validateAddressField("phone_number", { ...base, country_code: "GB", phone_number: "020 7946 0018" })).toBeNull();
  });
});

import { orderStatusLabel } from "./print-checkout";
describe("orderStatusLabel", () => {
  it("uses plain words", () => {
    expect(orderStatusLabel("IN_PRODUCTION")).toBe("Printing");
    expect(orderStatusLabel("UNPAID")).toBe("Order received");
    expect(orderStatusLabel("SOMETHING_NEW")).toBe("Order placed");
    expect(orderStatusLabel(null)).toBe("");
  });
});

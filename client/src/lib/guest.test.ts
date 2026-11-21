import { describe, expect, it } from "vitest";
import { guestLimitMessage } from "@shared/guest";
import { guestSignInPath, guestStopFrom } from "./guest";

describe("guestStopFrom", () => {
  it("turns the guest limit into the make-an-account sheet", () => {
    const err = new Error(`403: ${JSON.stringify({ error: guestLimitMessage(5), code: "guest_limit", limit: 5 })}`);
    expect(guestStopFrom(err)).toEqual({ kind: "limit", message: guestLimitMessage(5), limit: 5 });
  });

  it("asks to sign in when guests can't start here or aren't available", () => {
    expect(guestStopFrom(new Error(`429: ${JSON.stringify({ error: "Too many today", code: "guest_ip_limit" })}`))).toEqual({ kind: "signin", message: "Too many today" });
    expect(guestStopFrom(new Error(`503: ${JSON.stringify({ error: "Not now", code: "guest_unavailable" })}`))).toEqual({ kind: "signin", message: "Not now" });
    expect(guestStopFrom(new Error("401: {\"message\":\"Unauthorized\"}"))).toEqual({ kind: "signin" });
  });

  it("leaves ordinary errors alone", () => {
    expect(guestStopFrom(new Error(`402: ${JSON.stringify({ error: "Out of credits" })}`))).toBeNull();
    expect(guestStopFrom(new Error(`429: ${JSON.stringify({ error: "Wait a minute" })}`))).toBeNull();
    expect(guestStopFrom(new Error("Failed to fetch"))).toBeNull();
  });
});

describe("guestSignInPath", () => {
  it("comes back to where they were", () => {
    expect(guestSignInPath("signup", "/recipe/abc")).toBe("/login?mode=signup&next=%2Frecipe%2Fabc");
    expect(guestSignInPath("signin")).toBe("/login?next=%2F");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Live-update sockets learn who's connecting from sign-in, never from a
// user id in the URL (server/clerkAuth.ts userIdForSocket)
describe("userIdForSocket", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("SESSION_SECRET", "test-secret");
    vi.stubEnv("CLERK_SECRET_KEY", "");
    vi.stubEnv("BYPASS_AUTH", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.doMock("./storage", () => ({ storage: {} }));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.doUnmock("./storage"); });

  it("ignores a userId the page sends", async () => {
    const { userIdForSocket } = await import("./clerkAuth");
    const req: any = { url: "/ws/meal-plan?planId=p1&userId=someone-else", headers: {} };
    expect(await userIdForSocket(req)).toBeNull();
  });

  it("takes the user from a session token in the query", async () => {
    const { userIdForSocket, generateToken } = await import("./clerkAuth");
    const token = generateToken({ id: "u42", email: null, username: null });
    const req: any = { url: `/ws/meal-plan?planId=p1&userId=someone-else&token=${encodeURIComponent(token)}`, headers: {} };
    expect(await userIdForSocket(req)).toBe("u42");
  });

  it("refuses a forged token", async () => {
    const { userIdForSocket } = await import("./clerkAuth");
    const req: any = { url: "/ws/meal-plan?planId=p1&token=not.a.token", headers: {} };
    expect(await userIdForSocket(req)).toBeNull();
  });

  it("uses the development stand-in only in development without Clerk", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { userIdForSocket } = await import("./clerkAuth");
    expect(await userIdForSocket({ url: "/ws/meal-plan?planId=p1", headers: {} } as any)).toBe("37290791");
  });
});

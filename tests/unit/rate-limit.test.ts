import { describe, expect, it } from "vitest";
import { clientIpFrom, RateLimiter } from "@/lib/rate-limit";

describe("RateLimiter", () => {
  it("allows up to the limit within the window, then refuses", () => {
    const rl = new RateLimiter(3, 60_000);
    expect([0, 1, 2, 3].map((i) => rl.allow("ip", 1_000 + i))).toEqual([true, true, true, false]);
  });

  it("allows again once old hits leave the window", () => {
    const rl = new RateLimiter(2, 1_000);
    rl.allow("ip", 0);
    rl.allow("ip", 100);
    expect(rl.allow("ip", 500)).toBe(false);
    expect(rl.allow("ip", 1_050)).toBe(true); // the hit at 0 expired
  });

  it("counts keys separately and keeps memory bounded", () => {
    const rl = new RateLimiter(1, 60_000, 2);
    expect(rl.allow("a", 1)).toBe(true);
    expect(rl.allow("b", 2)).toBe(true);
    expect(rl.allow("a", 3)).toBe(false);
    rl.allow("c", 4); // evicts the stalest key ("b")
    expect(rl.allow("b", 5)).toBe(true);
  });
});

describe("clientIpFrom", () => {
  it("takes the first forwarded address", () => {
    expect(clientIpFrom("203.0.113.7, 10.0.0.1", null)).toBe("203.0.113.7");
    expect(clientIpFrom(null, " 198.51.100.2 ")).toBe("198.51.100.2");
    expect(clientIpFrom(null, null)).toBe("unknown");
  });
});

import { describe, expect, it } from "vitest";
import { createId, mapWithConcurrency, seededShuffle, shuffle } from "@/lib/utils";
import { crc32 } from "@/lib/zip-writer";

describe("seededShuffle", () => {
  const items = ["A", "B", "C", "D"];

  it("is deterministic per seed and varies across seeds", () => {
    expect(seededShuffle(items, "s1")).toEqual(seededShuffle(items, "s1"));
    const orders = new Set(Array.from({ length: 30 }, (_, i) => seededShuffle(items, `s${i}`).join("")));
    expect(orders.size).toBeGreaterThan(5);
  });

  it("places each item in each position roughly uniformly", () => {
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 20_000; i++) counts[seededShuffle(items, `id${i}`).indexOf("A")]++;
    for (const c of counts) expect(c).toBeGreaterThan(4_500);
  });

  it("doesn't mutate its input", () => {
    const copy = [...items];
    seededShuffle(items, "x");
    shuffle(items);
    expect(items).toEqual(copy);
  });
});

describe("mapWithConcurrency", () => {
  it("respects the limit, preserves order and isolates failures", async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5 + (n % 3) * 3));
      inFlight--;
      if (n === 4) throw new Error("boom");
      return n * 10;
    });
    expect(peak).toBe(3);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : "x"))).toEqual([10, 20, 30, "x", 50, 60, 70, 80]);
  });

  it("handles empty input", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});

describe("misc", () => {
  it("creates unique ids", () => {
    expect(new Set(Array.from({ length: 1000 }, createId)).size).toBe(1000);
  });

  it("computes standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789")).toString(16)).toBe("cbf43926");
  });
});

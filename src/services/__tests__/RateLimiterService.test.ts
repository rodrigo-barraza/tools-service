import { describe, it, expect } from "vitest";
import rateLimiter from "../RateLimiterService.ts";

// ═══════════════════════════════════════════════════════════════
//  getDelay
// ═══════════════════════════════════════════════════════════════

describe("RateLimiterService — getDelay", () => {
  it("returns the configured delay for a known provider", () => {
    const delay = rateLimiter.getDelay("TICKETMASTER");
    expect(delay).toBe(200);
  });

  it("returns null for an unknown provider", () => {
    const delay = rateLimiter.getDelay("NONEXISTENT_PROVIDER");
    expect(delay).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
//  getStats
// ═══════════════════════════════════════════════════════════════

describe("RateLimiterService — getStats", () => {
  it("returns stats with null lastRequestAt for unused provider", () => {
    const stats = rateLimiter.getStats("TMDB");
    expect(stats.lastRequestAt).toBeNull();
    expect(stats.delayMs).toBe(20);
  });
});

// ═══════════════════════════════════════════════════════════════
//  getAllLimits
// ═══════════════════════════════════════════════════════════════

describe("RateLimiterService — getAllLimits", () => {
  it("returns all rate limit definitions", () => {
    const limits = rateLimiter.getAllLimits();
    expect(typeof limits).toBe("object");
    expect(limits.TICKETMASTER).toBeTruthy();
    expect(limits.TICKETMASTER.requestDelayMs).toBe(200);
    expect(limits.TMDB).toBeTruthy();
  });

  it("returns a defensive copy", () => {
    const limitsFirst = rateLimiter.getAllLimits();
    const limitsSecond = rateLimiter.getAllLimits();
    expect(limitsFirst).not.toBe(limitsSecond);
    expect(limitsFirst).toEqual(limitsSecond);
  });
});

// ═══════════════════════════════════════════════════════════════
//  wait — Rate Limiting Behavior
// ═══════════════════════════════════════════════════════════════

describe("RateLimiterService — wait", () => {
  it("resolves immediately for unknown provider", async () => {
    const startTime = Date.now();
    await rateLimiter.wait("UNKNOWN_PROVIDER_XYZ");
    const elapsedMilliseconds = Date.now() - startTime;
    expect(elapsedMilliseconds).toBeLessThan(50);
  });

  it("resolves immediately for providers with no delay", async () => {
    // Some providers may have 0 or undefined requestDelayMs
    const startTime = Date.now();
    await rateLimiter.wait("TMDB"); // TMDB has 20ms delay, first call should be instant
    const elapsedMilliseconds = Date.now() - startTime;
    expect(elapsedMilliseconds).toBeLessThan(100);
  });

  it("updates lastRequestAt after wait", async () => {
    const beforeTime = Date.now();
    await rateLimiter.wait("SEATGEEK");
    const stats = rateLimiter.getStats("SEATGEEK");
    expect(stats.lastRequestAt).toBeGreaterThanOrEqual(beforeTime);
  });

  it("enforces delay between consecutive requests", async () => {
    // Use a provider with a known delay
    const provider = "TICKETMASTER"; // 200ms delay
    await rateLimiter.wait(provider);

    const startTime = Date.now();
    await rateLimiter.wait(provider);
    const elapsedMilliseconds = Date.now() - startTime;

    // Should have waited at least some portion of the delay
    // (not exactly 200ms due to timing precision, but should be measurable)
    expect(elapsedMilliseconds).toBeGreaterThanOrEqual(100);
  });
});

import { describe, expect, it, vi } from "vitest";
import { KeyedRateLimiter } from "../../backend/rate-limiter";

/**
 * Make a limiter with a small budget, so a test can use it up.
 * @returns The limiter
 */
function smallLimiter() : KeyedRateLimiter {
    return new KeyedRateLimiter({
        tokensPerInterval: 2,
        interval: "hour",
        fireImmediately: true,
        errorMessage: "too many",
    });
}

describe("KeyedRateLimiter", () => {
    it("counts for each key", async () => {
        const limiter = smallLimiter();
        const callback = vi.fn();

        expect(await limiter.pass("a", callback)).toBe(true);
        expect(await limiter.pass("a", callback)).toBe(true);
        expect(await limiter.pass("a", callback)).toBe(false);
        expect(callback).toHaveBeenCalledWith({
            ok: false,
            msg: "too many",
        });

        // A different key has its own budget
        expect(await limiter.pass("b", callback)).toBe(true);
    });

    it("keeps one limiter for each key", async () => {
        const limiter = smallLimiter();
        await limiter.pass("a", vi.fn());
        await limiter.pass("a", vi.fn());
        await limiter.pass("b", vi.fn());
        expect(limiter.limiters.size).toBe(2);
    });
});

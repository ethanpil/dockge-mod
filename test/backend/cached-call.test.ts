import { describe, expect, it, vi } from "vitest";
import { CachedCall } from "../../backend/utils/cached-call";

describe("CachedCall", () => {
    it("serves many callers with one call", async () => {
        let resolve : (value : number) => void = () => undefined;
        const fn = vi.fn(() => new Promise<number>((r) => {
            resolve = r;
        }));
        const cache = new CachedCall(fn, 1000);

        const a = cache.get();
        const b = cache.get();
        expect(fn).toHaveBeenCalledTimes(1);

        resolve(7);
        expect(await a).toBe(7);
        expect(await b).toBe(7);
    });

    it("keeps the result for the time to live", async () => {
        vi.useFakeTimers();
        try {
            const fn = vi.fn(async () => 1);
            const cache = new CachedCall(fn, 1000);

            await cache.get();
            vi.advanceTimersByTime(500);
            await cache.get();
            expect(fn).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(600);
            await cache.get();
            expect(fn).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it("runs the function again after invalidate", async () => {
        const fn = vi.fn(async () => 1);
        const cache = new CachedCall(fn, 60000);

        await cache.get();
        cache.invalidate();
        await cache.get();
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it("does not keep the result of a call from before an invalidate", async () => {
        let resolve : (value : number) => void = () => undefined;
        let calls = 0;
        const cache = new CachedCall(() => {
            calls++;
            if (calls === 1) {
                return new Promise<number>((r) => {
                    resolve = r;
                });
            }
            return Promise.resolve(2);
        }, 60000);

        const first = cache.get();
        cache.invalidate();

        // A call after the invalidate runs the function again
        const second = cache.get();
        expect(calls).toBe(2);

        resolve(1);
        expect(await first).toBe(1);
        expect(await second).toBe(2);

        // The cache holds the new result, not the old one
        expect(await cache.get()).toBe(2);
        expect(calls).toBe(2);
    });

    it("does not keep a failure", async () => {
        let calls = 0;
        const cache = new CachedCall(async () => {
            calls++;
            if (calls === 1) {
                throw new Error("first");
            }
            return calls;
        }, 60000);

        await expect(cache.get()).rejects.toThrow("first");
        expect(await cache.get()).toBe(2);
    });
});

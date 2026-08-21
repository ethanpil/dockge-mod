import { describe, expect, it } from "vitest";
import { ImageUpdate, ImageUpdateChecker } from "../../backend/image-update";

const INTERVAL = ImageUpdateChecker.INTERVAL;

/**
 * The last result of an image, for the schedule tests.
 * @param nextCheck The time of the next check, or null
 * @param failures The count of the failures
 * @returns The result
 */
function previous(nextCheck : string | null, failures = 1) : ImageUpdate {
    return {
        image: "demo",
        localDigest: null,
        remoteDigest: null,
        updateAvailable: false,
        checkedAt: null,
        error: null,
        failures,
        nextCheck,
    };
}

describe("ImageUpdateChecker.backoff", () => {
    it("gives no wait to an image without a failure", () => {
        expect(ImageUpdateChecker.backoff(0)).toBe(0);
    });

    it("doubles the time with each failure", () => {
        expect(ImageUpdateChecker.backoff(1)).toBe(INTERVAL);
        expect(ImageUpdateChecker.backoff(2)).toBe(INTERVAL * 2);
        expect(ImageUpdateChecker.backoff(3)).toBe(INTERVAL * 4);
    });

    it("keeps the time in its limit", () => {
        expect(ImageUpdateChecker.backoff(10)).toBe(ImageUpdateChecker.MAX_BACKOFF);
        expect(ImageUpdateChecker.backoff(1000)).toBe(ImageUpdateChecker.MAX_BACKOFF);
    });
});

describe("ImageUpdateChecker.isDue", () => {
    const now = 1_000_000_000_000;

    it("examines an image without a last result", () => {
        expect(ImageUpdateChecker.isDue(undefined, now, false)).toBe(true);
    });

    it("examines an image that has no wait", () => {
        expect(ImageUpdateChecker.isDue(previous(null), now, false)).toBe(true);
    });

    it("examines an image whose wait is over", () => {
        expect(ImageUpdateChecker.isDue(previous(new Date(now - 1000).toISOString()), now, false)).toBe(true);
    });

    it("leaves out an image that waits", () => {
        const nextCheck = new Date(now + INTERVAL * 2).toISOString();
        expect(ImageUpdateChecker.isDue(previous(nextCheck), now, false)).toBe(false);
    });

    it("examines each image for a check that the user starts", () => {
        const nextCheck = new Date(now + INTERVAL * 10).toISOString();
        expect(ImageUpdateChecker.isDue(previous(nextCheck), now, true)).toBe(true);
    });

    it("gives one failure a wait of one interval, not two", () => {
        // The check runs at each interval, and a check writes its time
        // some seconds after the interval starts. Without a window the
        // image would wait for the interval after the next one.
        const runEnd = now + 5000;
        const nextCheck = new Date(runEnd + ImageUpdateChecker.backoff(1)).toISOString();
        expect(ImageUpdateChecker.isDue(previous(nextCheck), now + INTERVAL, false)).toBe(true);
    });

    it("keeps the wait of two failures for two intervals", () => {
        const runEnd = now + 5000;
        const nextCheck = new Date(runEnd + ImageUpdateChecker.backoff(2)).toISOString();
        expect(ImageUpdateChecker.isDue(previous(nextCheck), now + INTERVAL, false)).toBe(false);
        expect(ImageUpdateChecker.isDue(previous(nextCheck), now + INTERVAL * 2, false)).toBe(true);
    });

    it("examines an image whose time is not a time", () => {
        expect(ImageUpdateChecker.isDue(previous("not a time"), now, false)).toBe(true);
    });

    it("examines an image whose time is too far away", () => {
        // A host with a wrong clock can write a time in a later year
        const nextCheck = new Date(now + ImageUpdateChecker.MAX_BACKOFF * 100).toISOString();
        expect(ImageUpdateChecker.isDue(previous(nextCheck), now, false)).toBe(true);
    });
});

describe("ImageUpdateChecker.key", () => {
    it("gives one key to two names of one image", () => {
        expect(ImageUpdateChecker.key("nginx:alpine")).toBe(ImageUpdateChecker.key("docker.io/library/nginx:alpine"));
    });

    it("gives the name back when docker cannot read it", () => {
        expect(ImageUpdateChecker.key("")).toBe("");
    });
});

import { describe, expect, it } from "vitest";
import { ImageUpdateChecker } from "../../backend/image-update";

describe("ImageUpdateChecker.backoff", () => {
    it("gives no wait to an image without a failure", () => {
        expect(ImageUpdateChecker.backoff(0)).toBe(0);
        expect(ImageUpdateChecker.backoff(-1)).toBe(0);
    });

    it("doubles the time with each failure", () => {
        expect(ImageUpdateChecker.backoff(1)).toBe(ImageUpdateChecker.INTERVAL);
        expect(ImageUpdateChecker.backoff(2)).toBe(ImageUpdateChecker.INTERVAL * 2);
        expect(ImageUpdateChecker.backoff(3)).toBe(ImageUpdateChecker.INTERVAL * 4);
    });

    it("keeps the time in its limit", () => {
        expect(ImageUpdateChecker.backoff(10)).toBe(ImageUpdateChecker.MAX_BACKOFF);
        expect(ImageUpdateChecker.backoff(1000)).toBe(ImageUpdateChecker.MAX_BACKOFF);
    });

    it("waits one interval at the first failure, thus the next check comes", () => {
        // The check runs at each interval. A first failure must not make
        // the image wait for more than one run.
        expect(ImageUpdateChecker.backoff(1)).toBeLessThanOrEqual(ImageUpdateChecker.INTERVAL);
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

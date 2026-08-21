import { describe, expect, it } from "vitest";
import {
    CREATED_FILE,
    CREATED_STACK,
    defaultComposeOverrideFileName,
    envsubstYAML,
    EXITED,
    parseDockerPort,
    RUNNING,
    statusName,
    statusNameShort,
    UNKNOWN,
} from "../../common/util-common";

describe("parseDockerPort", () => {
    const host = "example.com";

    it.each([
        [ "3000", "http://example.com:3000", "3000" ],
        [ "3000-3005", "http://example.com:3000", "3000-3005" ],
        [ "8000:8000", "http://example.com:8000", "8000" ],
        [ "9090-9091:8080-8081", "http://example.com:9090", "9090-9091" ],
        [ "49100:22", "http://example.com:49100", "49100" ],
        [ "8000-9000:80", "http://example.com:8000", "8000-9000" ],
        [ "127.0.0.1:8001:8001", "http://127.0.0.1:8001", "127.0.0.1:8001" ],
        [ "127.0.0.1:5000-5010:5000-5010", "http://127.0.0.1:5000", "127.0.0.1:5000-5010" ],
        [ "0.0.0.0:8080->8080/tcp", "http://example.com:8080", "8080" ],
        [ "6060:6060/udp", "udp://example.com:6060", "6060" ],
        [ "443:443", "https://example.com:443", "443" ],
    ])("parses %s", (input, url, display) => {
        expect(parseDockerPort(input, host)).toEqual({
            url,
            display,
        });
    });
});

describe("envsubstYAML", () => {
    it("replaces variables in values", () => {
        const out = envsubstYAML("services:\n  web:\n    image: ${IMAGE}\n    ports:\n      - ${PORT}:80\n", {
            IMAGE: "nginx",
            PORT: "8080",
        });
        expect(out).toContain("image: nginx");
        expect(out).toContain("8080:80");
    });

    it("uses the default of a variable", () => {
        const out = envsubstYAML("a: ${X:-fallback}\n", {});
        expect(out).toBe("a: fallback\n");
    });

    it("refuses a text with a parse error", () => {
        expect(() => envsubstYAML("a: [\n", {})).toThrow();
    });
});

describe("defaultComposeOverrideFileName", () => {
    it.each([
        [ "compose.yaml", "compose.override.yaml" ],
        [ "compose.yml", "compose.override.yml" ],
        [ "docker-compose.yaml", "docker-compose.override.yaml" ],
        [ "docker-compose.yml", "docker-compose.override.yml" ],
        [ "noext", "compose.override.yaml" ],
    ])("%s gives %s", (base, override) => {
        expect(defaultComposeOverrideFileName(base)).toBe(override);
    });
});

describe("status names", () => {
    it("keeps the names that the interface and the agents use", () => {
        expect(statusName(CREATED_FILE)).toBe("draft");
        expect(statusName(CREATED_STACK)).toBe("created_stack");
        expect(statusName(RUNNING)).toBe("running");
        expect(statusName(EXITED)).toBe("exited");
        expect(statusName(UNKNOWN)).toBe("unknown");
        expect(statusNameShort(RUNNING)).toBe("active");
        expect(statusNameShort(EXITED)).toBe("exited");
    });
});
